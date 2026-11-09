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
