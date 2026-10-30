import type { Actor, BetterAppsEvent, IdentityUser, Where } from "better-apps"
import { accessTo, canViewThread as canView, mentionable, orgOf, requireView, subjectOf, visibleTo } from "./access.js"
import { limits } from "./content.js"
import { decodeCursor, encodeCursor } from "./cursor.js"
import { CommentsError } from "./errors.js"
import type { CommentEventData, ThreadEventData } from "./events.js"
import { callerOf, forbid, loadThread, lookupUsers, threadAccess, type Config, type Context } from "./runtime.js"
import { commentModel, threadModel, type Comment, type CommentThread } from "./schema.js"

/** A page of threads, with the users they name. */
export interface ThreadPage<Thread = CommentThread> {
  threads: Thread[]
  /** The cursor for the next page, or `null` on the last one. */
  cursor: string | null
  /** Names and avatars by user id. Users the identity adapter can't find are missing; show them as "Former user". */
  users: Record<string, IdentityUser>
}

/** A thread with a page of its comments, oldest first. */
export interface ThreadWithComments<Thread = CommentThread, Message = Comment> {
  thread: Thread
  comments: Message[]
  cursor: string | null
  users: Record<string, IdentityUser>
}

/** Signed-out readers get no user ids or metadata. */
function publicThread(thread: CommentThread): CommentThread {
  return { ...thread, createdBy: "", resolvedBy: null, metadata: null }
}

/** Signed-out readers get each comment as text with names filled in, and no user ids. */
function publicComment(config: Config, comment: Comment, users: Record<string, IdentityUser>): Comment {
  const format = config.formats.get(comment.format)
  const names = (userId: string) => users[userId]?.name ?? undefined
  const bodyText = comment.body === null || !format ? comment.bodyText : format.toText(comment.body, names)
  const authorName = comment.authorType === "user" ? (users[comment.authorId]?.name ?? null) : comment.authorName
  return { ...comment, authorId: "", authorName, body: null, bodyText, metadata: null }
}

/** The users a page of comments names: user authors, and everyone mentioned. */
function namedUsers(config: Config, comments: readonly Comment[]): string[] {
  return comments.flatMap((comment) => {
    const format = config.formats.get(comment.format)
    const mentioned = comment.body === null || !format ? [] : format.mentions(comment.body)
    return comment.authorType === "user" ? [comment.authorId, ...mentioned] : mentioned
  })
}

function pageSize(requested: number | undefined, fallback: number): number {
  return requested ?? fallback
}

export async function listThreads(config: Config, context: Context): Promise<ThreadPage> {
  const input = context.input as {
    subjectType: string
    subjectId: string
    status?: "open" | "resolved" | undefined
    anchorKind?: string | null | undefined
    where?: Record<string, string | number | boolean | null> | undefined
    order?: "activity" | "created" | undefined
    cursor?: string | undefined
    limit?: number | undefined
  }
  const { subjectType, subjectId } = input
  const rules = subjectOf(config.subjects, subjectType)
  const caller = callerOf(context)
  const ref = { subjectType, subjectId }
  const access = await accessTo(rules, context.subjects, caller, ref, "default")
  let visibilities: string[] = ["default"]
  if (caller.trusted) {
    visibilities = ["default", ...Object.keys(rules.visibility ?? {})]
  } else if (caller.actor && access.view) {
    visibilities = await visibleTo(rules, { actor: caller.actor, subjectType, subjectId })
  }
  requireView(access)
  const orgId = await orgOf(context.subjects, caller, ref)
  const where: Where[] = [
    { field: "orgId", value: orgId },
    { field: "subjectType", value: subjectType },
    { field: "subjectId", value: subjectId },
    { field: "visibility", operator: "in", value: visibilities }
  ]
  if (input.status) {
    where.push({ field: "status", value: input.status })
  }
  if (input.anchorKind !== undefined) {
    where.push({ field: "anchorKind", value: input.anchorKind })
  }
  for (const [field, value] of Object.entries(input.where ?? {})) {
    if (!Object.hasOwn(config.threadFields, field) || !config.threadFields[field]?.index) {
      throw new CommentsError(
        "INVALID_INPUT",
        `Threads can't be filtered by "${field}"; only indexed additional fields.`
      )
    }
    where.push({ field, value })
  }
  const orderField = input.order === "created" ? "createdAt" : "lastActivityAt"
  const limit = pageSize(input.limit, limits.threadsPerPage)
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
  const rows = await context.db.findMany<CommentThread>({
    model: threadModel,
    where,
    sortBy: [
      { field: orderField, direction: "desc" },
      { field: "id", direction: "desc" }
    ],
    after: after && { [orderField]: after.time, id: after.id },
    limit: limit + 1
  })
  const threads = rows.slice(0, limit)
  const last = threads.at(-1)
  const cursor = rows.length > limit && last ? encodeCursor(last[orderField], last.id) : null
  if (!caller.actor && !caller.trusted) {
    return { threads: threads.map(publicThread), cursor, users: {} }
  }
  const users = await lookupUsers(
    context,
    threads.flatMap((thread) => [thread.createdBy, thread.resolvedBy ?? ""])
  )
  return { threads, cursor, users }
}

