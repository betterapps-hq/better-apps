import {
  BetterAppsError,
  defineAction,
  defineFeature,
  type BetterAppsEvent,
  type DatabaseAdapter,
  type EventHandler,
  type FeatureSchema,
  type IdentityUser,
  type Where
} from "better-apps"
import { z } from "zod"
import { parseMentions, truncateText } from "./tokens.js"

/** The model of the mentions table. */
export const mentionModel = "mention"

/** One user mentioned in one record, such as a comment. */
export type Mention = {
  id: string
  /** The organization of the record, or `""` when the app has none. */
  orgId: string
  /** The user mentioned. */
  userId: string
  /** The user who wrote the mention, or `null` for an external or system author. */
  authorId: string | null
  /** The feature the record belongs to, such as `comments`. */
  feature: string
  /** The record holding the mention, as a subject type, so access follows the record's. */
  subjectType: string
  subjectId: string
  /** What the record belongs to, such as its thread, for opening it and for removing a group at once. */
  groupId: string | null
  /** The record's text when it was written or last edited, up to 280 characters, with mentions as tokens. */
  excerpt: string | null
  createdAt: Date
}

/** A mention a source adds. */
export interface NewMention {
  userId: string
  orgId: string | null
  authorId?: string | null | undefined
  subjectType: string
  subjectId: string
  groupId?: string | null | undefined
  excerpt?: string | null | undefined
  /** The default is when the event happened. */
  createdAt?: Date | undefined
}

/** What one event changes in the mentions table. */
export interface MentionChanges {
  /** Mentions to add. Adding one that exists already does nothing, so redelivered events are safe. */
  add?: readonly NewMention[] | undefined
  /** Records that changed: users they no longer mention are removed, and the rest get the new excerpt. */
  edit?:
    | readonly {
        subjectType: string
        subjectId: string
        keep: readonly string[]
        excerpt?: string | null | undefined
      }[]
    | undefined
  /** Records whose mentions are all removed, such as deleted comments. */
  remove?: readonly { subjectType: string; subjectId: string }[] | undefined
  /** Groups whose mentions are all removed, such as deleted threads. */
  removeGroups?: readonly string[] | undefined
  /** Users whose mentions, made or received, are all removed. */
  removeUsers?: readonly string[] | undefined
}

/**
 * Turns one feature's events into mentions, such as comments' `commentMentions`. Features that mention people export a
 * source, so the mentions feature never imports them.
 */
export interface MentionSource {
  /** The feature whose events it reads, such as `comments`. */
  feature: string
  /** The subject types its mentions are in, which the app or a feature must declare. */
  subjectTypes: readonly string[]
  /** Changes to the mentions table, keyed by event type. Return nothing for an event that changes none. */
  events: Readonly<Record<string, (event: BetterAppsEvent) => MentionChanges | null | undefined>>
}

/** Declares a mention source. */
export function defineMentionSource(source: MentionSource): MentionSource {
  return source
}

/** How mentions are set up in an app. */
export interface MentionsOptions {
  /** Where mentions come from, such as `commentMentions` from `@better-apps/comments`. */
  sources: readonly MentionSource[]
}

/** The input of `listMentions`. */
export interface ListMentionsInput {
  cursor?: string | undefined
  /** 20 by default, at most 50. */
  limit?: number | undefined
}

/** A page of the signed-in user's mentions, newest first, with the users they name. */
export interface MentionPage {
  /** Only mentions in records the user can still see. A page may hold fewer than the limit. */
  mentions: Mention[]
  /** The cursor for the next page, or `null` on the last one. */
  cursor: string | null
  /** Names and avatars by user id, for authors and everyone the excerpts mention. */
  users: Record<string, IdentityUser>
}

const excerptLength = 280

/** The mentions table. */
export const mentionsSchema: FeatureSchema = {
  [mentionModel]: {
    fields: {
      orgId: { type: "string", defaultValue: "" },
      userId: { type: "string" },
      authorId: { type: "string", required: false },
      feature: { type: "string" },
      subjectType: { type: "string" },
      subjectId: { type: "string" },
      groupId: { type: "string", required: false },
      excerpt: { type: "string", required: false },
      createdAt: { type: "date" }
    },
    indexes: [
      { fields: ["userId", "orgId", "createdAt"], name: "mention_by_user" },
      { fields: ["subjectType", "subjectId", "userId"], name: "mention_by_subject", unique: true },
      { fields: ["feature", "groupId"], name: "mention_by_group" }
    ]
  }
}

/** Splits ids into lists of at most 90, under D1's limit of 100 bound parameters. */
function chunks<Item>(items: readonly Item[], size = 90): Item[][] {
  const lists: Item[][] = []
  for (let start = 0; start < items.length; start += size) {
    lists.push(items.slice(start, start + size))
  }
  return lists
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
  throw new BetterAppsError("INVALID_INPUT", "That page cursor isn't valid.")
}

const excerptOf = (text: string | null | undefined) => (text ? truncateText(text, excerptLength) : null)

async function addMention(db: DatabaseAdapter, feature: string, mention: NewMention, at: Date): Promise<void> {
  const where: Where[] = [
    { field: "subjectType", value: mention.subjectType },
    { field: "subjectId", value: mention.subjectId },
    { field: "userId", value: mention.userId }
  ]
  if (await db.findOne({ model: mentionModel, where })) {
    return
  }
  try {
    await db.create({
      model: mentionModel,
      data: {
        orgId: mention.orgId ?? "",
        userId: mention.userId,
        authorId: mention.authorId ?? null,
        feature,
        subjectType: mention.subjectType,
        subjectId: mention.subjectId,
        groupId: mention.groupId ?? null,
        excerpt: excerptOf(mention.excerpt),
        createdAt: mention.createdAt ?? at
      }
    })
  } catch (error) {
    // Another delivery of the same event added it first.
    if (!(await db.findOne({ model: mentionModel, where }))) {
      throw error
    }
  }
}

