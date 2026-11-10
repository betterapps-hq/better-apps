// Bulk jobs: the sweep of expired and deleted files, removing and moving a record's files, removing a person's files, and
// following comments' threads and comments. Each call or delivery does one page, so no request outgrows D1's limits.
import type { EventHandler, SubjectRef, WriteOperation } from "better-apps"
import { chunks, orgsOf, userOwner, type Context } from "./access.js"
import { settingsOf, type Config } from "./config.js"
import { eventFile } from "./present.js"
import {
  deleteFiles,
  filesById,
  lateUploadMs,
  linkRemoval,
  markDeleted,
  purge,
  remember,
  removalPage,
  removeLinks,
  retried,
  settleMs,
  type BulkStep,
  type Writer
} from "./removals.js"
import {
  attachmentModel,
  fileModel,
  moveModel,
  type Attachment,
  type AttachmentFile,
  type AttachmentMove
} from "./schema.js"

/**
 * How many attachments one page of a move takes. Each takes its own update statement, so a page stays under D1's 50
 * queries a request on its free plan.
 */
const movePageSize = 30
/** How many of a person's files one call of `removeUser` deletes, with the records each is on. */
const userPageSize = 20
/** How many lists of ids one delivery of a removal cleanup reads looking for attachments. */
const cleanupReads = 10
/** How many batches of removals one delivery of a cleanup writes. */
const cleanupBatches = 3
/**
 * One delivery of a move cleanup's share: up to 20 attachments, reading at most five lists of ids, in one batch, tried
 * once, so a failed batch leaves its page for the next run rather than reading it again. Taking the turn takes five
 * queries, or checking it two. A batch of r attachments, w of them withdrawn, takes three lookups, two statements that
 * hold the turn, four for withdrawn attachments, an update for each that moves, one for the files' organization, and an
 * insert per eight of its events: a `subject.moved` per record that moves, and an `attachment.removed`,
 * `subject.changed` and `file.deleted` per withdrawn one, so r + 2w events. Then one more: the withdrawn files' rows, or
 * a read of a lost turn. Without withdrawn attachments, their files' lookup and those four statements go, so the most is
 * with one: 10 + r + (r + 2) / 8, rounded up, so 33. With the outbox's own three, that's at most 46 queries, under D1's
 * 50 per request on its free plan. A second batch would add a dozen more, so a delivery writes one.
 */
const moveCleanup = { room: 20, reads: 5, batches: 1 } as const
/** How long a record's move row is kept after a move last wrote it, which only needs to outlast moves under way. */
const moveMemoryMs = 30 * 24 * 60 * 60_000

/** What the sweep removed, and whether there's more. */
export interface SweepResult extends BulkStep {
  removed: number
}

/**
 * Removes expired uploads and drafts, and the rows of deleted files once their upload address closed, deleting their
 * bytes again in case some arrived late or failed to go. Expired files are marked `deleted` in one batch with their
 * `file.deleted` events, so a file is never deleted without its event, and bytes are touched only after. The batch
 * remembers the files, so it fails, with its events, when another removal took one of them first, and the page is read
 * again. Files wait `settleMs` past their expiry, so an attach or a `completeUpload` that read one in time has finished.
 */
