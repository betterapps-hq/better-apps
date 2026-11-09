import { relations } from "drizzle-orm"
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"

export const note = sqliteTable(
  "note",
  {
    id: text("id").primaryKey(),
    text: text("text").notNull(),
    authorId: text("author_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [index("note_createdAt_idx").on(table.createdAt)]
)

export const commentThread = sqliteTable(
  "comment_thread",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").default("").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    visibility: text("visibility").default("default").notNull(),
    anchorKind: text("anchor_kind"),
    anchor: text("anchor", { mode: "json" }),
    anchorVersion: text("anchor_version"),
    status: text("status", { enum: ["open", "resolved"] })
      .default("open")
      .notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolvedBy: text("resolved_by"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastActivityAt: integer("last_activity_at", {
      mode: "timestamp_ms"
    }).notNull(),
    commentCount: integer("comment_count").default(0).notNull(),
    metadata: text("metadata", { mode: "json" })
  },
  (table) => [
    index("comment_thread_by_activity").on(table.orgId, table.subjectType, table.subjectId, table.lastActivityAt),
    index("comment_thread_by_creation").on(table.orgId, table.subjectType, table.subjectId, table.createdAt)
  ]
)

export const comment = sqliteTable(
  "comment",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => commentThread.id, { onDelete: "cascade" }),
    orgId: text("org_id").default("").notNull(),
    authorType: text("author_type", {
      enum: ["user", "external", "system"]
    }).notNull(),
    authorId: text("author_id").notNull(),
    authorName: text("author_name"),
    format: text("format").default("text").notNull(),
    body: text("body", { mode: "json" }),
    bodyText: text("body_text").default("").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    metadata: text("metadata", { mode: "json" })
  },
  (table) => [
    index("comment_by_thread").on(table.threadId, table.createdAt),
    index("comment_by_author").on(table.authorType, table.authorId)
  ]
)

export const reaction = sqliteTable(
  "reaction",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").default("").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    userId: text("user_id").notNull(),
    emoji: text("emoji").notNull(),
    slot: integer("slot").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [
    uniqueIndex("reaction_by_user").on(table.subjectType, table.subjectId, table.orgId, table.userId, table.emoji),
    uniqueIndex("reaction_slot").on(table.subjectType, table.subjectId, table.orgId, table.userId, table.slot),
    index("reaction_by_emoji").on(table.subjectType, table.subjectId, table.orgId, table.emoji, table.createdAt),
    index("reaction_of_user").on(table.userId)
  ]
)

export const reactionRemoval = sqliteTable(
  "reaction_removal",
  {
    id: text("id").primaryKey(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [index("reaction_removal_by_time").on(table.createdAt)]
)

export const shortLink = sqliteTable(
  "short_link",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    owner: text("owner").notNull(),
    orgId: text("org_id").default("").notNull(),
    createdBy: text("created_by").notNull(),
    url: text("url"),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    grantsView: integer("grants_view", { mode: "boolean" }).default(false).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    clicks: integer("clicks").default(0).notNull(),
    lastClickedAt: integer("last_clicked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [
    index("short_link_by_owner").on(table.owner, table.createdAt),
    index("short_link_by_org").on(table.orgId, table.createdAt),
    index("short_link_by_subject").on(table.subjectType, table.subjectId, table.createdAt)
  ]
)

export const attachmentFile = sqliteTable(
  "attachment_file",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").default("").notNull(),
    owner: text("owner"),
    createdBy: text("created_by").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    status: text("status", { enum: ["pending", "ready", "deleted"] })
      .default("pending")
      .notNull(),
    subjectType: text("subject_type"),
    target: text("target"),
    uploadTokenHash: text("upload_token_hash"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    uploadClosesAt: integer("upload_closes_at", {
      mode: "timestamp_ms"
    }).notNull(),
    etag: text("etag"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" })
  },
  (table) => [
    index("attachment_file_by_owner").on(table.owner, table.createdAt),
    index("attachment_file_by_creator").on(table.createdBy, table.status),
    index("attachment_file_by_expiry").on(table.status, table.expiresAt),
    index("attachment_file_by_closing").on(table.status, table.uploadClosesAt)
  ]
)

export const attachment = sqliteTable(
  "attachment",
  {
    id: text("id").primaryKey(),
    fileId: text("file_id")
      .notNull()
      .references(() => attachmentFile.id, { onDelete: "cascade" }),
    orgId: text("org_id").default("").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    position: integer("position").default(0).notNull(),
    slot: integer("slot").default(0).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [
    uniqueIndex("attachment_by_file_on_record").on(table.subjectType, table.subjectId, table.orgId, table.fileId),
    uniqueIndex("attachment_slot").on(table.subjectType, table.subjectId, table.orgId, table.slot),
    index("attachment_by_file").on(table.fileId)
  ]
)

export const attachmentRemoval = sqliteTable(
  "attachment_removal",
  {
    id: text("id").primaryKey(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [index("attachment_removal_by_time").on(table.createdAt)]
)

export const betterAppsEvent = sqliteTable(
  "better_apps_event",
  {
    id: text("id").primaryKey(),
    feature: text("feature").notNull(),
    type: text("type").notNull(),
    data: text("data", { mode: "json" }),
    actor: text("actor", { mode: "json" }),
    author: text("author", { mode: "json" }),
    silent: integer("silent", { mode: "boolean" }).default(false).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    availableAt: integer("available_at", { mode: "timestamp_ms" }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error")
  },
  (table) => [index("betterAppsEvent_availableAt_idx").on(table.availableAt)]
)

export const commentThreadRelations = relations(commentThread, ({ many }) => ({
  comments: many(comment)
}))

export const commentRelations = relations(comment, ({ one }) => ({
  commentThread: one(commentThread, {
    fields: [comment.threadId],
    references: [commentThread.id]
  })
}))

export const attachmentFileRelations = relations(attachmentFile, ({ many }) => ({
  attachments: many(attachment)
}))

export const attachmentRelations = relations(attachment, ({ one }) => ({
  attachmentFile: one(attachmentFile, {
    fields: [attachment.fileId],
    references: [attachmentFile.id]
  })
}))
