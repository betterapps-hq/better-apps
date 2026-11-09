import type { FeatureSchema } from "better-apps"

/** The model of the files table. */
export const fileModel = "attachmentFile"

/** The model of the table that puts files on records. */
export const attachmentModel = "attachment"

/** The model of the table that remembers attachments just removed, so each removal is reported once. */
export const removalModel = "attachmentRemoval"

/** Where a file stands: uploading, stored, or on its way out while its bytes are deleted. */
export type FileStatus = "pending" | "ready" | "deleted"

/** One stored file. */
export type AttachmentFile = {
  id: string
  /** The organization the file belongs to, or `""` outside any. */
  orgId: string
  /** `user:{userId}` or `org:{orgId}` for a file kept on its own; `null` for one a record keeps. */
  owner: string | null
  /** The user who uploaded it. */
  createdBy: string
  name: string
  contentType: string
  /** Bytes. */
  size: number
  storageKey: string
  status: FileStatus
  /** The subject type a draft or an upload onto a record was checked against. */
  subjectType: string | null
  /** The record an upload is aimed at, attached once its bytes are confirmed. */
  target: string | null
  /** The SHA-256 of the token that lets the server's route take its bytes, until it's uploaded. */
  uploadTokenHash: string | null
  /** When an unfinished upload or an unattached draft is removed. `null` once something keeps it. */
  expiresAt: Date | null
  createdAt: Date
  uploadedAt: Date | null
}

/** One file on one record. */
export type Attachment = {
  id: string
  fileId: string
  /** The record's organization when the file was attached, or `""`. */
  orgId: string
  subjectType: string
  subjectId: string
  /** Its place in the record's order, from 0. */
  position: number
  /** Which of the record's places it takes, from 0 to one less than `maxFiles`, so the limit always holds. */
  slot: number
  createdBy: string
  createdAt: Date
}

/** The attachments tables. */
export const attachmentsSchema: FeatureSchema = {
  [fileModel]: {
    fields: {
      orgId: { type: "string", defaultValue: "" },
      owner: { type: "string", required: false },
      createdBy: { type: "string" },
      name: { type: "string" },
      contentType: { type: "string" },
      size: { type: "number" },
      storageKey: { type: "string" },
      status: { type: ["pending", "ready", "deleted"], defaultValue: "pending" },
      subjectType: { type: "string", required: false },
      target: { type: "string", required: false },
      uploadTokenHash: { type: "string", required: false },
      expiresAt: { type: "date", required: false },
      createdAt: { type: "date" },
      uploadedAt: { type: "date", required: false }
    },
    indexes: [
      { fields: ["owner", "createdAt"], name: "attachment_file_by_owner" },
      { fields: ["createdBy", "status"], name: "attachment_file_by_creator" },
      { fields: ["status", "expiresAt"], name: "attachment_file_by_expiry" }
    ]
  },
  [attachmentModel]: {
    fields: {
      fileId: { type: "string", references: { model: fileModel, field: "id", onDelete: "cascade" } },
      orgId: { type: "string", defaultValue: "" },
      subjectType: { type: "string" },
      subjectId: { type: "string" },
      position: { type: "number", defaultValue: 0 },
      slot: { type: "number", defaultValue: 0 },
      createdBy: { type: "string" },
      createdAt: { type: "date" }
    },
    indexes: [
      { fields: ["subjectType", "subjectId", "orgId", "fileId"], name: "attachment_by_file_on_record", unique: true },
      { fields: ["subjectType", "subjectId", "orgId", "slot"], name: "attachment_slot", unique: true },
      { fields: ["fileId"], name: "attachment_by_file" }
    ]
  },
  // A removal writes a row keyed by the attachment's id, so a second removal of it, such as a cleanup racing a person
  // taking the file off, fails and its events are never written. Rows older than an hour are cleared as removals run.
  [removalModel]: {
    fields: { createdAt: { type: "date" } },
    indexes: [{ fields: ["createdAt"], name: "attachment_removal_by_time" }]
  }
}
