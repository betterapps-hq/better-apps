import type { WriteOperation } from "better-apps"
import { subjectOf } from "./access.js"
import { limits } from "./content.js"
import type { Config, Context } from "./runtime.js"
import { commentModel, threadModel, type Comment, type CommentThread } from "./schema.js"

// Upkeep for records and users that disappear while their comments remain. Each call does a bounded step and says
// whether it's done, so an app calls again from a queue or a scheduled job and no request runs out of queries.

/** The result of one step of upkeep. */
export interface UpkeepStep {
  done: boolean
}

const step = limits.maxThreadsPerPage
const usersStep = 90

async function subjectThreadIds(context: Context, subjectType: string, subjectId: string, orgIdNot?: string) {
  const threads = await context.db.findMany<CommentThread>({
    model: threadModel,
    where: [
      { field: "subjectType", value: subjectType },
      { field: "subjectId", value: subjectId },
      ...(orgIdNot === undefined ? [] : [{ field: "orgId", operator: "ne" as const, value: orgIdNot }])
    ],
    sortBy: { field: "id", direction: "asc" },
    limit: step,
    select: ["id"]
  })
  return threads.map((thread) => thread.id)
}

/** Deletes up to 50 of a removed record's threads. The last step emits `subject.removed`. */
export async function removeSubject(config: Config, context: Context): Promise<UpkeepStep> {
  const { subjectType, subjectId } = context.input as { subjectType: string; subjectId: string }
  subjectOf(config.subjects, subjectType)
  const ids = await subjectThreadIds(context, subjectType, subjectId)
  const done = ids.length < step
  if (done) {
    context.emit("subject.removed", { subjectType, subjectId })
  }
  if (ids.length > 0) {
    await context.db.batch([
      { type: "deleteMany", model: commentModel, where: [{ field: "threadId", operator: "in", value: ids }] },
      { type: "deleteMany", model: threadModel, where: [{ field: "id", operator: "in", value: ids }] }
    ])
  }
  return { done }
}

/** Moves up to 50 of a record's threads, and their comments, to another organization. The last step emits `subject.moved`. */
export async function moveSubject(config: Config, context: Context): Promise<UpkeepStep> {
  const input = context.input as { subjectType: string; subjectId: string; toOrgId: string | null }
  const { subjectType, subjectId } = input
  subjectOf(config.subjects, subjectType)
  const toOrgId = input.toOrgId ?? ""
  const ids = await subjectThreadIds(context, subjectType, subjectId, toOrgId)
  const done = ids.length < step
  if (done) {
    context.emit("subject.moved", { subjectType, subjectId, toOrgId })
  }
  if (ids.length > 0) {
    await context.db.batch([
      {
        type: "updateMany",
        model: commentModel,
        where: [{ field: "threadId", operator: "in", value: ids }],
        update: { orgId: toOrgId }
      },
      {
        type: "updateMany",
        model: threadModel,
        where: [{ field: "id", operator: "in", value: ids }],
        update: { orgId: toOrgId }
      }
    ])
  }
  return { done }
}

/**
 * Clears the bodies of up to 90 of a removed user's comments. The comments stay, so threads keep their shape, and show
 * as removed text from a former user. The last step emits `user.removed`.
 */
export async function removeUser(_config: Config, context: Context): Promise<UpkeepStep> {
  const { userId } = context.input as { userId: string }
  const comments = await context.db.findMany<Comment>({
    model: commentModel,
    where: [
      { field: "authorType", value: "user" },
      { field: "authorId", value: userId },
      { field: "body", operator: "ne", value: null }
    ],
    sortBy: { field: "id", direction: "asc" },
    limit: usersStep,
    select: ["id"]
  })
  const ids = comments.map((comment) => comment.id)
  const done = ids.length < usersStep
  if (done) {
    context.emit("user.removed", { userId })
  }
  if (ids.length > 0) {
    await context.db.batch([
      {
        type: "updateMany",
        model: commentModel,
        where: [{ field: "id", operator: "in", value: ids }],
        update: { body: null, bodyText: "" }
      }
    ])
  }
  return { done }
}

/**
 * Recomputes `commentCount` and `lastActivityAt` for up to 50 threads, to repair data changed outside comments, such
 * as by a hand-written migration. Pass thread ids, or a subject and the cursor from the previous step.
 */
export async function recountThreads(
  config: Config,
  context: Context
): Promise<UpkeepStep & { cursor: string | null }> {
  const input = context.input as { threadIds?: string[]; subjectType?: string; subjectId?: string; cursor?: string }
  let ids: string[]
  let cursor: string | null = null
  if (input.threadIds) {
    ids = [...new Set(input.threadIds)]
  } else {
    const subjectType = input.subjectType as string
    subjectOf(config.subjects, subjectType)
    const threads = await context.db.findMany<CommentThread>({
      model: threadModel,
      where: [
        { field: "subjectType", value: subjectType },
        { field: "subjectId", value: input.subjectId as string },
        ...(input.cursor === undefined ? [] : [{ field: "id", operator: "gt" as const, value: input.cursor }])
      ],
      sortBy: { field: "id", direction: "asc" },
      limit: step,
      select: ["id"]
    })
    ids = threads.map((thread) => thread.id)
    cursor = ids.length === step ? (ids.at(-1) ?? null) : null
  }
  if (ids.length === 0) {
    return { done: true, cursor: null }
  }
  const [counts, latest] = await Promise.all([
    context.db.countGroups({
      model: commentModel,
      where: [
        { field: "threadId", operator: "in", value: ids },
        { field: "deletedAt", value: null }
      ],
      groupBy: ["threadId"]
    }),
    Promise.all(
      ids.map(async (threadId) => {
        const [newest] = await context.db.findMany<Comment>({
          model: commentModel,
          where: [{ field: "threadId", value: threadId }],
          sortBy: { field: "createdAt", direction: "desc" },
          limit: 1,
          select: ["createdAt"]
        })
        return [threadId, newest?.createdAt] as const
      })
    )
  ])
  const countOf = new Map(counts.map(({ group, count }) => [String(group.threadId), count]))
  const operations: WriteOperation[] = latest.map(([threadId, newest]) => ({
    type: "update",
    model: threadModel,
    where: [{ field: "id", value: threadId }],
    update: { commentCount: countOf.get(threadId) ?? 0, ...(newest ? { lastActivityAt: newest } : {}) }
  }))
  await context.db.batch(operations)
  return { done: cursor === null, cursor }
}
