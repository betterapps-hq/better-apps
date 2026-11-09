import {
  defineAction,
  defineFeature,
  type Actor,
  type BetterAppsEvent,
  type EventHandler,
  type IdentityUser,
  type StandardSchemaV1,
  type Where,
  type WriteOperation
} from "better-apps"
import { z } from "zod"
import {
  isModerator,
  isTrusted,
  orgOf,
  orgsOf,
  requireModerator,
  requireReactor,
  requireView,
  requireViewer,
  viewable,
  type Context
} from "./access.js"
import { isEmoji, maxEmojiLength, normalizeEmoji } from "./emoji.js"
import { ReactionsError } from "./errors.js"
import { reactionEvents, type ReactionEventData, type ReactionRemovedData, type RemovalReason } from "./events.js"
import type {
  EmojiList,
  ListReactionsInput,
  ListReactorsInput,
  ReactionFilter,
  ReactionRules,
  ReactionsOptions,
  ReactionSubject,
  ReactionTarget,
  ReactorVisibility,
  TypesOf
} from "./options.js"
import { reactionModel, reactionsSchema, removalModel, type Reaction } from "./schema.js"

/** One emoji's reactions on a record. */
export interface ReactionSummary {
  emoji: string
  count: number
  /** Whether the signed-in user reacted with it. */
  reacted: boolean
}

/** A page of the people who reacted with one emoji, first reaction first, with their names and avatars. */
export interface ReactorPage {
  userIds: string[]
  /** The cursor for the next page, or `null` on the last one. */
  cursor: string | null
  users: Record<string, IdentityUser>
}

/** What `react` returns. `added` is `false` when the user had already reacted with that emoji. */
export interface ReactResult {
  reaction: Reaction
  added: boolean
  /** The reactions this one took the place of, when each person has one reaction; usually one, and none otherwise. */
  replaced: Reaction[]
}

/** What `unreact` returns. `removed` is `false` when the user hadn't reacted with that emoji. */
export interface UnreactResult {
  reaction: Reaction | null
  removed: boolean
}

/** How reactions work on one record, from `getSettings`, such as for a picker. */
export interface ReactionSettings {
  /** The reactions allowed, in order, or `null` when any single emoji is. */
  emojis: string[] | null
  /** Whether the allowed reactions depend on the record's organization, so records of one type can differ. */
  emojisByOrg: boolean
  maxPerUser: number
  maxEmojis: number
  reactorVisibility: ReactorVisibility
}

/** A reaction event a viewer's browser may see, from `toClientEvent`. */
export type ClientReactionEvent = ClientReactionChange | ClientRecordChange

/** One person's reaction added or removed. */
export interface ClientReactionChange {
  id: string
  type: "reaction.added" | "reaction.removed"
  subjectType: string
  subjectId: string
  /** Who reacted, or `""` when the viewer may not see who did. */
  userId: string
  emoji: string
  /** How many reactions with this emoji the record had just after the change, when the server knew. */
  count?: number | undefined
  /** Whether the viewer made the change, such as from another tab. */
  mine: boolean
}

/**
 * Many of a record's reactions changed at once, such as when a moderator removed them or the record moved to another
 * organization, so a browser loads the record again rather than receiving each change.
 */
export interface ClientRecordChange {
  id: string
  type: "subject.changed"
  subjectType: string
  subjectId: string
}

/** Size and count limits. Queries that pass lists of ids stay under D1's 100 bound parameters. */
export const limits = {
  subjectsPerList: 50,
  reactorsPerPage: 20,
  maxReactorsPerPage: 50,
  maxPerUser: 20,
  maxEmojis: 50,
  emojiLength: maxEmojiLength
} as const

/** How long a removal is remembered, which only needs to outlast requests under way. */
const removalMemoryMs = 60 * 60_000
/**
 * How many reactions one call of a bulk job removes. Its batch takes a few statements, plus one `reaction.removed` event
 * each for an app that subscribes to them, so a call stays well within a database's limits per request.
 */
const removalPage = 100
/**
 * How many reactions one batch moves. Each takes its own update statement, and the page also looks up what the same
 * people have in the new organization, so a page stays under D1's 50 queries per request on its free plan and its
 * query's ids under D1's 100 bound parameters.
 */
const movePageSize = 30
/** How long an organization's own list of emoji is reused before it's asked for again. */
const emojiListMs = 60_000

type Emojis = ReadonlyMap<string, number> | null

/** How reactions work on one subject type, resolved once when the feature is created. */
interface Settings {
  rules: ReactionRules
  /** The allowed reactions and their order for an organization, or `null` for any single emoji. */
  emojisFor: EmojiSource
  maxPerUser: number
  maxEmojis: number
  reactorVisibility: ReactorVisibility
  /** Whether a reaction is checked against the record again once saved, and taken back if it went away meanwhile. */
  checkAfterReact: boolean
}

type Config = Readonly<Record<string, Settings>>

/** The subject types comments declares for its own records, which reactions clean up after. */
const commentTypes = { thread: "comments.thread", comment: "comments.comment" } as const

function resolveEmojis(list: readonly string[]): Map<string, number> {
  if (list.length === 0) {
    throw new Error("Leave out `emojis` to allow any emoji, rather than passing an empty list.")
  }
  const emojis = new Map<string, number>()
  for (const entry of list) {
    if (entry.length === 0 || entry.length > limits.emojiLength) {
      throw new Error(`Reactions are 1 to ${limits.emojiLength} characters, so "${entry}" can't be one.`)
    }
    const emoji = normalizeEmoji(entry)
    if (emojis.has(emoji)) {
      throw new Error(`The "${entry}" reaction is listed twice.`)
    }
    emojis.set(emoji, emojis.size)
  }
  return emojis
}

