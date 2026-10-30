import type { Actor, DatabaseAdapter, SubjectContext, SubjectDefinition } from "better-apps"
import { canViewThreads } from "./access.js"
import { chunks, type Config } from "./runtime.js"
import { commentModel, threadModel, type Comment, type CommentThread } from "./schema.js"

/**
 * The subject types comments declare for their own records, so other features, such as reactions, can attach to a
 * thread or a comment. Whoever can see a thread can see it and its comments.
 */
export const commentSubjectTypes = { thread: "comments.thread", comment: "comments.comment" } as const

type FindThreads = (db: DatabaseAdapter, ids: readonly string[]) => Promise<Map<string, CommentThread>>

async function findRows<Row extends { id: string }>(db: DatabaseAdapter, model: string, ids: readonly string[]) {
  const lists = chunks([...new Set(ids)])
  const rows = await Promise.all(
    lists.map(async (list) => db.findMany<Row>({ model, where: [{ field: "id", operator: "in", value: list }] }))
  )
  return new Map(rows.flat().map((row) => [row.id, row]))
}

const threadsById: FindThreads = async (db, ids) => findRows<CommentThread>(db, threadModel, ids)

// A comment's thread, keyed by the comment's id.
const threadsOfComments: FindThreads = async (db, ids) => {
  const comments = await findRows<Comment>(db, commentModel, ids)
  const threads = await threadsById(
    db,
    [...comments.values()].map((comment) => comment.threadId)
  )
  const found = new Map<string, CommentThread>()
  for (const [id, comment] of comments) {
    const thread = threads.get(comment.threadId)
    if (thread) {
      found.set(id, thread)
    }
  }
  return found
}

function subjectOfThreads(config: Config, find: FindThreads): SubjectDefinition {
  const viewable = async (checks: readonly { actor: Actor | null; subjectId: string }[], context: SubjectContext) => {
    const threads = await find(
      context.db,
      checks.map((check) => check.subjectId)
    )
    const pairs = checks.flatMap(({ actor, subjectId }, index) => {
      const thread = threads.get(subjectId)
      return thread ? [{ index, actor, thread }] : []
    })
    const allowed = await canViewThreads(config.subjects, context.subjects, pairs)
    const result = checks.map(() => false)
    for (const [position, { index }] of pairs.entries()) {
      result[index] = allowed[position] === true
    }
    return result
  }
  return {
    canView: async (args, context) => (await viewable([args], context))[0] === true,
    canViewMany: viewable,
    getOrgId: async ({ subjectId }, context) => (await find(context.db, [subjectId])).get(subjectId)?.orgId || null,
    publicRead: async ({ subjectId }, context) => (await viewable([{ actor: null, subjectId }], context))[0] === true
  }
}

/** The subject types for comments' own records, with access following each thread's. */
export function commentSubjects(config: Config): Record<string, SubjectDefinition> {
  return {
    [commentSubjectTypes.thread]: subjectOfThreads(config, threadsById),
    [commentSubjectTypes.comment]: subjectOfThreads(config, threadsOfComments)
  }
}