export async function getThread(config: Config, context: Context): Promise<ThreadWithComments> {
  const input = context.input as { threadId: string; cursor?: string | undefined; limit?: number | undefined }
  const thread = await loadThread(context, input.threadId)
  const { caller, access } = await threadAccess(config, context, thread)
  requireView(access)
  const limit = pageSize(input.limit, limits.commentsPerPage)
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
  const rows = await context.db.findMany<Comment>({
    model: commentModel,
    where: [{ field: "threadId", value: thread.id }],
    sortBy: [
      { field: "createdAt", direction: "asc" },
      { field: "id", direction: "asc" }
    ],
    after: after && { createdAt: after.time, id: after.id },
    limit: limit + 1
  })
  const comments = rows.slice(0, limit)
  const last = comments.at(-1)
  const cursor = rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null
  const users = await lookupUsers(context, [thread.createdBy, thread.resolvedBy ?? "", ...namedUsers(config, comments)])
  if (!caller.actor && !caller.trusted) {
    return {
      thread: publicThread(thread),
      comments: comments.map((comment) => publicComment(config, comment, users)),
      cursor,
      users: {}
    }
  }
  return { thread, comments, cursor, users }
}

export async function countThreads(
  config: Config,
  context: Context
): Promise<Record<string, { open: number; total: number }>> {
  const input = context.input as { subjectType: string; subjectIds: string[]; status?: "open" | "resolved" | undefined }
  const { subjectType } = input
  const rules = subjectOf(config.subjects, subjectType)
  const caller = callerOf(context)
  const subjectIds = [...new Set(input.subjectIds)]
  const { actor } = caller
  let allowed: readonly boolean[] = subjectIds.map(() => true)
  if (!caller.trusted) {
    allowed = await context.subjects.canViewMany(subjectIds.map((subjectId) => ({ actor, subjectType, subjectId })))
    if (!actor && !allowed.includes(true)) {
      throw new CommentsError("UNAUTHENTICATED", "Sign in to see these comments.")
    }
  }
  const viewable = subjectIds.filter((_, index) => allowed[index])
  const allVisibilities = ["default", ...Object.keys(rules.visibility ?? {})]
  const visibleOn = async (subjectId: string) => {
    if (caller.trusted) {
      return allVisibilities
    }
    return actor ? visibleTo(rules, { actor, subjectType, subjectId }) : ["default"]
  }
  const details = await Promise.all(
    viewable.map(async (subjectId) => ({
      subjectId,
      orgId: await orgOf(context.subjects, caller, { subjectType, subjectId }),
      visible: new Set(await visibleOn(subjectId))
    }))
  )
  const counts: Record<string, { open: number; total: number }> = {}
  const bySubject = new Map(details.map((detail) => [detail.subjectId, detail]))
  for (const detail of details) {
    counts[detail.subjectId] = { open: 0, total: 0 }
  }
  if (viewable.length === 0) {
    return counts
  }
  const where: Where[] = [
    { field: "subjectType", value: subjectType },
    { field: "subjectId", operator: "in", value: viewable }
  ]
  if (input.status) {
    where.push({ field: "status", value: input.status })
  }
  const groups = await context.db.countGroups({
    model: threadModel,
    where,
    groupBy: ["orgId", "subjectId", "visibility", "status"]
  })
  for (const { group, count } of groups) {
    const detail = bySubject.get(String(group.subjectId))
    const tally = counts[String(group.subjectId)]
    if (detail && tally && group.orgId === detail.orgId && detail.visible.has(String(group.visibility))) {
      tally.total += count
      tally.open += group.status === "open" ? count : 0
    }
  }
  return counts
}