async function applyChanges(db: DatabaseAdapter, feature: string, changes: MentionChanges, at: Date): Promise<void> {
  for (const mention of changes.add ?? []) {
    await addMention(db, feature, mention, at)
  }
  for (const { subjectType, subjectId, keep, excerpt } of changes.edit ?? []) {
    const record: Where[] = [
      { field: "subjectType", value: subjectType },
      { field: "subjectId", value: subjectId }
    ]
    const dropped: Where[] =
      keep.length === 0 ? record : [...record, { field: "userId", operator: "not_in", value: [...keep] }]
    await db.deleteMany({ model: mentionModel, where: dropped })
    if (excerpt !== undefined) {
      await db.updateMany({ model: mentionModel, where: record, update: { excerpt: excerptOf(excerpt) } })
    }
  }
  for (const { subjectType, subjectId } of changes.remove ?? []) {
    await db.deleteMany({
      model: mentionModel,
      where: [
        { field: "subjectType", value: subjectType },
        { field: "subjectId", value: subjectId }
      ]
    })
  }
  for (const groups of chunks(changes.removeGroups ?? [])) {
    await db.deleteMany({
      model: mentionModel,
      where: [
        { field: "feature", value: feature },
        { field: "groupId", operator: "in", value: groups }
      ]
    })
  }
  for (const users of chunks(changes.removeUsers ?? [])) {
    for (const field of ["userId", "authorId"]) {
      await db.deleteMany({
        model: mentionModel,
        where: [
          { field: "feature", value: feature },
          { field, operator: "in", value: users }
        ]
      })
    }
  }
}

/** Handlers for every source's events, keyed by the emitting feature, then the event type. */
function handlersOf(sources: readonly MentionSource[]) {
  const on: Record<string, Record<string, EventHandler>> = {}
  for (const source of sources) {
    for (const [type, toChanges] of Object.entries(source.events)) {
      const handlers = (on[source.feature] ??= {})
      const previous = handlers[type]
      handlers[type] = async (event, context) => {
        await previous?.(event, context)
        const changes = toChanges(event)
        if (changes) {
          await applyChanges(context.db, source.feature, changes, event.createdAt)
        }
      }
    }
  }
  return on
}

const listInput = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(50).optional()
  })
  .optional()

/**
 * Who was mentioned where, so a user can list their mentions, such as in an inbox. Sources from other features fill
 * it from their events; it checks access when listing, so mentions in records a user can no longer see stay hidden.
 */
export function mentions(options: MentionsOptions) {
  return defineFeature({
    id: "mentions",
    schema: mentionsSchema,
    on: handlersOf(options.sources),
    usesSubjects: [...new Set(options.sources.flatMap((source) => source.subjectTypes))],
    options,
    actions: {
      listMentions: defineAction({
        input: listInput,
        handler: async ({ input, actor, db, subjects, identity }): Promise<MentionPage> => {
          if (!actor) {
            throw new BetterAppsError("UNAUTHENTICATED", "Sign in to see your mentions.")
          }
          const limit = input?.limit ?? 20
          const after = input?.cursor === undefined ? undefined : decodeCursor(input.cursor)
          const rows = await db.findMany<Mention>({
            model: mentionModel,
            where: [
              { field: "userId", value: actor.userId },
              { field: "orgId", value: actor.orgId ?? "" }
            ],
            sortBy: [
              { field: "createdAt", direction: "desc" },
              { field: "id", direction: "desc" }
            ],
            after: after && { createdAt: after.time, id: after.id },
            limit: limit + 1
          })
          const page = rows.slice(0, limit)
          const last = page.at(-1)
          const cursor = rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null
          // Mentions in subject types nobody declares any more, such as a removed source's, are skipped.
          const known = page.filter((mention) => subjects.has(mention.subjectType))
          const visible = await subjects.canViewMany(
            known.map(({ subjectType, subjectId }) => ({ actor, subjectType, subjectId }))
          )
          const shown = known.filter((_, index) => visible[index])
          const ids = [
            ...new Set(shown.flatMap((mention) => [mention.authorId ?? "", ...parseMentions(mention.excerpt ?? "")]))
          ].filter((id) => id !== "")
          let users: Record<string, IdentityUser> = {}
          if (identity.getUsers && ids.length > 0) {
            const found = await Promise.all(chunks(ids).map(async (list) => identity.getUsers?.(list) ?? []))
            users = Object.fromEntries(found.flat().map((user) => [user.id, user]))
          }
          return { mentions: shown, cursor, users }
        }
      }),
      removeUser: defineAction({
        input: z.object({ userId: z.string().min(1).max(255) }),
        serverOnly: true,
        handler: async ({ input, db }) => {
          for (const field of ["userId", "authorId"]) {
            await db.deleteMany({ model: mentionModel, where: [{ field, value: input.userId }] })
          }
          return { userId: input.userId }
        }
      })
    }
  })
}

/** The mentions feature as `mentions()` returns it. */
export type MentionsFeature = ReturnType<typeof mentions>
