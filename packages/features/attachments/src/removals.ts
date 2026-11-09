// Taking files off records and deleting files, for single changes and pages of bulk jobs alike. Rows go first, in one
// batch with their events; bytes go after. Files whose bytes fail to delete stay `deleted`, and the sweep retries them.
import { BetterAppsError, type DatabaseAdapter, type SubjectRef, type Where, type WriteOperation } from "better-apps"
import { chunks, type Context } from "./access.js"
import type { Config } from "./config.js"
import type { AttachmentRemovedData, DetachReason, FileDeletedReason } from "./events.js"
import { eventFile } from "./present.js"
import { attachmentModel, fileModel, removalModel, type Attachment, type AttachmentFile } from "./schema.js"

/** What removals write with: an action's or a subscriber's database, events and subjects. */
export type Writer = Pick<Context, "db" | "emit" | "subjects">

/** How long a removal is remembered, which only needs to outlast requests under way. */
const removalMemoryMs = 60 * 60_000

/** How many attachments one page of a bulk job removes, each a few statements per page besides its events. */
export const removalPage = 100

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
 * The writes that remove attachments: each is deleted and remembered by its id, so a batch that removes one another
 * removal already took fails, with its events, rather than reporting it twice. Old memories go at the same time.
 */
function linkRemovals(links: readonly Attachment[]): WriteOperation[] {
  if (links.length === 0) {
    return []
  }
  const now = new Date()
  return [
    ...chunks(links.map((link) => link.id)).map((ids): WriteOperation => ({
      type: "deleteMany",
      model: attachmentModel,
      where: [{ field: "id", operator: "in", value: ids }]
    })),
    { type: "createMany", model: removalModel, data: links.map((link) => ({ id: link.id, createdAt: now })) },
    {
      type: "deleteMany",
      model: removalModel,
      where: [{ field: "createdAt", operator: "lt", value: new Date(now.getTime() - removalMemoryMs) }]
    }
  ]
}

/** Marks files `deleted`, so nobody sees them while their bytes go. */
function markDeleted(files: readonly AttachmentFile[], guard: readonly Where[] = []): WriteOperation[] {
  return chunks(files.map((file) => file.id)).map((ids) => ({
    type: "updateMany",
    model: fileModel,
    where: [{ field: "id", operator: "in", value: ids }, ...guard],
    update: { status: "deleted", expiresAt: null }
  }))
}

/** Deletes files' bytes, then their rows, which takes any attachments left on them along. */
export async function purge(config: Config, db: DatabaseAdapter, files: readonly AttachmentFile[]): Promise<void> {
  if (files.length === 0) {
    return
  }
  await config.storage.delete(files.map((file) => file.storageKey))
  await db.batch(
    chunks(files.map((file) => file.id)).map((ids) => ({
      type: "deleteMany" as const,
      model: fileModel,
      where: [
        { field: "id", operator: "in" as const, value: ids },
        { field: "status", value: "deleted" }
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
 * Takes files off records. A file a record kept goes with it, since it was on that record only. Removals marked `bulk`
 * reach browsers as one `subject.changed` per record, written with the page, so a job that stops partway still reaches
 * them.
 */
export async function removeLinks(
  config: Config,
  writer: Writer,
  links: readonly Attachment[],
  reason: DetachReason,
  bulk = false
): Promise<void> {
  if (links.length === 0) {
    return
  }
  const files = await filesById(
    writer.db,
    links.map((link) => link.fileId)
  )
  const doomed = [...files.values()].filter((file) => file.owner === null && file.status !== "deleted")
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
  await writer.db.batch([...linkRemovals(links), ...markDeleted(doomed)])
  await purge(config, writer.db, doomed)
}

/**
 * Deletes files, such as a person's own or a draft. Each comes off the records it's on: the first hundred of those are
 * reported, with `attachment.removed` and one `subject.changed` per record, and the rest go with the file's row.
 */
export async function deleteFiles(
  config: Config,
  writer: Writer,
  files: readonly AttachmentFile[],
  reason: FileDeletedReason
): Promise<void> {
  const live = files.filter((file) => file.status !== "deleted")
  if (live.length === 0) {
    await purge(config, writer.db, files)
    return
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
  for (const file of live) {
    if (file.status === "ready") {
      writer.emit("file.deleted", { file: eventFile(file), reason })
    }
  }
  await writer.db.batch([
    ...linkRemovals(links),
    ...markDeleted(live, [{ field: "status", operator: "ne", value: "deleted" }])
  ])
  await purge(config, writer.db, files)
}