export async function sweep(config: Config, writer: Writer): Promise<SweepResult> {
  const { db } = writer
  return retried(async () => {
    const now = Date.now()
    const leftovers = await db.findMany<AttachmentFile>({
      model: fileModel,
      where: [
        { field: "status", value: "deleted" },
        { field: "uploadClosesAt", operator: "lt", value: new Date(now - lateUploadMs) }
      ],
      limit: removalPage
    })
    const settled = new Date(now - settleMs)
    const expired =
      leftovers.length < removalPage
        ? await db.findMany<AttachmentFile>({
            model: fileModel,
            where: [
              { field: "status", operator: "in", value: ["pending", "ready"] },
              { field: "expiresAt", operator: "lt", value: settled }
            ],
            sortBy: { field: "expiresAt", direction: "asc" },
            limit: removalPage - leftovers.length
          })
        : []
    let marked = expired
    if (expired.length > 0) {
      for (const file of expired) {
        if (file.status === "ready") {
          writer.emit("file.deleted", { file: eventFile(file), reason: "expired" })
        }
      }
      const marking = markDeleted(expired, [
        { field: "status", operator: "in", value: ["pending", "ready"] },
        { field: "expiresAt", operator: "lt", value: settled }
      ])
      const results = await db.batch([...marking, ...remember(expired.map((file) => file.id))])
      const count = results.slice(0, marking.length).reduce<number>((sum, result) => sum + Number(result), 0)
      if (count < expired.length) {
        // Only a request that outlasted `settleMs` could get here. Its file keeps its bytes.
        const after = await filesById(
          db,
          expired.map((file) => file.id)
        )
        marked = expired.filter((file) => after.get(file.id)?.status === "deleted")
      }
    }
    const gone = [...leftovers, ...marked]
    await purge(config, db, gone)
    return { removed: gone.length, done: leftovers.length + expired.length < removalPage }
  })
}

/**
 * Finds a page of attachments on some records of one subject type, reading at most `maxReads` lists of ids. Each record's
 * come in its order, record by record, so a move that takes several pages keeps the order.
 */
async function pageOf(
  db: Context["db"],
  subjectType: string,
  subjectIds: readonly string[],
  limit: number,
  { notOrgId, maxReads = Infinity }: { notOrgId?: string | undefined; maxReads?: number } = {}
): Promise<{ rows: Attachment[]; rest: string[]; reads: number }> {
  const ids = [...new Set(subjectIds)]
  const rows: Attachment[] = []
  let reads = 0
  for (const [index, list] of chunks(ids).entries()) {
    if (reads >= maxReads) {
      return { rows, rest: ids.slice(index * 90), reads }
    }
    reads += 1
    rows.push(
      ...(await db.findMany<Attachment>({
        model: attachmentModel,
        where: [
          { field: "subjectType", value: subjectType },
          { field: "subjectId", operator: "in", value: list },
          ...(notOrgId === undefined ? [] : [{ field: "orgId", operator: "ne" as const, value: notOrgId }])
        ],
        sortBy: [
          { field: "subjectId", direction: "asc" },
          { field: "position", direction: "asc" },
          { field: "id", direction: "asc" }
        ],
        limit: limit - rows.length
      }))
    )
    if (rows.length >= limit) {
      // This list may hold more, so it's read again next time; lists before it are done.
      return { rows, rest: ids.slice(index * 90), reads }
    }
  }
  return { rows, rest: [], reads }
}

/** Removes a page of attachments `find` returns, marked `bulk`. */
async function removePage(
  config: Config,
  writer: Writer,
  find: (limit: number) => Promise<Attachment[]>
): Promise<{ removed: number } & BulkStep> {
  return retried(async () => {
    const rows = await find(removalPage)
    await removeLinks(config, writer, rows, "subjectRemoved", { bulk: true })
    return { removed: rows.length, done: rows.length < removalPage }
  })
}

/** The lowest free places on a record, for attachments that move or are added there. */
export function freeSlots(taken: ReadonlySet<number>, maxFiles: number, wanted: number): number[] {
  const free: number[] = []
  for (let slot = 0; slot < maxFiles && free.length < wanted; slot += 1) {
    if (!taken.has(slot)) {
      free.push(slot)
    }
  }
  return free
}

/**
 * Moves a page of a record's attachments to another organization. One that's already there, or has no free place there,
 * is removed as `withdrawn`. The files the record keeps move with it. Each record the page touched gets `subject.moved`,
 * written with the page. A job that follows another record's move, such as a thread's, is given that move's turn, and its
 * page is tried once, so a delivery stays within its share of queries. When the page's batch fails, it reports `again` while
 * the move still holds the turn, for the next run to read the page again, or `superseded` once a newer move or the
 * record's deletion has taken it. Without a turn, a failed page is read again, up to three times.
 */
