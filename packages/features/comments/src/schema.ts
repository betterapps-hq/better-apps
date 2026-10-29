import type { FeatureSchema, FieldAttribute } from "better-apps"

/** Typed columns an app adds to threads or comments. The CLI generates them with the rest of the schema. */
export interface AdditionalFields {
  thread?: Readonly<Record<string, FieldAttribute>> | undefined
  comment?: Readonly<Record<string, FieldAttribute>> | undefined
}

type FieldValueOf<Field extends FieldAttribute> = Field["type"] extends "string"
  ? string
  : Field["type"] extends "number"
    ? number
    : Field["type"] extends "boolean"
      ? boolean
      : Field["type"] extends "date"
        ? Date
        : Field["type"] extends "string[]"
          ? string[]
          : Field["type"] extends "number[]"
            ? number[]
            : Field["type"] extends readonly (infer Value extends string)[]
              ? Value
              : unknown

/** The values of additional fields as rows hold them. Optional fields may be `null`. */
export type InferFields<Fields> = {
  -readonly [Name in keyof Fields]: Fields[Name] extends FieldAttribute
    ? Fields[Name]["required"] extends false
      ? FieldValueOf<Fields[Name]> | null
      : FieldValueOf<Fields[Name]>
    : never
}

/** One conversation at one place in a subject. */
export type CommentThread = {
  id: string
  /** The organization that owns the subject, or `""` when the app has none. */
  orgId: string
  subjectType: string
  subjectId: string
  /** `default`, or a visibility the subject type declares, such as `staff`. */
  visibility: string
  /** `null` means the whole subject. */
  anchorKind: string | null
  anchor: unknown
  /** The content version the anchor was made against, such as a deploy, commit or document revision. */
  anchorVersion: string | null
  status: "open" | "resolved"
  resolvedAt: Date | null
  resolvedBy: string | null
  createdBy: string
  createdAt: Date
  /** When the newest comment was written, deleted or not. */
  lastActivityAt: Date
  /** Comments that aren't deleted. */
  commentCount: number
  metadata: Record<string, unknown> | null
}

/** One message in a thread. */
export type Comment = {
  id: string
  threadId: string
  orgId: string
  /** `user`, `external` for people without an account, or `system` for bots. */
  authorType: "user" | "external" | "system"
  /** A user id, or the id server code gave an external or system author (`""` without one). */
  authorId: string
  /** Stored only for external and system authors, who the identity adapter can't look up. */
  authorName: string | null
  format: string
  /** `null` once the comment is deleted, or its author removed. */
  body: unknown
  /** Plain text from the format, with mentions as tokens. Empty once deleted. */
  bodyText: string
  createdAt: Date
  editedAt: Date | null
  deletedAt: Date | null
  metadata: Record<string, unknown> | null
}

export const threadModel = "commentThread"
export const commentModel = "comment"

/** The comments tables, with the app's additional fields. */
export function commentsSchema(additional: AdditionalFields = {}): FeatureSchema {
  return {
    [threadModel]: {
      fields: {
        orgId: { type: "string", defaultValue: "" },
        subjectType: { type: "string" },
        subjectId: { type: "string" },
        visibility: { type: "string", defaultValue: "default" },
        anchorKind: { type: "string", required: false },
        anchor: { type: "json", required: false },
        anchorVersion: { type: "string", required: false },
        status: { type: ["open", "resolved"], defaultValue: "open" },
        resolvedAt: { type: "date", required: false },
        resolvedBy: { type: "string", required: false },
        createdBy: { type: "string" },
        createdAt: { type: "date" },
        lastActivityAt: { type: "date" },
        commentCount: { type: "number", defaultValue: 0 },
        metadata: { type: "json", required: false },
        ...additional.thread
      },
      // Better Auth's schema format indexes declared fields only, so ties on time are broken by the id outside the index.
      indexes: [
        { fields: ["orgId", "subjectType", "subjectId", "lastActivityAt"], name: "comment_thread_by_activity" },
        { fields: ["orgId", "subjectType", "subjectId", "createdAt"], name: "comment_thread_by_creation" }
      ]
    },
    [commentModel]: {
      fields: {
        threadId: { type: "string", references: { model: threadModel, field: "id", onDelete: "cascade" } },
        orgId: { type: "string", defaultValue: "" },
        authorType: { type: ["user", "external", "system"] },
        authorId: { type: "string" },
        authorName: { type: "string", required: false },
        format: { type: "string", defaultValue: "text" },
        body: { type: "json", required: false },
        bodyText: { type: "string", defaultValue: "" },
        createdAt: { type: "date" },
        editedAt: { type: "date", required: false },
        deletedAt: { type: "date", required: false },
        metadata: { type: "json", required: false },
        ...additional.comment
      },
      indexes: [
        { fields: ["threadId", "createdAt"], name: "comment_by_thread" },
        { fields: ["authorType", "authorId"], name: "comment_by_author" }
      ]
    }
  }
}