export async function suggestMentions(config: Config, context: Context): Promise<IdentityUser[]> {
  const input = context.input as { threadId?: string; subjectType?: string; subjectId?: string; query: string }
  let thread: CommentThread
  if (input.threadId !== undefined) {
    thread = await loadThread(context, input.threadId)
  } else {
    const subjectType = input.subjectType as string
    const subjectId = input.subjectId as string
    subjectOf(config.subjects, subjectType)
    const now = context.now
    // Suggestions for a new thread are checked as if it were a default thread on the subject.
    thread = {
      id: "",
      orgId: await orgOf(context.subjects, callerOf(context), { subjectType, subjectId }),
      subjectType,
      subjectId,
      visibility: "default",
      anchorKind: null,
      anchor: null,
      anchorVersion: null,
      status: "open",
      resolvedAt: null,
      resolvedBy: null,
      createdBy: "",
      createdAt: now,
      lastActivityAt: now,
      commentCount: 0,
      metadata: null
    }
  }
  const { access } = await threadAccess(config, context, thread)
  requireView(access)
  forbid(access.comment, "You can't comment here.")
  const { searchUsers } = context.identity
  if (!searchUsers) {
    return []
  }
  const orgId = thread.orgId === "" ? null : thread.orgId
  // Asks for more than it returns, since some may be filtered out.
  const found = await searchUsers.call(context.identity, input.query, { orgId, limit: limits.suggestions * 3 })
  const actors = await context.identity.getActorsFor(
    found.map((user) => user.id),
    orgId
  )
  const allowed = new Set(
    (await mentionable(config.subjects, context.subjects, actors, thread)).map((actor) => actor.userId)
  )
  return found.filter((user) => allowed.has(user.id)).slice(0, limits.suggestions)
}

/** Whether someone can see a thread, for other features' recipient checks, such as notifications. */
export async function canViewThread(config: Config, context: Context): Promise<boolean> {
  const input = context.input as { actor: Actor | null; thread?: CommentThread; threadId?: string }
  const thread =
    input.thread ??
    (await context.db.findOne<CommentThread>({
      model: threadModel,
      where: [{ field: "id", value: input.threadId ?? "" }]
    }))
  return thread ? canView(config.subjects, context.subjects, input.actor, thread) : false
}

/** An event a browser may see, from `toClientEvent`. */
export type ClientEvent =
  | {
      id: string
      type: "thread.created" | "comment.created" | "comment.edited" | "comment.deleted" | "comment.mentioned"
      thread: CommentThread
      comment: Comment
    }
  | {
      id: string
      type: "thread.updated" | "thread.resolved" | "thread.reopened" | "thread.anchorUpdated" | "thread.deleted"
      thread: CommentThread
    }

const commentEventTypes = new Set([
  "thread.created",
  "comment.created",
  "comment.edited",
  "comment.deleted",
  "comment.mentioned"
])
const threadEventTypes = new Set([
  "thread.updated",
  "thread.resolved",
  "thread.reopened",
  "thread.anchorUpdated",
  "thread.deleted"
])

/**
 * Turns a server event into one a viewer's browser may see, for a live updates feature. It returns `null` when the
 * viewer can't see the thread, and leaves out previous bodies and anchors. Threads and comments keep the fields reads
 * return, so applying an event never blanks what a read showed. `comment.mentioned` only reaches the user it mentions.
 */
export async function toClientEvent(config: Config, context: Context): Promise<ClientEvent | null> {
  const { event, viewer } = context.input as { event: BetterAppsEvent; viewer: Actor | null }
  if (event.feature !== "comments" || (!commentEventTypes.has(event.type) && !threadEventTypes.has(event.type))) {
    return null
  }
  const data = event.data as ThreadEventData & Partial<CommentEventData> & { userId?: string }
  if (event.type === "comment.mentioned" && viewer?.userId !== data.userId) {
    return null
  }
  if (!(await canView(config.subjects, context.subjects, viewer, data.thread))) {
    return null
  }
  const thread = viewer ? data.thread : publicThread(data.thread)
  let comment = data.comment
  if (comment && !viewer) {
    const users = await lookupUsers(context, namedUsers(config, [comment]))
    comment = publicComment(config, comment, users)
  }
  return comment && commentEventTypes.has(event.type)
    ? ({ id: event.id, type: event.type, thread, comment } as ClientEvent)
    : ({ id: event.id, type: event.type, thread } as ClientEvent)
}