async function movePage(
  config: Config,
  writer: Writer,
  subjectType: string,
  find: (limit: number) => Promise<Attachment[]>,
  toOrgId: string,
  turn?: Turn
): Promise<MoveStep> {
  const { db } = writer
  const settings = settingsOf(config, subjectType)
  const page = async (): Promise<MoveStep> => {
    const rows = await find(movePageSize)
    if (rows.length === 0) {
      return { moved: 0, done: true }
    }
    const subjectIds = [...new Set(rows.map((row) => row.subjectId))]
    const there = (
      await Promise.all(
        chunks(subjectIds).map(async (ids) =>
          db.findMany<Attachment>({
            model: attachmentModel,
            where: [
              { field: "subjectType", value: subjectType },
              { field: "subjectId", operator: "in", value: ids },
              { field: "orgId", value: toOrgId }
            ]
          })
        )
      )
    ).flat()
    const moves: { row: Attachment; slot: number; position: number }[] = []
    const dropped: Attachment[] = []
    for (const subjectId of subjectIds) {
      const existing = there.filter((row) => row.subjectId === subjectId)
      const files = new Set(existing.map((row) => row.fileId))
      const incoming = rows.filter((row) => row.subjectId === subjectId)
      const slots = freeSlots(new Set(existing.map((row) => row.slot)), settings.maxFiles, incoming.length)
      let position = Math.max(-1, ...existing.map((row) => row.position)) + 1
      for (const row of incoming) {
        const slot = files.has(row.fileId) ? undefined : slots.shift()
        if (slot === undefined) {
          dropped.push(row)
        } else {
          files.add(row.fileId)
          moves.push({ row, slot, position })
          position += 1
        }
      }
    }
    const removal = await linkRemoval(writer, dropped, "withdrawn", { bulk: true })
    const files =
      moves.length === 0
        ? []
        : await db.findMany<AttachmentFile>({
            model: fileModel,
            where: [{ field: "id", operator: "in", value: [...new Set(moves.map((move) => move.row.fileId))] }],
            select: ["id", "owner"]
          })
    const kept = files.filter((file) => file.owner === null).map((file) => file.id)
    for (const subjectId of new Set(moves.map((move) => move.row.subjectId))) {
      writer.emit("subject.moved", { subjectType, subjectId, toOrgId })
    }
    // A job's batch holds its record's turn, so it fails with its events, and the job stops, once a newer move or
    // deletion has taken it. The withdrawn attachments and the files' new organization go in the same batch, so a
    // stopped page writes none of them.
    const held = turn ? holdTurn(turn) : []
    const writes = [
      ...held,
      ...removal.writes,
      ...moves.map(({ row, slot, position }): WriteOperation => ({
        type: "update",
        model: attachmentModel,
        where: [
          { field: "id", value: row.id },
          { field: "orgId", value: row.orgId }
        ],
        update: { orgId: toOrgId, slot, position }
      })),
      ...chunks(kept).map((ids): WriteOperation => ({
        type: "updateMany",
        model: fileModel,
        where: [{ field: "id", operator: "in", value: ids }],
        update: { orgId: toOrgId }
      }))
    ]
    try {
      await db.batch(writes)
    } catch (error) {
      if (!turn) {
        throw error
      }
      return (await hasTurn(db, turn))
        ? { moved: 0, done: false, again: true }
        : { moved: 0, done: true, superseded: true }
    }
    await purge(config, db, removal.doomed)
    return { moved: moves.length, done: rows.length < movePageSize }
  }
  return turn ? page() : retried(page)
}

/** One page of a move: what it moved, and whether a job's page should wait for the next run or stop. */
type MoveStep = { moved: number; superseded?: boolean; again?: boolean } & BulkStep

/** A move of a record that attachments follow: the record, and the organization it took the record to. */
interface Turn {
  subject: SubjectRef
  toOrgId: string
}

const turnId = (ref: SubjectRef) => JSON.stringify([ref.subjectType, ref.subjectId])

const findTurn = async (db: Context["db"], subject: SubjectRef) =>
  db.findOne<AttachmentMove>({ model: moveModel, where: [{ field: "id", value: turnId(subject) }] })

