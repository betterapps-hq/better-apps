import { defineEvent } from "better-apps"
import type { Comment, CommentThread } from "./schema.js"

/** What every thread event carries, so a subscriber never needs to query back. */
export interface ThreadEventData {
  subjectType: string
  subjectId: string
  orgId: string
  /** The thread after the change, or as it was before it was deleted. */
  thread: CommentThread
}

/** A thread event about one comment. */
export interface CommentEventData extends ThreadEventData {
  comment: Comment
}

/** A thread's anchor, as `thread.anchorUpdated` reports the previous one. */
export interface StoredAnchor {
  kind: string
  value: unknown
  version: string | null
}

/**
 * The events comments emit. They stay on the server, because they can hold previous bodies and threads in restricted
 * visibilities; browsers get them only through `toClientEvent`.
 */
export const commentEvents = {
  "thread.created": defineEvent<CommentEventData>(),
  "thread.updated": defineEvent<ThreadEventData & { previous: Partial<CommentThread> }>(),
  "comment.created": defineEvent<CommentEventData>(),
  "comment.edited": defineEvent<CommentEventData & { previousFormat: string; previousBody: unknown }>(),
  "comment.deleted": defineEvent<CommentEventData & { previousBody: unknown; previousText: string }>(),
  "comment.mentioned": defineEvent<CommentEventData & { userId: string }>(),
  "thread.resolved": defineEvent<ThreadEventData>(),
  "thread.reopened": defineEvent<ThreadEventData>(),
  "thread.anchorUpdated": defineEvent<ThreadEventData & { previousAnchor: StoredAnchor | null }>(),
  "thread.deleted": defineEvent<ThreadEventData>(),
  "subject.moved": defineEvent<{ subjectType: string; subjectId: string; toOrgId: string }>(),
  "subject.removed": defineEvent<{ subjectType: string; subjectId: string }>(),
  "user.removed": defineEvent<{ userId: string }>()
}

/** The data of each comments event, by type. */
export type CommentsEventData = {
  [Type in keyof typeof commentEvents]: (typeof commentEvents)[Type] extends { "~data"?: infer Data }
    ? NonNullable<Data>
    : never
}