/**
 * An organization's own list, which can be edited by its people, so entries that can't be reactions and repeats are
 * skipped rather than failing every request. An empty list allows no reactions.
 */
function forgivingEmojis(list: readonly unknown[]): Map<string, number> {
  const emojis = new Map<string, number>()
  for (const entry of list) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > limits.emojiLength) {
      continue
    }
    const emoji = normalizeEmoji(entry)
    if (!emojis.has(emoji)) {
      emojis.set(emoji, emojis.size)
    }
  }
  return emojis
}

/** An organization's allowed reactions, and, for lists that depend on the organization, a way to forget them. */
type EmojiSource = ((orgId: string) => Promise<Emojis>) & { byOrg: boolean; forget: (orgId?: string) => void }

function emojiSource(subjectType: string, list: EmojiList | undefined): EmojiSource {
  const fixed = (emojis: Emojis): EmojiSource =>
    Object.assign(async () => emojis, { byOrg: false, forget: () => undefined })
  if (!list) {
    return fixed(null)
  }
  if (typeof list !== "function") {
    return fixed(resolveEmojis(list))
  }
  // Each organization's list is reused for a minute, so a page of records asks once.
  const cache = new Map<string, { emojis: Emojis; until: number }>()
  const forget = (orgId?: string) => {
    if (orgId === undefined) {
      cache.clear()
    } else {
      cache.delete(orgId ?? "")
    }
  }
  const source = async (orgId: string) => {
    const cached = cache.get(orgId)
    if (cached && cached.until > Date.now()) {
      return cached.emojis
    }
    const emojis = forgivingEmojis(await list({ subjectType, orgId: orgId === "" ? null : orgId }))
    if (cache.size >= 1000) {
      cache.clear()
    }
    cache.set(orgId, { emojis, until: Date.now() + emojiListMs })
    return emojis
  }
  return Object.assign(source, { byOrg: true, forget })
}

function resolveCount(name: string, value: number, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`\`${name}\` must be a whole number from 1 to ${max}.`)
  }
  return value
}

function resolve(options: ReactionsOptions): Config {
  if (Object.keys(options.subjects).length === 0) {
    throw new Error("Reactions need at least one subject type.")
  }
  const config: Record<string, Settings> = {}
  for (const [subjectType, rules] of Object.entries(options.subjects)) {
    config[subjectType] = {
      rules,
      emojisFor: emojiSource(subjectType, rules.emojis ?? options.emojis),
      maxPerUser: resolveCount("maxPerUser", rules.maxPerUser ?? options.maxPerUser ?? limits.maxPerUser, 100),
      maxEmojis: resolveCount("maxEmojis", rules.maxEmojis ?? options.maxEmojis ?? limits.maxEmojis, 500),
      reactorVisibility: rules.reactorVisibility ?? options.reactorVisibility ?? "viewers",
      checkAfterReact: rules.checkAfterReact ?? true
    }
  }
  return config
}

/** The settings of a subject type, or `INVALID_INPUT` when reactions aren't set up for it. */
function settingsOf(config: Config, subjectType: string): Settings {
  if (!Object.hasOwn(config, subjectType)) {
    throw new ReactionsError("INVALID_INPUT", `Reactions aren't set up for the "${subjectType}" subject type.`)
  }
  return config[subjectType] as Settings
}

/** The stored spelling of an allowed reaction, or `INVALID_INPUT`. */
function allowedEmoji(emojis: Emojis, emoji: string): string {
  const normalized = normalizeEmoji(emoji)
  const allowed = emojis ? emojis.has(normalized) : isEmoji(normalized)
  if (!allowed) {
    throw new ReactionsError("INVALID_INPUT", `"${emoji}" isn't a reaction this app allows.`)
  }
  return normalized
}

/** How many ids one `in` list holds, under D1's limit of 100 bound parameters. */
const chunkSize = 90

/** Splits ids into lists of at most `chunkSize`. */
function chunks<Item>(items: readonly Item[], size = chunkSize): Item[][] {
  const lists: Item[][] = []
  for (let start = 0; start < items.length; start += size) {
    lists.push(items.slice(start, start + size))
  }
  return lists
}

/** The lowest of a person's places on a record that's free, or `-1` when all are taken. */
function freeSlot(taken: ReadonlySet<number>, maxPerUser: number): number {
  for (let slot = 0; slot < maxPerUser; slot += 1) {
    if (!taken.has(slot)) {
      return slot
    }
  }
  return -1
}