/** Whether a move still holds its record's turn: the record isn't deleted, and no move elsewhere has taken it since. */
async function hasTurn(db: Context["db"], turn: Turn): Promise<boolean> {
  const row = await findTurn(db, turn.subject)
  return row !== null && !row.deleted && row.toOrgId === turn.toOrgId
}

/** Writes a record's turn row, with a new claim. */
const turnRow = (subject: SubjectRef, toOrgId: string, deleted: boolean): WriteOperation => ({
  type: "create",
  model: moveModel,
  data: { id: turnId(subject), toOrgId, deleted, claim: crypto.randomUUID(), heldAt: new Date() }
})

/** Deletes a record's turn row only while it's the claim that was read, so a claim made since fails the batch. */
const releaseClaim = (subject: SubjectRef, row: Pick<AttachmentMove, "claim">): WriteOperation => ({
  type: "deleteMany",
  model: moveModel,
  where: [
    { field: "id", value: turnId(subject) },
    { field: "claim", value: row.claim }
  ]
})

/** Clears rows nothing has written for `moveMemoryMs`, other than the given record's. */
const pruneTurns = (subject: SubjectRef): WriteOperation => ({
  type: "deleteMany",
  model: moveModel,
  where: [
    { field: "heldAt", operator: "lt", value: new Date(Date.now() - moveMemoryMs) },
    { field: "id", operator: "ne", value: turnId(subject) }
  ]
})

/**
 * Writes that fail their batch unless a move still holds its record's turn: its row is deleted while it names the move's
 * organization and isn't deleted, and written again. Once another move or the record's deletion has replaced it, the
 * delete matches nothing and the write runs into the newer row.
 */
function holdTurn(turn: Turn): WriteOperation[] {
  return [
    {
      type: "deleteMany",
      model: moveModel,
      where: [
        { field: "id", value: turnId(turn.subject) },
        { field: "toOrgId", value: turn.toOrgId },
        { field: "deleted", value: false }
      ]
    },
    turnRow(turn.subject, turn.toOrgId, false)
  ]
}

/**
 * Takes a record's turn for a move, and returns whether it holds it. Only a move to where the record is now takes it,
 * since the move that committed last is the one that put it there, whenever its event was emitted or arrives; a move
 * whose record has moved on, or was deleted, takes none. Each claim writes the row again with a new `claim`, and only
 * while the row is still the one it read, so a claim that read the row before another move's claim or the record's
 * deletion fails, its delivery is retried, and it reads the record's organization again. Two moves to the same
 * organization share the turn, since a page holds it by organization.
 */
async function takeTurn(db: Context["db"], subjects: Context["subjects"], turn: Turn): Promise<boolean> {
  const [row, [orgId]] = await Promise.all([findTurn(db, turn.subject), orgsOf(subjects, [turn.subject], null)])
  if (row?.deleted === true || orgId !== turn.toOrgId) {
    return false
  }
  await db.batch([
    ...(row ? [releaseClaim(turn.subject, row)] : []),
    turnRow(turn.subject, turn.toOrgId, false),
    pruneTurns(turn.subject)
  ])
  return true
}

/**
 * Marks a record deleted, which stops any move of it, including one to no organization, until the row is cleared after
 * `moveMemoryMs`.
 */
async function endTurns(db: Context["db"], subject: SubjectRef): Promise<void> {
  await db.batch([
    { type: "deleteMany", model: moveModel, where: [{ field: "id", value: turnId(subject) }] },
    turnRow(subject, "", true),
    pruneTurns(subject)
  ])
}

/** Finds a page of one record's attachments, from every organization or all but one. */
const attachmentsOn =
  (db: Context["db"], subjectType: string, subjectId: string, notOrgId?: string) =>
  async (limit: number): Promise<Attachment[]> =>
    (await pageOf(db, subjectType, [subjectId], limit, { notOrgId })).rows

/** Takes every file off a deleted record, a page a call, deleting the files it kept. */
export async function removeSubject(config: Config, context: Context): Promise<{ removed: number } & BulkStep> {
  const input = context.input as { subjectType: string; subjectId: string }
  settingsOf(config, input.subjectType)
  const step = await removePage(config, context, attachmentsOn(context.db, input.subjectType, input.subjectId))
  if (step.done) {
    context.emit("subject.removed", { subjectType: input.subjectType, subjectId: input.subjectId })
  }
  return step
}

