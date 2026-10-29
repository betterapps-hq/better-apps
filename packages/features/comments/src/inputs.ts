import { z } from "zod"
import { limits } from "./content.js"
import { isUlid } from "./ulid.js"

// Shapes only. Bodies, anchors, metadata and additional fields are checked by their format, anchor kind, schema or
// field type once any hook has run.

const newId = z.string().refine(isUlid, "Ids are ULIDs.")
const rowId = z.string().min(1).max(64)
const subjectType = z.string().min(1).max(64)
const subjectId = z.string().min(1).max(255)
const cursor = z.string().min(1).max(512)
const record = z.record(z.string(), z.unknown())
const anchor = z.object({ kind: z.string().min(1).max(64), value: z.unknown(), version: z.string().max(255).nullish() })
const content = { format: z.string().min(1).max(64).optional(), body: z.unknown() }

export const inputs = {
  listThreads: z.object({
    subjectType,
    subjectId,
    status: z.enum(["open", "resolved"]).optional(),
    anchorKind: z.string().min(1).max(64).nullable().optional(),
    where: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    order: z.enum(["activity", "created"]).optional(),
    cursor: cursor.optional(),
    limit: z.number().int().min(1).max(limits.maxThreadsPerPage).optional()
  }),
  getThread: z.object({
    threadId: rowId,
    cursor: cursor.optional(),
    limit: z.number().int().min(1).max(limits.maxCommentsPerPage).optional()
  }),
  countThreads: z.object({
    subjectType,
    subjectIds: z.array(subjectId).min(1).max(limits.subjectsPerCount),
    status: z.enum(["open", "resolved"]).optional()
  }),
  createThread: z.object({
    id: newId.optional(),
    commentId: newId.optional(),
    subjectType,
    subjectId,
    visibility: z.string().min(1).max(64).optional(),
    anchor: anchor.nullish(),
    metadata: record.nullish(),
    fields: record.optional(),
    commentFields: record.optional(),
    ...content
  }),
  reply: z.object({ id: newId.optional(), threadId: rowId, fields: record.optional(), ...content }),
  editComment: z.object({ commentId: rowId, ...content }),
  deleteComment: z.object({ commentId: rowId }),
  thread: z.object({ threadId: rowId }),
  updateThread: z.object({
    threadId: rowId,
    metadata: record.nullish(),
    visibility: z.string().min(1).max(64).optional(),
    fields: record.optional()
  }),
  updateAnchor: z.object({ threadId: rowId, anchor: anchor.nullable() }),
  suggestMentions: z.union([
    z.object({ threadId: rowId, query: z.string().max(100) }),
    z.object({ subjectType, subjectId, query: z.string().max(100) })
  ]),
  removeSubject: z.object({ subjectType, subjectId }),
  moveSubject: z.object({ subjectType, subjectId, toOrgId: z.string().max(255).nullable() }),
  removeUser: z.object({ userId: z.string().min(1).max(255) }),
  recountThreads: z.union([
    z.object({ threadIds: z.array(rowId).min(1).max(limits.maxThreadsPerPage) }),
    z.object({ subjectType, subjectId, cursor: cursor.optional() })
  ])
}
