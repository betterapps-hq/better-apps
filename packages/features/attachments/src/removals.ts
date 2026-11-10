// Taking files off records and deleting files, for single changes and pages of bulk jobs alike. Rows go first, in one
// batch with their events; bytes go after. Files whose bytes fail to delete stay `deleted`, and the sweep retries them.
import { BetterAppsError, type DatabaseAdapter, type SubjectRef, type Where, type WriteOperation } from "better-apps"
import { chunks, isUnkept, type Context } from "./access.js"
import type { Config } from "./config.js"
import type { AttachmentRemovedData, DetachReason, FileDeletedReason } from "./events.js"
import { eventFile } from "./present.js"
import { attachmentModel, fileModel, removalModel, type Attachment, type AttachmentFile } from "./schema.js"

/** What removals write with: an action's or a subscriber's database, events and subjects. */
export type Writer = Pick<Context, "db" | "emit" | "subjects">

/**
 * How long a request under way may still write what it read, such as an attach that found a draft just before it
 * expired. Removals are remembered this long, and the sweep leaves expired files this long, so neither races one.
 */
export const settleMs = 60 * 60_000

/** How many attachments one page of a bulk job removes, each a few statements per page besides its events. */
export const removalPage = 100

/**
 * How long after an upload's address closes its bytes may still arrive, such as from a slow upload that started in
 * time. A deleted file's row waits this long, so the sweep deletes its bytes again after any late ones landed.
 */
export const lateUploadMs = 60 * 60_000

/** One call of a bulk job: whether it's done, or should be called again. */
export interface BulkStep {
  done: boolean
}

/**
 * Runs one page of a job, reading it again when its batch fails, such as one that lost a race with another removal. The
 * third failure in a row is thrown. Each committed page stays done, so calling again picks up where it stopped.
 */
export async function retried<Output>(page: () => Promise<Output>): Promise<Output> {
  for (let failures = 1; ; failures += 1) {
    try {
      return await page()
    } catch (error) {
      // An error on purpose, such as a full record, won't change on a second read.
      if (failures >= 3 || error instanceof BetterAppsError) {
        throw error
      }
    }
  }
}

/** Files by id, at most 90 a query. */
export async function filesById(db: DatabaseAdapter, ids: readonly string[]): Promise<Map<string, AttachmentFile>> {
  const lists = await Promise.all(
    chunks([...new Set(ids)]).map(async (list) =>
      db.findMany<AttachmentFile>({ model: fileModel, where: [{ field: "id", operator: "in", value: list }] })
    )
  )
  return new Map(lists.flat().map((file) => [file.id, file]))
}

/** The records some attachments are on, once each. */
export function recordsOf(links: readonly Attachment[]): SubjectRef[] {
  const records = new Map(links.map((link) => [JSON.stringify([link.subjectType, link.subjectId]), link]))
  return [...records.values()].map((link) => ({ subjectType: link.subjectType, subjectId: link.subjectId }))
}

/**
 * Remembers removed attachments and deleted files by id, so a batch that removes one another removal already took
 * fails, with its events, rather than reporting it twice. Memories older than `settleMs` go first.
 */
export function remember(ids: readonly string[]): WriteOperation[] {
  if (ids.length === 0) {
    return []
  }
  const now = new Date()
  return [
    {
      type: "deleteMany",
      model: removalModel,
      where: [{ field: "createdAt", operator: "lt", value: new Date(now.getTime() - settleMs) }]
    },
    { type: "createMany", model: removalModel, data: ids.map((id) => ({ id, createdAt: now })) }
  ]
}

/** Deletes attachments, and remembers them and the files marked `deleted` with them. */
function linkRemovals(links: readonly Attachment[], files: readonly AttachmentFile[]): WriteOperation[] {
  return [
    ...chunks(links.map((link) => link.id)).map((ids): WriteOperation => ({
      type: "deleteMany",
      model: attachmentModel,
      where: [{ field: "id", operator: "in", value: ids }]
    })),
    ...remember([...links.map((link) => link.id), ...files.map((file) => file.id)])
  ]
}

/** Marks files `deleted`, so nobody sees them while their bytes go. */
export function markDeleted(files: readonly AttachmentFile[], guard: readonly Where[] = []): WriteOperation[] {
  return chunks(files.map((file) => file.id)).map((ids) => ({
    type: "updateMany",
    model: fileModel,
    where: [{ field: "id", operator: "in", value: ids }, ...guard],
    update: { status: "deleted", expiresAt: null }
  }))
}

/**
 * Deletes files' bytes, then their rows, which takes any attachments left on them along. A row whose upload address
 * closed less than `lateUploadMs` ago stays `deleted`, since a signed address can't be revoked, and the sweep deletes its
 * bytes again later.
 */
export async function purge(config: Config, db: DatabaseAdapter, files: readonly AttachmentFile[]): Promise<void> {
  if (files.length === 0) {
    return
  }
  await config.storage.delete(files.map((file) => file.storageKey))
  const closed = new Date(Date.now() - lateUploadMs)
  await db.batch(
    chunks(files.map((file) => file.id)).map((ids) => ({
      type: "deleteMany" as const,
      model: fileModel,
      where: [
        { field: "id", operator: "in" as const, value: ids },
        { field: "status", value: "deleted" },
        { field: "uploadClosesAt", operator: "lt" as const, value: closed }
      ]
    }))
  )
}

const fileReasons: Record<DetachReason, FileDeletedReason> = {
  detached: "detached",
  moderated: "detached",
  withdrawn: "detached",
  fileDeleted: "deleted",
  subjectRemoved: "subjectRemoved"
}