/** Moves a record's attachments to the organization it moved to, a page a call. */
export async function moveSubject(config: Config, context: Context): Promise<{ moved: number } & BulkStep> {
  const input = context.input as { subjectType: string; subjectId: string; toOrgId: string | null }
  const toOrgId = input.toOrgId ?? ""
  return movePage(
    config,
    context,
    input.subjectType,
    attachmentsOn(context.db, input.subjectType, input.subjectId, toOrgId),
    toOrgId
  )
}

/** Deletes a person's own files, drafts and unfinished uploads, a page a call. Files they attached to records stay. */
export async function removeUser(config: Config, context: Context): Promise<{ removed: number } & BulkStep> {
  const { userId } = context.input as { userId: string }
  const { db } = context
  return retried(async () => {
    const owned = await db.findMany<AttachmentFile>({
      model: fileModel,
      where: [
        { field: "owner", value: userOwner(userId) },
        { field: "status", operator: "ne", value: "deleted" }
      ],
      limit: userPageSize
    })
    const unkept =
      owned.length < userPageSize
        ? await db.findMany<AttachmentFile>({
            model: fileModel,
            where: [
              { field: "createdBy", value: userId },
              { field: "status", operator: "in", value: ["pending", "ready"] },
              { field: "expiresAt", operator: "gt", value: new Date(0) }
            ],
            limit: userPageSize - owned.length
          })
        : []
    // Unfinished uploads include ones for an organization, which only the person could finish. One of their own is
    // in both lists.
    const ownedIds = new Set(owned.map((file) => file.id))
    const files = [...owned, ...unkept.filter((file) => !ownedIds.has(file.id))]
    const removed = await deleteFiles(config, context, files, "userRemoved")
    const done = owned.length + unkept.length < userPageSize
    if (done) {
      context.emit("user.removed", { userId })
    }
    return { removed, done }
  })
}

/**
 * Hands a person's files to another user, such as when an anonymous guest signs up and becomes a new user: the files they
 * keep on their own, their drafts and unfinished uploads, and the attachments they made, so they can still attach their
 * drafts and take their files off records. Each kind moves in one statement, so it takes one call. Returns how many
 * files they uploaded and how many attachments they made.
 */
export async function moveUser(_config: Config, context: Context): Promise<{ files: number; attachments: number }> {
  const { userId, toUserId } = context.input as { userId: string; toUserId: string }
  if (userId === toUserId) {
    return { files: 0, attachments: 0 }
  }
  context.emit("user.moved", { userId, toUserId })
  const [, uploaded, attached] = await context.db.batch([
    {
      type: "updateMany",
      model: fileModel,
      where: [{ field: "owner", value: userOwner(userId) }],
      update: { owner: userOwner(toUserId) }
    },
    {
      type: "updateMany",
      model: fileModel,
      where: [{ field: "createdBy", value: userId }],
      update: { createdBy: toUserId }
    },
    {
      type: "updateMany",
      model: attachmentModel,
      where: [{ field: "createdBy", value: userId }],
      update: { createdBy: toUserId }
    }
  ])
  // Files a person keeps on their own are ones they uploaded, so `files` counts each file once.
  return { files: Number(uploaded), attachments: Number(attached) }
}

/**
 * Records to clean up after, by subject type. For a move, the organization they moved to, and the record whose move
 * they follow, such as a thread for its comments.
 */
export interface Cleanup {
  records: { subjectType: string; subjectIds: string[] }[]
  move?: { toOrgId: string; subject: { subjectType: string; subjectId: string } } | undefined
}

/**
 * Removes or moves the attachments on records that went away or moved, such as comments' threads: one page of them a
 * delivery, reading at most `cleanupReads` lists of ids to find a removal's, or `moveCleanup.reads` to find a move's.
 * What's left continues with a `cleanup.continued` event in the next `app.deliverEvents()` run. Subject types
 * attachments are no longer set up on are skipped. `turnTaken` says the caller just took the move's turn, which checked
 * the record's organization too.
 */
