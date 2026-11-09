import { defineEvent } from "better-apps"
import type { Attachment, AttachmentFile } from "./schema.js"

/** A file as events carry it, without the token hash. */
export type EventFile = Omit<AttachmentFile, "uploadTokenHash">

/** Why a file was removed. */
export type FileDeletedReason = "deleted" | "detached" | "subjectRemoved" | "userRemoved" | "expired"

/**
 * Why a file came off a record: the person who attached it took it off, a moderator did, the file was deleted, its
 * record was removed, or it was `withdrawn` because its record went away, or out of the person's reach, while it was
 * attached.
 */
export type DetachReason = "detached" | "moderated" | "fileDeleted" | "subjectRemoved" | "withdrawn"

/** What both attachment events carry, so a subscriber never needs to query back. */
export interface AttachmentEventData {
  subjectType: string
  subjectId: string
  orgId: string
  attachment: Attachment
  file: EventFile
}

/** What `attachment.removed` carries. */
export interface AttachmentRemovedData extends AttachmentEventData {
  reason: DetachReason
  /** Whether it was one of many removed at once, such as by removing a record. Browsers hear of those per record. */
  bulk?: boolean | undefined
}

/** A record, as events name it. */
export interface RecordData {
  subjectType: string
  subjectId: string
}

/** The events attachments emit. Browsers get them through `toClientEvent`, which checks the viewer can see the record. */
export const attachmentEvents = {
  "file.uploaded": defineEvent<{ file: EventFile }>(),
  "file.deleted": defineEvent<{ file: EventFile; reason: FileDeletedReason }>(),
  "attachment.added": defineEvent<AttachmentEventData>(),
  "attachment.removed": defineEvent<AttachmentRemovedData>(),
  "attachments.reordered": defineEvent<RecordData & { orgId: string; fileIds: string[] }>(),
  /** Many of a record's files changed at once, such as a page of a removal. */
  "subject.changed": defineEvent<RecordData>(),
  "subject.moved": defineEvent<RecordData & { toOrgId: string }>(),
  "subject.removed": defineEvent<RecordData>(),
  "user.removed": defineEvent<{ userId: string }>(),
  /**
   * Attachments' own: what's left of cleaning up after records that went away or moved, such as comments' threads,
   * continued in the next `app.deliverEvents()` run. Browsers never get it.
   */
  "cleanup.continued": defineEvent<{
    records: { subjectType: string; subjectIds: string[] }[]
    move?: { toOrgId: string; subject: { subjectType: string; subjectId: string } } | undefined
  }>()
}

/** The data of each attachments event, by type. */
export type AttachmentsEventData = {
  [Type in keyof typeof attachmentEvents]: (typeof attachmentEvents)[Type] extends { "~data"?: infer Data }
    ? NonNullable<Data>
    : never
}
