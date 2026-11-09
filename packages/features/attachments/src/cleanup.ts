// Bulk jobs: the sweep of expired and deleted files, removing and moving a record's files, removing a person's files, and
// following comments' threads and comments. Each call or delivery does one page, so no request outgrows D1's limits.
import type { EventHandler, WriteOperation } from "better-apps"
import { chunks, orgsOf, type Context } from "./access.js"
import { settingsOf, type Config } from "./config.js"
import { eventFile } from "./present.js"
import {
  deleteFiles,
  lateUploadMs,
  purge,
  removalPage,
  removeLinks,
  retried,
  type BulkStep,
  type Writer
} from "./removals.js"
import { attachmentModel, fileModel, type Attachment, type AttachmentFile } from "./schema.js"

/**
 * How many attachments one page of a move takes. Each takes its own update statement, so a page stays under D1's 50
 * queries a request on its free plan.
 */
const movePageSize = 30
/** How many of a person's files one call of `removeUser` deletes, with the records each is on. */
const userPageSize = 20
/** How many lists of ids one delivery of a cleanup reads looking for attachments. */
const cleanupReads = 10
/** How many batches of removals or moves one delivery of a cleanup writes. */
const cleanupBatches = 3

/** What the sweep removed, and whether there's more. */
export interface SweepResult extends BulkStep {
  removed: number
}

/**
 * Removes expired uploads and drafts, and the rows of deleted files once their upload address closed, deleting their
 * bytes again in case some arrived late or failed to go. Expired files are marked with a guard on their expiry, so a
 * draft attached meanwhile is never taken, and read back to see which were.
 */
export async function sweep(config: Config, writer: Writer): Promise<SweepResult> {
  const { db } = writer
  const now = new Date()
  const leftovers = await db.findMany<AttachmentFile>({
    model: fileModel,
    where: [
      { field: "status", value: "deleted" },
      { field: "uploadClosesAt", operator: "lt", value: new Date(now.getTime() - lateUploadMs) }
    ],
    limit: removalPage
  })
  const expired =
    leftovers.length < removalPage
      ? await db.findMany<AttachmentFile>({
          model: fileModel,
          where: [
            { field: "status", operator: "in", value: ["pending", "ready"] },
            { field: "expiresAt", operator: "lt", value: now }
          ],
          sortBy: { field: "expiresAt", direction: "asc" },
          limit: removalPage - leftovers.length
        })
      : []
  let marked: AttachmentFile[] = []
  if (expired.length > 0) {
    await db.batch(
      chunks(expired.map((file) => file.id)).map((ids): WriteOperation => ({
        type: "updateMany",
        model: fileModel,
        where: [
          { field: "id", operator: "in", value: ids },
          { field: "status", operator: "in", value: ["pending", "ready"] },
          { field: "expiresAt", operator: "lt", value: now }
        ],
        update: { status: "deleted" }
      }))
    )
    const deleted = new Set(
      (
        await Promise.all(
          chunks(expired.map((file) => file.id)).map(async (ids) =>
            db.findMany<AttachmentFile>({
              model: fileModel,
              where: [
                { field: "id", operator: "in", value: ids },
                { field: "status", value: "deleted" }
              ],
              select: ["id"]
            })
          )
        )
      )
        .flat()
        .map((file) => file.id)
    )
    marked = expired.filter((file) => deleted.has(file.id))
    for (const file of marked) {
      if (file.status === "ready") {
        writer.emit("file.deleted", { file: eventFile(file), reason: "expired" })
      }
    }
  }
  const gone = [...leftovers, ...marked]
  await purge(config, db, gone)
  return { removed: gone.length, done: leftovers.length + expired.length < removalPage }
}

/** Finds a page of attachments on some records of one subject type, reading at most `maxReads` lists of ids. */
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
 * written with the page.
 */
async function movePage(
  config: Config,
  writer: Writer,
  subjectType: string,
  find: (limit: number) => Promise<Attachment[]>,
  toOrgId: string
): Promise<{ moved: number } & BulkStep> {
  const { db } = writer
  const settings = settingsOf(config, subjectType)
  return retried(async () => {
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
    if (dropped.length > 0) {
      await removeLinks(config, writer, dropped, "withdrawn", { bulk: true })
    }
    if (moves.length === 0) {
      return { moved: 0, done: rows.length < movePageSize }
    }
    const files = await db.findMany<AttachmentFile>({
      model: fileModel,
      where: [{ field: "id", operator: "in", value: [...new Set(moves.map((move) => move.row.fileId))] }],
      select: ["id", "owner"]
    })
    const kept = files.filter((file) => file.owner === null).map((file) => file.id)
    for (const subjectId of new Set(moves.map((move) => move.row.subjectId))) {
      writer.emit("subject.moved", { subjectType, subjectId, toOrgId })
    }
    await db.batch([
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
    ])
    return { moved: moves.length, done: rows.length < movePageSize }
  })
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
        { field: "owner", value: `user:${userId}` },
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
    const files = [...owned, ...unkept.filter((file) => file.owner === null)]
    await deleteFiles(config, context, files, "userRemoved")
    const done = owned.length + unkept.length < userPageSize
    if (done) {
      context.emit("user.removed", { userId })
    }
    return { removed: files.length, done }
  })
}

/** Records to clean up after, by subject type, and the organization they moved to, when they moved. */
export interface Cleanup {
  records: { subjectType: string; subjectIds: string[] }[]
  toOrgId?: string | undefined
}

/**
 * Removes or moves the attachments on records that went away or moved, such as comments' threads: one page of them a
 * delivery, reading at most `cleanupReads` lists of ids to find it. What's left continues with a `cleanup.continued`
 * event in the next `app.deliverEvents()` run. Subject types attachments are no longer set up on are skipped.
 */
export async function cleanUp(config: Config, writer: Writer, job: Cleanup): Promise<void> {
  const { toOrgId } = job
  const records = job.records.filter(
    (record) => record.subjectIds.length > 0 && Object.hasOwn(config.subjects, record.subjectType)
  )
  if (toOrgId !== undefined && records.length > 0) {
    // A move runs over several deliveries, so its records may have moved again since; one no longer in this job's
    // organization stops it, so an older job never undoes a newer move.
    const orgIds = await orgsOf(
      writer.subjects,
      records.map((record) => ({ subjectType: record.subjectType, subjectId: record.subjectIds[0] as string })),
      null
    )
    if (orgIds.some((orgId) => orgId !== toOrgId)) {
      return
    }
  }
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
      ? removePage(config, writer, find)
      : movePage(config, writer, record.subjectType, find, toOrgId))
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