export async function cleanUp(config: Config, writer: Writer, job: Cleanup, turnTaken = false): Promise<void> {
  const toOrgId = job.move?.toOrgId
  const records = job.records.filter(
    (record) => record.subjectIds.length > 0 && Object.hasOwn(config.subjects, record.subjectType)
  )
  const turn = job.move && { subject: job.move.subject, toOrgId: job.move.toOrgId }
  if (turn && !turnTaken && records.length > 0) {
    // A move runs over several deliveries, so the record it follows may have moved again since, or been deleted. A
    // newer move takes the turn once its event arrives, and deletion takes it for good; either stops this one, and so
    // does the record being in another organization, for a newer move whose event hasn't arrived yet, so an older job
    // never undoes a newer move. Each page's batch holds the turn too, for a newer move that arrives while the page
    // runs. Records of its that went away meanwhile, such as a deleted comment, don't stop it: their files go with
    // their own removal.
    const [current, [orgId]] = await Promise.all([
      hasTurn(writer.db, turn),
      orgsOf(writer.subjects, [turn.subject], null)
    ])
    if (!current || orgId !== turn.toOrgId) {
      return
    }
  }
  let room: number = toOrgId === undefined ? removalPage : moveCleanup.room
  let reads: number = toOrgId === undefined ? cleanupReads : moveCleanup.reads
  const maxBatches = toOrgId === undefined ? cleanupBatches : moveCleanup.batches
  for (let batches = 0; batches < maxBatches && room > 0 && reads > 0 && records.length > 0;) {
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
    const step = await (toOrgId === undefined
      ? removePage(config, writer, find)
      : movePage(config, writer, record.subjectType, find, toOrgId, turn))
    if ("superseded" in step && step.superseded === true) {
      return
    }
    if ("again" in step && step.again === true) {
      // The page's batch failed, such as on an attachment that landed meanwhile: the next run reads it again.
      break
    }
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

/** The subject types comments declares for its own records, which attachments clean up after. */
const commentTypes = { thread: "comments.thread", comment: "comments.comment" } as const

/**
 * Cleans up after comments when files can be on its threads or comments: a deleted comment or thread loses its files,
 * and a thread that moves takes them along.
 */
export function commentHandlers(config: Config): Record<string, EventHandler> | null {
  const withFiles = (type: string) => Object.hasOwn(config.subjects, type)
  if (!withFiles(commentTypes.thread) && !withFiles(commentTypes.comment)) {
    return null
  }
  type ThreadData = { thread: { id: string; orgId: string }; commentIds?: string[] }
  const threadRecords = (threadIds: string[], commentIds: string[]): Cleanup["records"] =>
    [
      { subjectType: commentTypes.thread, subjectIds: threadIds },
      { subjectType: commentTypes.comment, subjectIds: commentIds }
    ].filter((record) => withFiles(record.subjectType))
  return {
    "comment.deleted": async (event, context) => {
      const { comment } = event.data as { comment: { id: string } }
      await cleanUp(config, context, { records: threadRecords([], [comment.id]) })
    },
    "thread.deleted": async (event, context) => {
      const data = event.data as ThreadData
      // Stops a move of the thread that's still running, even one to no organization, which can't tell a deleted thread
      // from one without an organization.
      await endTurns(context.db, { subjectType: commentTypes.thread, subjectId: data.thread.id })
      await cleanUp(config, context, { records: threadRecords([data.thread.id], data.commentIds ?? []) })
    },
    "thread.moved": async (event, context) => {
      const data = event.data as ThreadData
      const subject = { subjectType: commentTypes.thread, subjectId: data.thread.id }
      if (!(await takeTurn(context.db, context.subjects, { subject, toOrgId: data.thread.orgId }))) {
        return
      }
      await cleanUp(
        config,
        context,
        {
          records: threadRecords([data.thread.id], data.commentIds ?? []),
          move: { toOrgId: data.thread.orgId, subject }
        },
        true
      )
    }
  }
}