// A page cursor holds the last row's time and id, so rows that share a time are never skipped or repeated.
function encodeCursor(time: Date, id: string): string {
  return btoa(JSON.stringify([time.toISOString(), id]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function decodeCursor(cursor: string): { time: Date; id: string } {
  try {
    const [time, id] = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/"))) as unknown[]
    const date = new Date(String(time))
    if (typeof time === "string" && typeof id === "string" && !Number.isNaN(date.getTime())) {
      return { time: date, id }
    }
  } catch {
    // Reported below.
  }
  throw new ReactionsError("INVALID_INPUT", "That page cursor isn't valid.")
}

const subjectType = z.string().min(1).max(255)
const subjectId = z.string().min(1).max(255)
const userId = z.string().min(1).max(255)
const emoji = z.string().min(1).max(limits.emojiLength)
const subject = z.object({ subjectType, subjectId })
const target = subject.extend({ emoji })
const inputs = {
  listReactions: z.object({ subjectType, subjectIds: z.array(subjectId).max(limits.subjectsPerList) }),
  subject,
  target,
  filter: subject.extend({ emoji: emoji.optional(), userId: userId.optional() }),
  listReactors: target.extend({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(limits.maxReactorsPerPage).optional()
  }),
  moveSubject: subject.extend({ toOrgId: z.string().max(255).nullable() }),
  removeUser: z.object({ userId, orgId: z.string().max(255).nullable().optional() }),
  forgetEmojis: z.object({ orgId: z.string().max(255).nullable().optional() })
}

/** One record's reactions in one organization. */
const onRecord = (ref: ReactionSubject, orgId: string): Where[] => [
  { field: "subjectType", value: ref.subjectType },
  { field: "subjectId", value: ref.subjectId },
  { field: "orgId", value: orgId }
]

/** What reactions helpers write with: an action's or a subscriber's database and events. */
type Writer = { db: Context["db"]; emit: Context["emit"] }

const removal = (row: Reaction, reason: RemovalReason, bulk = false): ReactionRemovedData => ({
  subjectType: row.subjectType,
  subjectId: row.subjectId,
  orgId: row.orgId,
  userId: row.userId,
  emoji: row.emoji,
  reason,
  ...(bulk ? { bulk: true } : {})
})

/**
 * The writes that remove reactions: each is deleted and remembered by its id, so a batch that removes one another
 * removal already took fails, with its events, rather than reporting it twice. Old memories go at the same time. They
 * use the server's clock, not the action's `now`, which an import can set to another time.
 */
function removals(rows: readonly Reaction[]): WriteOperation[] {
  const now = new Date()
  return [
    ...chunks(rows.map((row) => row.id)).map((ids): WriteOperation => ({
      type: "deleteMany",
      model: reactionModel,
      where: [{ field: "id", operator: "in", value: ids }]
    })),
    { type: "createMany", model: removalModel, data: rows.map((row) => ({ id: row.id, createdAt: now })) },
    {
      type: "deleteMany",
      model: removalModel,
      where: [{ field: "createdAt", operator: "lt", value: new Date(now.getTime() - removalMemoryMs) }]
    }
  ]
}

/**
 * Runs one page of a job, reading it again when its batch fails, such as one that lost a race with another removal. The
 * third failure in a row is thrown. Each committed page stays done, so calling again picks up where it stopped.
 */
async function retried<Output>(page: () => Promise<Output>): Promise<Output> {
  for (let failures = 1; ; failures += 1) {
    try {
      return await page()
    } catch (error) {
      if (failures >= 3) {
        throw error
      }
    }
  }
}

/** One call of a bulk job: whether it's done, or should be called again. */
export interface BulkStep {
  done: boolean
}

/** The records some reactions are on, once each. */
function recordsOf(rows: readonly Reaction[]): ReactionSubject[] {
  const records = new Map(rows.map((row) => [JSON.stringify([row.subjectType, row.subjectId]), row]))
  return [...records.values()].map((row) => ({ subjectType: row.subjectType, subjectId: row.subjectId }))
}

/**
 * Removes a page of the reactions `find` returns, emitting `reaction.removed` for each. Removals marked `bulk` stay with
 * server subscribers, and browsers hear of them with one `subject.changed` per record, written with the page, so a job
 * that stops partway still reaches them. Returns how many went, and whether that was the last page.
 */
async function removePage(
  writer: Writer,
  find: (limit: number) => Promise<Reaction[]>,
  reason: RemovalReason,
  bulk = true
): Promise<{ removed: number } & BulkStep> {
  return retried(async () => {
    const rows = await find(removalPage)
    if (rows.length > 0) {
      for (const row of rows) {
        writer.emit("reaction.removed", removal(row, reason, bulk))
      }
      if (bulk) {
        for (const record of recordsOf(rows)) {
          writer.emit("subject.changed", record)
        }
      }
      await writer.db.batch(removals(rows))
    }
    return { removed: rows.length, done: rows.length < removalPage }
  })
}

/**
 * Up to `limit` reactions on some records of one subject type, from every organization or all but one, reading at most
 * `maxReads` lists of ids, with the ids that may still have more once this page is handled. Ids before the list that
 * filled the page have none left, so a next page doesn't read them again.
 */
async function pageOf(
  db: Context["db"],
  subjectType: string,
  subjectIds: readonly string[],
  limit: number,
  { notOrgId, maxReads = Infinity }: { notOrgId?: string | undefined; maxReads?: number } = {}
): Promise<{ rows: Reaction[]; rest: string[]; reads: number }> {
  const ids = [...new Set(subjectIds)]
  const rows: Reaction[] = []
  let reads = 0
  for (const [index, list] of chunks(ids).entries()) {
    if (reads >= maxReads) {
      return { rows, rest: ids.slice(index * chunkSize), reads }
    }
    reads += 1
    rows.push(
      ...(await db.findMany<Reaction>({
        model: reactionModel,
        where: [
          { field: "subjectType", value: subjectType },
          { field: "subjectId", operator: "in", value: list },
          ...(notOrgId === undefined ? [] : [{ field: "orgId", operator: "ne" as const, value: notOrgId }])
        ],
        limit: limit - rows.length
      }))
    )
    if (rows.length >= limit) {
      return { rows, rest: ids.slice(index * chunkSize), reads }
    }
  }
  return { rows, rest: [], reads }
}

/** Finds a page of one record's reactions, from every organization or all but one. */
const reactionsOn =
  (db: Context["db"], ref: ReactionSubject, notOrgId?: string) =>
  async (limit: number): Promise<Reaction[]> =>
    (await pageOf(db, ref.subjectType, [ref.subjectId], limit, { notOrgId })).rows

/** Records to clean up after, by subject type, and the organization they moved to, when they moved. */
interface Cleanup {
  records: { subjectType: string; subjectIds: string[] }[]
  toOrgId?: string | undefined
}

/**
 * How many lists of ids one delivery of a cleanup reads looking for reactions. With one page of removals or moves, a
 * delivery stays under D1's 50 queries per request on its free plan; the rest continues in later runs.
 */
const cleanupReads = 10
/** How many batches of removals or moves one delivery of a cleanup writes, each a few statements besides its rows. */
const cleanupBatches = 3

/**
 * Removes or moves the reactions on records that went away or moved, such as comments' threads: one page of them per
 * delivery, reading at most `cleanupReads` lists of ids to find it. What's left continues with a `cleanup.continued`
 * event in the next `app.deliverEvents()` run. Subject types reactions no longer set up are skipped.
 */
async function cleanUp(config: Config, writer: Writer & Pick<Context, "subjects">, job: Cleanup) {
  const { toOrgId } = job
  const records = job.records.filter(
    (record) => record.subjectIds.length > 0 && Object.hasOwn(config, record.subjectType)
  )
  if (toOrgId !== undefined && records.length > 0) {
    // A move runs over several deliveries, so its records may have moved again since. They move together, as a thread
    // and its comments do, so the first of each kind tells where they are; one no longer in this job's organization
    // stops it, so an older job never undoes a newer move.
    const orgIds = await orgsOf(
      writer.subjects,
      records.map((record) => ({ subjectType: record.subjectType, subjectId: record.subjectIds[0] as string })),
      null
    )
    if (orgIds.some((orgId) => orgId !== toOrgId)) {
      return
    }
  }
  // One page's worth of reactions per delivery, over a few batches at most, such as a thread's and its comments'.
  let room = toOrgId === undefined ? removalPage : movePageSize
  let reads = cleanupReads
  for (let batches = 0; batches < cleanupBatches && room > 0 && reads > 0 && records.length > 0;) {
    const record = records[0] as Cleanup["records"][number]
    let rest: string[] = []
    let found = 0
    const find = async (limit: number) => {
      const page = await pageOf(writer.db, record.subjectType, record.subjectIds, Math.min(limit, room), {
        notOrgId: toOrgId,
        maxReads: reads
      })
      rest = page.rest
      found = page.rows.length
      reads -= page.reads
      return page.rows
    }
    await (toOrgId === undefined
      ? removePage(writer, find, "subjectRemoved")
      : movePage(writer, settingsOf(config, record.subjectType), record.subjectType, find, toOrgId))
    room -= found
    batches += found > 0 ? 1 : 0
    records[0] = { ...record, subjectIds: rest }
    if (rest.length === 0) {
      records.shift()
    }
  }
  if (records.length > 0) {
    writer.emit("cleanup.continued", { ...job, records } satisfies Cleanup, { later: true })
  }
}

/**
 * Moves a page of the reactions `find` returns, on records of one subject type, to another organization. A person's
 * reaction that they already made in that organization, or that has no free place there, is removed with
 * `reaction.removed` and the reason `merged`. Each record the page touched gets `subject.moved`, written with the page,
 * so a job that stops partway still reaches browsers for the pages done. Returns how many moved, and whether that was the
 * last page.
 */
async function movePage(
  writer: Writer,
  settings: Settings,
  type: string,
  find: (limit: number) => Promise<Reaction[]>,
  toOrgId: string
): Promise<{ moved: number } & BulkStep> {
  const { db } = writer
  return retried(async () => {
    const rows = await find(movePageSize)
    if (rows.length === 0) {
      return { moved: 0, done: true }
    }
    // What the same people already have on the same records in the new organization.
    const there = await db.findMany<Reaction>({
      model: reactionModel,
      where: [
        { field: "subjectType", value: type },
        { field: "subjectId", operator: "in", value: [...new Set(rows.map((row) => row.subjectId))] },
        { field: "orgId", value: toOrgId },
        { field: "userId", operator: "in", value: [...new Set(rows.map((row) => row.userId))] }
      ]
    })
    const people = new Map<string, { emojis: Set<string>; slots: Set<number> }>()
    const personOn = (row: Reaction) => {
      const key = JSON.stringify([row.subjectId, row.userId])
      const found = people.get(key) ?? { emojis: new Set<string>(), slots: new Set<number>() }
      people.set(key, found)
      return found
    }
    for (const row of there) {
      personOn(row).emojis.add(row.emoji)
      personOn(row).slots.add(row.slot)
    }
    const updates: WriteOperation[] = []
    const dropped: Reaction[] = []
    for (const row of rows) {
      const person = personOn(row)
      const slot = person.emojis.has(row.emoji) ? -1 : freeSlot(person.slots, settings.maxPerUser)
      if (slot === -1) {
        dropped.push(row)
        continue
      }
      person.emojis.add(row.emoji)
      person.slots.add(slot)
      updates.push({
        type: "update",
        model: reactionModel,
        where: [{ field: "id", value: row.id }],
        update: { orgId: toOrgId, slot }
      })
    }
    for (const row of dropped) {
      writer.emit("reaction.removed", removal(row, "merged", true))
    }
    for (const record of recordsOf(rows)) {
      writer.emit("subject.moved", { ...record, toOrgId })
    }
    // A reaction that lands in the new organization meanwhile can take a place this page meant to use, which fails the
    // batch, and the page is read again. One removed meanwhile updates nothing, so it isn't counted as moved.
    const results = await db.batch([...updates, ...(dropped.length > 0 ? removals(dropped) : [])])
    return {
      moved: results.slice(0, updates.length).filter((result) => result !== null).length,
      done: rows.length < movePageSize
    }
  })
}

/** Orders a record's reactions: in the subject type's list order, or by when each emoji was first used. */
function byOrder(emojis: Emojis) {
  return (a: Summary, b: Summary) => {
    // Emoji no longer listed, which keep their reactions, go after the listed ones, by first use.
    const listed = emojis ? (emojis.get(a.emoji) ?? Infinity) - (emojis.get(b.emoji) ?? Infinity) : 0
    if (listed !== 0 && !Number.isNaN(listed)) {
      return listed
    }
    return a.first - b.first || (a.emoji < b.emoji ? -1 : 1)
  }
}

type Summary = ReactionSummary & { first: number }

async function listReactions(config: Config, context: Context): Promise<Record<string, ReactionSummary[]>> {
  const input = context.input as ListReactionsInput
  const settings = settingsOf(config, input.subjectType)
  const ids = [...new Set(input.subjectIds)]
  const refs = ids.map((id) => ({ subjectType: input.subjectType, subjectId: id }))
  const visible = await viewable(context, refs, { request: context.request })
  const shown = refs.filter((_, index) => visible[index])
  const result: Record<string, ReactionSummary[]> = Object.fromEntries(ids.map((id) => [id, []]))
  if (shown.length === 0) {
    return result
  }
  const { actor, db, subjects } = context
  const found = await orgsOf(subjects, shown, actor)
  const orgs = new Map(shown.map((ref, index) => [ref.subjectId, found[index] ?? ""]))
  const where: Where[] = [
    { field: "subjectType", value: input.subjectType },
    {
      field: "subjectId",
      operator: "in",
      value: shown.map((ref) => ref.subjectId)
    }
  ]
  const [groups, mine, lists] = await Promise.all([
    db.countGroups({ model: reactionModel, where, groupBy: ["subjectId", "orgId", "emoji"], min: ["createdAt"] }),
    actor
      ? db.findMany<Reaction>({
          model: reactionModel,
          where: [...where, { field: "userId", value: actor.userId }],
          select: ["subjectId", "orgId", "emoji"]
        })
      : [],
    // Each organization's list, looked up once. One that fails to load only loses its order here.
    Promise.all(
      [...new Set(orgs.values())].map(
        async (orgId) => [orgId, await settings.emojisFor(orgId).catch(() => null)] as const
      )
    )
  ])
  const listOf = new Map(lists)
  // Reactions stored under another organization than the record's current one stay hidden until `moveSubject`.
  const current = (id: unknown, orgId: unknown) => orgs.get(String(id)) === String(orgId)
  const reacted = new Set(
    mine.filter((row) => current(row.subjectId, row.orgId)).map((row) => JSON.stringify([row.subjectId, row.emoji]))
  )
  const summaries = new Map<string, Summary[]>()
  for (const { group, count, min } of groups) {
    if (!current(group.subjectId, group.orgId)) {
      continue
    }
    const id = String(group.subjectId)
    const emoji = String(group.emoji)
    const first = min?.createdAt instanceof Date ? min.createdAt.getTime() : 0
    summaries.set(id, [
      ...(summaries.get(id) ?? []),
      { emoji, count, reacted: reacted.has(JSON.stringify([id, emoji])), first }
    ])
  }
  for (const [id, list] of summaries) {
    list.sort(byOrder(listOf.get(orgs.get(id) ?? "") ?? null))
    result[id] = list.map(({ emoji, count, reacted: mineToo }) => ({ emoji, count, reacted: mineToo }))
  }
  return result
}

async function listReactors(config: Config, context: Context): Promise<ReactorPage> {
  const input = context.input as ListReactorsInput
  const settings = settingsOf(config, input.subjectType)
  await requireView(context, input, { request: context.request })
  if (settings.reactorVisibility === "hidden" && !(await isModerator(settings.rules, context, input))) {
    throw new ReactionsError("FORBIDDEN", "Who reacted is kept private here.")
  }
  if (settings.reactorVisibility === "viewers" && !isTrusted(context)) {
    const { actor } = context
    if (!actor) {
      throw new ReactionsError("UNAUTHENTICATED", "Sign in to see who reacted.")
    }
    // Someone who sees the record only through a grant, such as a share link, isn't one of its viewers.
    if (!(await context.subjects.canView(actor, input))) {
      throw new ReactionsError("FORBIDDEN", "Who reacted is kept private here.")
    }
  }
  const limit = input.limit ?? limits.reactorsPerPage
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
  const orgId = await orgOf(context.subjects, input, context.actor)
  const rows = await context.db.findMany<Reaction>({
    model: reactionModel,
    where: [...onRecord(input, orgId), { field: "emoji", value: normalizeEmoji(input.emoji) }],
    sortBy: [
      { field: "createdAt", direction: "asc" },
      { field: "id", direction: "asc" }
    ],
    after: after && { createdAt: after.time, id: after.id },
    limit: limit + 1
  })
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  const userIds = page.map((row) => row.userId)
  const { getUsers } = context.identity
  let users: Record<string, IdentityUser> = {}
  if (getUsers && userIds.length > 0) {
    const found = await Promise.all(chunks(userIds).map(async (list) => getUsers.call(context.identity, list)))
    users = Object.fromEntries(found.flat().map((user) => [user.id, user]))
  }
  return { userIds, cursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null, users }
}

async function getSettings(config: Config, context: Context): Promise<ReactionSettings> {
  const input = context.input as ReactionSubject
  const settings = settingsOf(config, input.subjectType)
  await requireView(context, input, { request: context.request })
  const emojis = await settings.emojisFor(await orgOf(context.subjects, input, context.actor))
  return {
    emojis: emojis && [...emojis.keys()],
    emojisByOrg: settings.emojisFor.byOrg,
    maxPerUser: settings.maxPerUser,
    maxEmojis: settings.maxEmojis,
    reactorVisibility: settings.reactorVisibility
  }
}

const idsOf = (rows: readonly Reaction[]) => rows.map((row) => row.id).join(",")

async function react(config: Config, context: Context): Promise<ReactResult> {
  const input = context.input as ReactionTarget
  const settings = settingsOf(config, input.subjectType)
  const actor = await requireReactor(settings.rules, context, input)
  const { db } = context
  const orgId = await orgOf(context.subjects, input, actor)
  const emoji = allowedEmoji(await settings.emojisFor(orgId), input.emoji)
  const data: ReactionEventData = {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    orgId,
    userId: actor.userId,
    emoji
  }
  const theirs = [...onRecord(input, orgId), { field: "userId", value: actor.userId }]
  for (let attempt = 1; ; attempt += 1) {
    const rows = await db.findMany<Reaction>({ model: reactionModel, where: theirs })
    const existing = rows.find((row) => row.emoji === emoji)
    if (existing) {
      return { reaction: existing, added: false, replaced: [] }
    }
    // With one reaction each, a new emoji takes the place of the old one, as a single choice does.
    const replacing = settings.maxPerUser === 1 ? rows : []
    const slot = freeSlot(new Set(replacing.length > 0 ? [] : rows.map((row) => row.slot)), settings.maxPerUser)
    if (slot === -1 || (replacing.length === 0 && rows.length >= settings.maxPerUser)) {
      throw new ReactionsError("LIMIT_EXCEEDED", `You can react with up to ${settings.maxPerUser} emoji here.`)
    }
    // A record holds a limited number of different emoji. A swap away from an emoji nobody else uses makes room for
    // its new one. Two people adding new emoji at once can pass the limit by one each.
    const used = await db.countGroups({ model: reactionModel, where: onRecord(input, orgId), groupBy: ["emoji"] })
    const counts = new Map(used.map((group) => [String(group.group.emoji), group.count]))
    const freed = replacing.filter((row) => counts.get(row.emoji) === 1).length
    if (!counts.has(emoji) && used.length + 1 - freed > settings.maxEmojis) {
      throw new ReactionsError("LIMIT_EXCEEDED", `This already has ${settings.maxEmojis} different reactions.`)
    }
    // Events carry each emoji's count after the change, as this read saw it, so a browser can tell whether it missed one.
    for (const row of replacing) {
      context.emit("reaction.removed", { ...removal(row, "replaced"), count: (counts.get(row.emoji) ?? 1) - 1 })
    }
    context.emit("reaction.added", { ...data, count: (counts.get(emoji) ?? 0) + 1 })
    let saved = false
    try {
      const results = await db.batch([
        ...(replacing.length > 0 ? removals(replacing) : []),
        { type: "create", model: reactionModel, data: { ...data, slot, createdAt: context.now } }
      ])
      saved = true
      const reaction = results.at(-1) as Reaction
      await stillThere(settings, context, input, reaction)
      return { reaction, added: true, replaced: replacing }
    } catch (error) {
      // Once saved, the reaction stands, so a failure after that is reported rather than retried as if it hadn't.
      if (saved || error instanceof ReactionsError) {
        throw error
      }
      // A person's emoji and places on a record are unique, and so is each removal, so a change of theirs that landed
      // meanwhile fails this batch, and none of its writes or events are kept. When their reactions changed, look again.
      const now = await db.findMany<Reaction>({ model: reactionModel, where: theirs })
      if (idsOf(now) === idsOf(rows)) {
        throw error
      }
      if (attempt >= 3) {
        throw new ReactionsError("CONFLICT", "Your reactions here kept changing while this one was saved. Try again.")
      }
    }
  }
}

/**
 * A reaction to a record deleted or moved while it was being saved could land after the record's cleanup or move ran,
 * so subject types with `checkAfterReact` check the record again, and take the reaction back if it went away, out of
 * reach, or to another organization.
 */
async function stillThere(settings: Settings, context: Context, ref: ReactionSubject, reaction: Reaction) {
  if (!settings.checkAfterReact) {
    return
  }
  const { actor, subjects } = context
  const visible = actor !== null && (await subjects.canView(actor, ref))
  const moved = visible && (await orgOf(subjects, ref, actor)) !== reaction.orgId
  if (visible && !moved) {
    return
  }
  await removePage(
    context,
    async () => context.db.findMany<Reaction>({ model: reactionModel, where: [{ field: "id", value: reaction.id }] }),
    "withdrawn",
    false
  )
  if (moved) {
    throw new ReactionsError("CONFLICT", "That record moved while your reaction was saved. Try again.")
  }
  throw new ReactionsError("NOT_FOUND", "That record doesn't exist, or you can't see it.")
}

async function unreact(config: Config, context: Context): Promise<UnreactResult> {
  const input = context.input as ReactionTarget
  settingsOf(config, input.subjectType)
  // Taking back one's own reaction needs no `canReact`, so someone who may no longer react can still undo theirs.
  const actor = await requireViewer(context, input)
  const where = [
    ...onRecord(input, await orgOf(context.subjects, input, actor)),
    { field: "userId", value: actor.userId },
    { field: "emoji", value: normalizeEmoji(input.emoji) }
  ]
  const existing = await context.db.findOne<Reaction>({ model: reactionModel, where })
  if (!existing) {
    return { reaction: null, removed: false }
  }
  const left = await context.db.count({
    model: reactionModel,
    where: [...onRecord(input, existing.orgId), { field: "emoji", value: existing.emoji }]
  })
  context.emit("reaction.removed", { ...removal(existing, "unreacted"), count: Math.max(left - 1, 0) })
  try {
    await context.db.batch(removals([existing]))
  } catch (error) {
    // Another removal, such as from another tab, took it first and reported it.
    if (await context.db.findOne<Reaction>({ model: reactionModel, where: [{ field: "id", value: existing.id }] })) {
      throw error
    }
    return { reaction: null, removed: false }
  }
  return { reaction: existing, removed: true }
}

async function removeReactions(config: Config, context: Context): Promise<{ removed: number } & BulkStep> {
  const input = context.input as ReactionFilter
  const settings = settingsOf(config, input.subjectType)
  await requireModerator(settings.rules, context, input)
  const where = [
    ...onRecord(input, await orgOf(context.subjects, input, context.actor)),
    ...(input.emoji === undefined ? [] : [{ field: "emoji", value: normalizeEmoji(input.emoji) }]),
    ...(input.userId === undefined ? [] : [{ field: "userId", value: input.userId }])
  ]
  return removePage(
    context,
    async (limit) => context.db.findMany<Reaction>({ model: reactionModel, where, limit }),
    "moderated"
  )
}

async function removeSubject(config: Config, context: Context): Promise<{ removed: number } & BulkStep> {
  const input = context.input as ReactionSubject
  settingsOf(config, input.subjectType)
  const step = await removePage(context, reactionsOn(context.db, input), "subjectRemoved")
  if (step.done) {
    context.emit("subject.removed", { subjectType: input.subjectType, subjectId: input.subjectId })
  }
  return step
}

async function moveSubject(config: Config, context: Context): Promise<{ moved: number } & BulkStep> {
  const input = context.input as ReactionSubject & { toOrgId: string | null }
  const settings = settingsOf(config, input.subjectType)
  const toOrgId = input.toOrgId ?? ""
  return movePage(context, settings, input.subjectType, reactionsOn(context.db, input, toOrgId), toOrgId)
}

async function removeUser(_config: Config, context: Context): Promise<{ removed: number } & BulkStep> {
  const input = context.input as { userId: string; orgId?: string | null }
  const where: Where[] = [
    { field: "userId", value: input.userId },
    ...(input.orgId === undefined ? [] : [{ field: "orgId", value: input.orgId ?? "" }])
  ]
  const step = await removePage(
    context,
    async (limit) => context.db.findMany<Reaction>({ model: reactionModel, where, limit }),
    "userRemoved"
  )
  if (step.done) {
    context.emit("user.removed", { userId: input.userId, orgId: input.orgId ?? null })
  }
  return step
}

/**
 * Forgets the cached lists of emoji that depend on the organization, for one organization or all, such as after a
 * workspace adds its own emoji. Each server instance keeps its own cache, so a change can take up to a minute to reach
 * the others.
 */
async function forgetEmojis(config: Config, context: Context): Promise<void> {
  const { orgId } = context.input as { orgId?: string | null }
  for (const settings of Object.values(config)) {
    settings.emojisFor.forget(orgId === undefined ? undefined : (orgId ?? ""))
  }
}

/** Someone a live updates feature sends events to, with the request they connected with. */
export interface LiveViewer {
  actor: Actor | null
  /** Their request, so a grant it carries, such as a share link, shows them the record, but not who reacted. */
  request?: Request | null | undefined
}

/**
 * Turns a server event into what each viewer's browser may see, for a live updates feature: `null` for other events and
 * for viewers who can't see the record, and no user id for viewers who may not see who reacted. Access is checked for
 * all the viewers at once, with one `canViewMany` call by the app's rules and one for the grants their requests carry.
 */
async function clientEvents(
  config: Config,
  context: Context,
  event: BetterAppsEvent,
  viewers: readonly LiveViewer[]
): Promise<(ClientReactionEvent | null)[]> {
  const none = viewers.map(() => null)
  const record = event.type === "subject.changed" || event.type === "subject.moved"
  if (
    event.feature !== "reactions" ||
    (!record && event.type !== "reaction.added" && event.type !== "reaction.removed")
  ) {
    return none
  }
  const data = event.data as ReactionEventData & { bulk?: boolean; toOrgId?: string }
  // Removals of many reactions at once reach browsers as one change of their record instead.
  if (
    data.bulk === true ||
    viewers.length === 0 ||
    !Object.hasOwn(config, data.subjectType) ||
    !context.subjects.has(data.subjectType)
  ) {
    return none
  }
  const settings = config[data.subjectType] as Settings
  const ref = { subjectType: data.subjectType, subjectId: data.subjectId }
  const signedIn = viewers.find((viewer) => viewer.actor !== null)?.actor ?? null
  // A moved record's event is for viewers in its new organization, and a reaction's for those in the reaction's own.
  const orgId = await orgOf(context.subjects, ref, signedIn)
  const expected = event.type === "subject.moved" ? data.toOrgId : data.orgId
  if (event.type !== "subject.changed" && orgId !== expected) {
    return none
  }
  const members = await context.subjects.canViewMany(viewers.map(({ actor }) => ({ ...ref, actor })))
  // A viewer's request may carry a grant, such as a share link, that shows them the record too, but not who reacted.
  const askable = viewers.flatMap((viewer, index) => (!members[index] && viewer.request ? [index] : []))
  const granted = await context.subjects.canViewMany(
    askable.map((index) => ({ ...ref, actor: viewers[index]?.actor ?? null, request: viewers[index]?.request }))
  )
  const visible = [...members]
  for (const [position, index] of askable.entries()) {
    visible[index] = granted[position] === true
  }
  if (record) {
    return visible.map((shown) => (shown ? { id: event.id, type: "subject.changed" as const, ...ref } : null))
  }
  const { canModerate } = settings.rules
  return Promise.all(
    viewers.map(async ({ actor: viewer }, index) => {
      if (!visible[index]) {
        return null
      }
      const mine = viewer !== null && viewer.userId === data.userId
      // Only people who see the record by the app's rules are its viewers, and only they can moderate it.
      const member = viewer !== null && members[index] === true
      const named =
        mine ||
        settings.reactorVisibility === "public" ||
        (member && settings.reactorVisibility === "viewers") ||
        (member && canModerate !== undefined && (await canModerate({ actor: viewer, ...ref })))
      return {
        id: event.id,
        type: event.type as ClientReactionChange["type"],
        ...ref,
        userId: named ? data.userId : "",
        emoji: data.emoji,
        ...(data.count === undefined ? {} : { count: data.count }),
        mine
      }
    })
  )
}

async function toClientEvent(config: Config, context: Context): Promise<ClientReactionEvent | null> {
  const { event, viewer, request } = context.input as {
    event: BetterAppsEvent
    viewer: Actor | null
    request?: Request | null | undefined
  }
  const [shown] = await clientEvents(config, context, event, [{ actor: viewer, request }])
  return shown ?? null
}

async function toClientEvents(config: Config, context: Context): Promise<(ClientReactionEvent | null)[]> {
  const { event, viewers } = context.input as { event: BetterAppsEvent; viewers: readonly LiveViewer[] }
  return clientEvents(config, context, event, viewers)
}

/**
 * Cleans up after comments when reactions are set up on its threads or comments: a deleted comment or thread loses its
 * reactions, and a thread that moves to another organization takes them along. Each runs a few pages per delivery and
 * continues in later runs, so a thread of any size fits in a request.
 */
function commentHandlers(config: Config): Record<string, EventHandler> | null {
  const withReactions = (type: string) => Object.hasOwn(config, type)
  if (!withReactions(commentTypes.thread) && !withReactions(commentTypes.comment)) {
    return null
  }
  type ThreadData = { thread: { id: string; orgId: string }; commentIds?: string[] }
  // The thread and its comments, for the subject types reactions are set up on.
  const threadRecords = (threadIds: string[], commentIds: string[]): Cleanup["records"] =>
    [
      { subjectType: commentTypes.thread, subjectIds: threadIds },
      { subjectType: commentTypes.comment, subjectIds: commentIds }
    ].filter((record) => withReactions(record.subjectType))
  return {
    "comment.deleted": async (event, context) => {
      const { comment } = event.data as { comment: { id: string } }
      await cleanUp(config, context, { records: threadRecords([], [comment.id]) })
    },
    "thread.deleted": async (event, context) => {
      const data = event.data as ThreadData
      await cleanUp(config, context, { records: threadRecords([data.thread.id], data.commentIds ?? []) })
    },
    "thread.moved": async (event, context) => {
      const data = event.data as ThreadData
      await cleanUp(config, context, {
        records: threadRecords([data.thread.id], data.commentIds ?? []),
        toOrgId: data.thread.orgId
      })
    }
  }
}

/**
 * Emoji reactions on records the app owns, one per person per emoji. Set up at least one subject type, such as an app's
 * `invoice` or comments' `comments.comment`; whoever can see a record sees its reactions.
 */
export function reactions<const Options extends ReactionsOptions>(options: Options) {
  type Types = TypesOf<Options>
  const config = resolve(options)
  // `serverOnly` keeps its literal type, so the browser client leaves server-only actions out.
  const action = <Input, Output, ServerOnly extends boolean = false>(
    schema: StandardSchemaV1 | null,
    run: (config: Config, context: Context) => Promise<Output>,
    serverOnly?: ServerOnly
  ) =>
    defineAction<StandardSchemaV1<Input, Input>, Output, ServerOnly>({
      input: (schema ?? unchecked<Input>()) as StandardSchemaV1<Input, Input>,
      serverOnly,
      handler: async (context) => run(config, context as Context)
    })
  const serverAction = <Input, Output>(
    schema: StandardSchemaV1 | null,
    run: (config: Config, context: Context) => Promise<Output>
  ) => action<Input, Output, true>(schema, run, true)
  const comments = commentHandlers(config)

  return defineFeature({
    id: "reactions",
    schema: reactionsSchema,
    events: reactionEvents,
    usesSubjects: Object.keys(options.subjects),
    // Subscribing makes the app keep an outbox table, so reactions only subscribe when comments' records have them.
    // Cleanups after comments continue in later delivery runs through reactions' own event.
    on: comments
      ? {
          comments,
          reactions: { "cleanup.continued": (event, context) => cleanUp(config, context, event.data as Cleanup) }
        }
      : undefined,
    options,
    actions: {
      listReactions: action<ListReactionsInput<Types["subjectType"]>, Record<string, ReactionSummary[]>>(
        inputs.listReactions,
        listReactions
      ),
      listReactors: action<ListReactorsInput<Types>, ReactorPage>(inputs.listReactors, listReactors),
      getSettings: action<ReactionSubject<Types["subjectType"]>, ReactionSettings>(inputs.subject, getSettings),
      react: action<ReactionTarget<Types>, ReactResult>(inputs.target, react),
      unreact: action<ReactionTarget<Types>, UnreactResult>(inputs.target, unreact),
      removeReactions: action<ReactionFilter<Types>, { removed: number } & BulkStep>(inputs.filter, removeReactions),
      removeSubject: serverAction<ReactionSubject<Types["subjectType"]>, { removed: number } & BulkStep>(
        inputs.subject,
        removeSubject
      ),
      moveSubject: serverAction<
        ReactionSubject<Types["subjectType"]> & { toOrgId: string | null },
        { moved: number } & BulkStep
      >(inputs.moveSubject, moveSubject),
      removeUser: serverAction<{ userId: string; orgId?: string | null | undefined }, { removed: number } & BulkStep>(
        inputs.removeUser,
        removeUser
      ),
      toClientEvent: serverAction<
        { event: BetterAppsEvent; viewer: Actor | null; request?: Request | null | undefined },
        ClientReactionEvent | null
      >(null, toClientEvent),
      forgetEmojis: serverAction<{ orgId?: string | null | undefined }, void>(inputs.forgetEmojis, forgetEmojis),
      toClientEvents: serverAction<
        { event: BetterAppsEvent; viewers: readonly LiveViewer[] },
        (ClientReactionEvent | null)[]
      >(null, toClientEvents)
    }
  })
}

const unchecked = <Input>(): StandardSchemaV1<Input, Input> => ({
  "~standard": { version: 1, vendor: "better-apps", validate: (value) => ({ value: value as Input }) }
})

/** The reactions feature as `reactions()` returns it. */
export type ReactionsFeature<Options extends ReactionsOptions = ReactionsOptions> = ReturnType<
  typeof reactions<Options>
>
