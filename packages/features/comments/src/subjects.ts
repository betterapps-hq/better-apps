import type { Actor, DatabaseAdapter, SubjectContext, SubjectDefinition, SubjectGrants } from "better-apps"
import { canViewThreads, viewThreads } from "./access.js"
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

// A comment's thread, keyed by the comment's id. A deleted comment has none, so nothing attaches to it any more.
const threadsOfComments: FindThreads = async (db, ids) => {
  const comments = await findRows<Comment>(db, commentModel, ids)
  const threads = await threadsById(
    db,
    [...comments.values()].map((comment) => comment.threadId)
  )
  const found = new Map<string, CommentThread>()
  for (const [id, comment] of comments) {
    const thread = threads.get(comment.threadId)
    if (thread && !comment.deletedAt) {
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
  const orgIds = async (refs: readonly { subjectId: string }[], context: SubjectContext) => {
    const threads = await find(
      context.db,
      refs.map((ref) => ref.subjectId)
    )
    return refs.map((ref) => threads.get(ref.subjectId)?.orgId || null)
  }
  return {
    canView: async (args, context) => (await viewable([args], context))[0] === true,
    canViewMany: viewable,
    getOrgId: async (ref, context) => (await orgIds([ref], context))[0] ?? null,
    getOrgIds: orgIds,
    publicRead: async ({ subjectId }, context) => (await viewable([{ actor: null, subjectId }], context))[0] === true,
    publicReadMany: async (refs, context) =>
      viewable(
        refs.map(({ subjectId }) => ({ actor: null, subjectId })),
        context
      )
  }
}

/** The subject types for comments' own records, with access following each thread's. */
export function commentSubjects(config: Config): Record<string, SubjectDefinition> {
  return {
    [commentSubjectTypes.thread]: subjectOfThreads(config, threadsById),
    [commentSubjectTypes.comment]: subjectOfThreads(config, threadsOfComments)
  }
}

/**
 * Lets a request see a thread and its comments, such as their reactions, when a grant it carries, such as a share link,
 * lets it see the thread's subject. Like reads, it reaches only default threads in their subject's current organization.
 */
export function commentGrants(config: Config): SubjectGrants {
  const finders: Record<string, FindThreads> = {
    [commentSubjectTypes.thread]: threadsById,
    [commentSubjectTypes.comment]: threadsOfComments
  }
  return {
    async canViewMany(checks, _args, context) {
      const answers = checks.map(() => false)
      await Promise.all(
        Object.entries(finders).map(async ([subjectType, find]) => {
          const indexes = checks.flatMap((check, index) => (check.subjectType === subjectType ? [index] : []))
          if (indexes.length === 0) {
            return
          }
          const threads = await find(
            context.db,
            indexes.map((index) => checks[index]?.subjectId ?? "")
          )
          const pairs = indexes.flatMap((index) => {
            const check = checks[index]
            const thread = threads.get(check?.subjectId ?? "")
            return check && thread ? [{ index, actor: null, thread, request: check.request }] : []
          })
          const views = await viewThreads(config.subjects, context.subjects, pairs)
          for (const [position, { index }] of pairs.entries()) {
            answers[index] = views[position] !== null
          }
        })
      )
      return answers
    }
  }
}