/**
 * Takes files off records. A file a record kept goes with it, since it was on that record only, unless `keepFiles` says
 * the file belongs elsewhere. Removals marked `bulk` reach browsers as one `subject.changed` per record, written with the
 * page, so a job that stops partway still reaches them.
 */
export async function removeLinks(
  config: Config,
  writer: Writer,
  links: readonly Attachment[],
  reason: DetachReason,
  { bulk = false, keepFiles = false }: { bulk?: boolean; keepFiles?: boolean } = {}
): Promise<void> {
  if (links.length === 0) {
    return
  }
  const files = await filesById(
    writer.db,
    links.map((link) => link.fileId)
  )
  const doomed = keepFiles ? [] : [...files.values()].filter((file) => file.owner === null && file.status !== "deleted")
  for (const link of links) {
    const file = files.get(link.fileId)
    if (file) {
      writer.emit("attachment.removed", {
        subjectType: link.subjectType,
        subjectId: link.subjectId,
        orgId: link.orgId,
        attachment: link,
        file: eventFile(file),
        reason,
        ...(bulk ? { bulk: true } : {})
      } satisfies AttachmentRemovedData)
    }
  }
  if (bulk) {
    for (const record of recordsOf(links)) {
      writer.emit("subject.changed", record)
    }
  }
  for (const file of doomed) {
    writer.emit("file.deleted", { file: eventFile(file), reason: fileReasons[reason] })
  }
  await writer.db.batch([...linkRemovals(links, doomed), ...markDeleted(doomed)])
  await purge(config, writer.db, doomed)
}

/**
 * Deletes files, such as a person's own or a draft. Each comes off the records it's on: the first hundred of those are
 * reported, with `attachment.removed` and one `subject.changed` per record, and the rest go with the file's row. Returns
 * whether this call deleted them all, rather than another removal, such as the sweep, that took them first, or an attach
 * or a finish that put a draft or an upload on a record meanwhile.
 */
export async function deleteFiles(
  config: Config,
  writer: Writer,
  files: readonly AttachmentFile[],
  reason: FileDeletedReason
): Promise<boolean> {
  const live = files.filter((file) => file.status !== "deleted")
  if (live.length === 0) {
    await purge(config, writer.db, files)
    return false
  }
  const links = (
    await Promise.all(
      chunks(live.map((file) => file.id)).map(async (ids) =>
        writer.db.findMany<Attachment>({
          model: attachmentModel,
          where: [{ field: "fileId", operator: "in", value: ids }],
          limit: removalPage
        })
      )
    )
  )
    .flat()
    .slice(0, removalPage)
  const byId = new Map(live.map((file) => [file.id, file]))
  for (const link of links) {
    writer.emit("attachment.removed", {
      subjectType: link.subjectType,
      subjectId: link.subjectId,
      orgId: link.orgId,
      attachment: link,
      file: eventFile(byId.get(link.fileId) as AttachmentFile),
      reason: "fileDeleted",
      bulk: true
    } satisfies AttachmentRemovedData)
  }
  for (const record of recordsOf(links)) {
    writer.emit("subject.changed", record)
  }
  // A draft or an upload under way goes only while nothing keeps it, so one that an attach or a finish put on a record
  // since it was read stays there. Whether it went is known only once the batch ran, so its `file.deleted` is emitted
  // then, and written after it.
  const unkept = live.filter(isUnkept)
  const others = live.filter((file) => !isUnkept(file))
  for (const file of others) {
    if (file.status === "ready") {
      writer.emit("file.deleted", { file: eventFile(file), reason })
    }
  }
  const notDeleted: Where = { field: "status", operator: "ne", value: "deleted" }
  const unkeptMarks = markDeleted(unkept, [notDeleted, { field: "expiresAt", operator: "gt", value: new Date(0) }])
  let results: unknown[]
  try {
    results = await writer.db.batch([
      ...linkRemovals(links, live),
      ...markDeleted(others, [notDeleted]),
      ...unkeptMarks
    ])
  } catch (error) {
    // Another removal took some of them first, so this batch failed with its events. When it took them all, it reported
    // and deletes them itself; otherwise the caller reads them again.
    const after = await filesById(
      writer.db,
      live.map((file) => file.id)
    )
    if ([...after.values()].some((file) => file.status !== "deleted")) {
      throw error
    }
    return false
  }
  const marked = results.slice(results.length - unkeptMarks.length).reduce<number>((sum, n) => sum + Number(n), 0)
  const kept = new Set<string>()
  if (marked < unkept.length) {
    // Only a race with an attach or a finish gets here. The files it kept stay, with their bytes, and aren't remembered
    // as removed, so they can be removed later.
    const after = await filesById(
      writer.db,
      unkept.map((file) => file.id)
    )
    for (const file of unkept) {
      if (after.get(file.id)?.status !== "deleted") {
        kept.add(file.id)
      }
    }
    await writer.db.batch(
      chunks([...kept]).map((ids) => ({
        type: "deleteMany" as const,
        model: removalModel,
        where: [{ field: "id", operator: "in" as const, value: ids }]
      }))
    )
  }
  for (const file of unkept) {
    if (file.status === "ready" && !kept.has(file.id)) {
      writer.emit("file.deleted", { file: eventFile(file), reason })
    }
  }
  await purge(
    config,
    writer.db,
    files.filter((file) => !kept.has(file.id))
  )
  return kept.size === 0
}
