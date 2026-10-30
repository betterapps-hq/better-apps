import type { AnchorKind } from "@better-apps/anchors"
import {
  BetterAppsError,
  type ActionContext,
  type Author,
  type FieldAttribute,
  type IdentityUser,
  type StandardSchemaV1
} from "better-apps"
import { accessTo, mentionable, nothing, orgOf, subjectOf, type Access, type Caller } from "./access.js"
import { CommentsError } from "./errors.js"
import type { BodyFormat } from "./formats.js"
import type { BeforeHooks, CommentRules, HookArgs } from "./options.js"
import { threadModel, type Comment, type CommentThread } from "./schema.js"

/** The options, resolved once when the feature is created. */
export interface Config {
  subjects: Readonly<Record<string, CommentRules>>
  anchors: ReadonlyMap<string, AnchorKind>
  formats: ReadonlyMap<string, BodyFormat>
  hooks: BeforeHooks
  threadFields: Readonly<Record<string, FieldAttribute>>
  commentFields: Readonly<Record<string, FieldAttribute>>
}

export type Context = ActionContext<unknown>

/**
 * Who a call acts as. Server code that passes neither an actor nor a request is trusted, so its reads and writes skip
 * access checks; server code acting for a request or an actor is checked as that user.
 */
export function callerOf(context: Context): Caller {
  return {
    actor: context.actor,
    trusted: context.source === "api" && context.actor === null && context.request === null
  }
}

/** The author of a write, or `UNAUTHENTICATED` without one. */
export function requireAuthor(context: Context): Author {
  if (!context.author) {
    throw new CommentsError("UNAUTHENTICATED", "Sign in to comment.")
  }
  return context.author
}

/** The id stored for an author: a user id, or the id server code gave an external or system author. */
export function authorIdOf(author: Author): string {
  return author.type === "user" ? author.userId : (author.id ?? "")
}

/** Whether an author wrote a comment. */
export function wrote(author: Author, comment: Comment): boolean {
  return comment.authorType === author.type && comment.authorId === authorIdOf(author)
}

/** A thread by id, or `NOT_FOUND`. */
export async function loadThread(context: Context, threadId: string): Promise<CommentThread> {
  const thread = await context.db.findOne<CommentThread>({
    model: threadModel,
    where: [{ field: "id", value: threadId }]
  })
  if (!thread) {
    throw new CommentsError("NOT_FOUND", "That thread doesn't exist, or you can't see it.")
  }
  return thread
}

/** What the caller may do with a thread. A thread outside its subject's current organization can't be seen. */
export async function threadAccess(config: Config, context: Context, thread: CommentThread) {
  const rules = subjectOf(config.subjects, thread.subjectType)
  const caller = callerOf(context)
  const ref = { subjectType: thread.subjectType, subjectId: thread.subjectId }
  let access: Access = nothing
  if (caller.trusted || (await orgOf(context.subjects, caller, ref)) === thread.orgId) {
    access = await accessTo(rules, context.subjects, caller, ref, thread.visibility)
  }
  return { rules, caller, access }
}

/** Refuses an action the caller can view but can't take. */
export function forbid(allowed: boolean, message: string): void {
  if (!allowed) {
    throw new CommentsError("FORBIDDEN", message)
  }
}

/**
 * Runs a before hook and checks what it returns with the action's schema. A `BetterAppsError`, such as a
 * `CommentsError`, keeps its code; any other error becomes `REJECTED_BY_HOOK`.
 */
export async function runHook<Input>(
  hook: ((args: HookArgs<Input>) => Input | Promise<Input>) | undefined,
  args: HookArgs<Input>,
  schema: StandardSchemaV1
): Promise<Input> {
  if (!hook) {
    return args.input
  }
  let changed: Input
  try {
    changed = await hook(args)
  } catch (error) {
    if (error instanceof BetterAppsError) {
      throw error
    }
    throw new CommentsError("REJECTED_BY_HOOK", "The change was refused.", { cause: error })
  }
  const result = await schema["~standard"].validate(changed)
  if (result.issues) {
    throw new CommentsError("INVALID_INPUT", "The input a hook returned isn't valid.", { issues: result.issues })
  }
  return result.value as Input
}

/** Splits ids into lists of at most 90, under D1's limit of 100 bound parameters. */
export function chunks<Item>(items: readonly Item[], size = 90): Item[][] {
  const lists: Item[][] = []
  for (let start = 0; start < items.length; start += size) {
    lists.push(items.slice(start, start + size))
  }
  return lists
}

/** Looks up users' names and avatars, keyed by id. Users the identity adapter can't find are left out. */
export async function lookupUsers(context: Context, ids: Iterable<string>): Promise<Record<string, IdentityUser>> {
  const unique = [...new Set(ids)].filter((id) => id !== "")
  const { getUsers } = context.identity
  if (!getUsers || unique.length === 0) {
    return {}
  }
  const found = await Promise.all(chunks(unique).map(async (list) => getUsers.call(context.identity, list)))
  return Object.fromEntries(found.flat().map((user) => [user.id, user]))
}

/**
 * Which mentioned users may be mentioned in a thread. They're built with one `getActorsFor` call, so users outside the
 * thread's organization are dropped, then checked with `canMention` or one `canViewMany` call. The author is skipped.
 */
export async function checkMentions(
  config: Config,
  context: Context,
  thread: CommentThread,
  mentions: readonly string[],
  authorId: string
): Promise<{ allowed: string[]; dropped: string[] }> {
  const others = mentions.filter((id) => id !== authorId)
  if (others.length === 0) {
    return { allowed: [], dropped: [] }
  }
  const actors = await context.identity.getActorsFor(others, thread.orgId === "" ? null : thread.orgId)
  const allowed = new Set(
    (await mentionable(config.subjects, context.subjects, actors, thread)).map((actor) => actor.userId)
  )
  return { allowed: others.filter((id) => allowed.has(id)), dropped: others.filter((id) => !allowed.has(id)) }
}
