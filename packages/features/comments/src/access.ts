import type { Actor, SubjectArgs, SubjectCheck, SubjectRef, Subjects } from "better-apps"
import { CommentsError } from "./errors.js"
import type { CommentRules } from "./options.js"
import type { CommentThread } from "./schema.js"

/** What a caller may do with a subject's threads in one visibility. */
export interface Access {
  view: boolean
  comment: boolean
  moderate: boolean
  /** Whether the caller is signed out and the subject isn't public, so signing in might help. */
  signInMayHelp: boolean
  /**
   * Whether only a grant the request carries, such as a share link, lets the caller see the threads. Such a caller sees
   * them as a signed-out reader does, and can't comment.
   */
  granted: boolean
}

/** Who a call acts as. Server code that names no actor is trusted, so access checks pass. */
export interface Caller {
  actor: Actor | null
  trusted: boolean
}

const everything: Access = { view: true, comment: true, moderate: true, signInMayHelp: false, granted: false }

/** Access that allows nothing. */
export const nothing: Access = { view: false, comment: false, moderate: false, signInMayHelp: false, granted: false }

/** Access that lets the caller read a subject's default threads through a grant, and nothing more. */
const grantedView: Access = { ...nothing, view: true, granted: true }

/** The comment rules registered for a subject type, or `INVALID_INPUT`. */
export function subjectOf(rules: Readonly<Record<string, CommentRules>>, subjectType: string): CommentRules {
  if (!Object.hasOwn(rules, subjectType)) {
    throw new CommentsError("INVALID_INPUT", `Comments aren't set up for the "${subjectType}" subject type.`)
  }
  return rules[subjectType] as CommentRules
}

/** The organization that owns a subject, or `""` when the app has none. */
export async function orgOf(subjects: Subjects, caller: Caller, ref: SubjectRef): Promise<string> {
  return (await subjects.getOrgId(ref, caller.actor)) ?? ""
}

/** Whether a visibility is `default` or one the subject type declares. */
export function isDeclaredVisibility(rules: CommentRules, visibility: string): boolean {
  return visibility === "default" || (rules.visibility !== undefined && Object.hasOwn(rules.visibility, visibility))
}

/** The visibilities an actor can see on a subject, `default` first. */
export async function visibleTo(rules: CommentRules, args: SubjectArgs): Promise<string[]> {
  const declared = Object.entries(rules.visibility ?? {})
  const passed = await Promise.all(declared.map(async ([, check]) => check(args)))
  return ["default", ...declared.flatMap(([name], index) => (passed[index] ? [name] : []))]
}

/**
 * What a caller may do with the threads of a subject in one visibility. Reads pass the request, so a grant it carries,
 * such as a share link, lets the caller read the subject's default threads; writes leave it out.
 */
export async function accessTo(
  rules: CommentRules,
  subjects: Subjects,
  caller: Caller,
  ref: SubjectRef,
  visibility: string,
  request?: Request | null
): Promise<Access> {
  const access = await accessByRules(rules, subjects, caller, ref, visibility)
  if (access.view || !request || visibility !== "default") {
    return access
  }
  return (await subjects.canView(caller.actor, ref, { request })) ? grantedView : access
}

async function accessByRules(
  rules: CommentRules,
  subjects: Subjects,
  caller: Caller,
  ref: SubjectRef,
  visibility: string
): Promise<Access> {
  if (caller.trusted) {
    return everything
  }
  const { actor } = caller
  if (!actor) {
    const isPublic = await subjects.isPublic(ref)
    return { ...nothing, view: isPublic && visibility === "default", signInMayHelp: !isPublic }
  }
  const args = { actor, ...ref }
  const check = visibility === "default" ? undefined : rules.visibility?.[visibility]
  const [view, visible] = await Promise.all([
    subjects.canView(actor, ref),
    check ? check(args) : visibility === "default"
  ])
  if (!view || !visible) {
    return nothing
  }
  const [comment, moderate] = await Promise.all([rules.canComment(args), rules.canModerate?.(args) ?? false])
  return { view: true, comment, moderate, signInMayHelp: false, granted: false }
}

/** Refuses a read the caller can't make: `UNAUTHENTICATED` when signing in might help, else `NOT_FOUND`. */
export function requireView(access: Access): void {
  if (!access.view) {
    throw access.signInMayHelp
      ? new CommentsError("UNAUTHENTICATED", "Sign in to see these comments.")
      : new CommentsError("NOT_FOUND", "That thread doesn't exist, or you can't see it.")
  }
}

/** How someone sees a thread: by the app's rules, only through a grant their request carries, or not at all. */
export type ThreadView = "rules" | "granted" | null

/**
 * The one rule for whether people can see threads: a thread's organization must be its subject's current one, the
 * viewer must be able to see the subject, and must pass the thread's visibility check. Reads, mentions, notifications
 * and live updates all use it. Each subject's `canViewMany` runs once.
 */
export async function canViewThreads(
  rules: Readonly<Record<string, CommentRules>>,
  subjects: Subjects,
  pairs: readonly { actor: Actor | null; thread: CommentThread }[]
): Promise<boolean[]> {
  return (await viewThreads(rules, subjects, pairs)).map((view) => view !== null)
}

/**
 * How each viewer sees a thread, by the rule `canViewThreads` applies. A pair with the viewer's request may also see a
 * default thread through a grant it carries, such as a share link to its subject, asked once for the threads the
 * app's rules refuse. Only reads about the person who made the request pass it.
 */
export async function viewThreads(
  rules: Readonly<Record<string, CommentRules>>,
  subjects: Subjects,
  pairs: readonly { actor: Actor | null; thread: CommentThread; request?: Request | null | undefined }[]
): Promise<ThreadView[]> {
  const placed = await inPlace(rules, subjects, pairs)
  const allowed = await viewThreadsByRules(rules, subjects, pairs, placed)
  const views: ThreadView[] = allowed.map((seen) => (seen ? "rules" : null))
  const candidates = pairs.flatMap(({ thread, request }, index) =>
    !allowed[index] && request && placed[index] && thread.visibility === "default" ? [index] : []
  )
  const granted = await canViewDistinct(
    subjects,
    candidates.map((index) => {
      const { actor, thread, request } = pairs[index] as (typeof pairs)[number]
      return { actor, subjectType: thread.subjectType, subjectId: thread.subjectId, request }
    })
  )
  for (const [position, index] of candidates.entries()) {
    if (granted[position]) {
      views[index] = "granted"
    }
  }
  return views
}

/**
 * Whether each thread is on a subject type comments are set up for, and in its subject's current organization, with
 * one organization lookup per subject type for the threads' distinct subjects.
 */
async function inPlace(
  rules: Readonly<Record<string, CommentRules>>,
  subjects: Subjects,
  pairs: readonly { actor: Actor | null; thread: CommentThread }[]
): Promise<boolean[]> {
  // Threads on a subject type comments are no longer set up for can't be seen.
  const known = pairs.map(({ thread }) => Object.hasOwn(rules, thread.subjectType) && subjects.has(thread.subjectType))
  const keyOf = ({ subjectType, subjectId }: SubjectRef) => JSON.stringify([subjectType, subjectId])
  const refs = new Map<string, SubjectRef>()
  for (const [index, { thread }] of pairs.entries()) {
    if (known[index]) {
      refs.set(keyOf(thread), { subjectType: thread.subjectType, subjectId: thread.subjectId })
    }
  }
  const signedIn = pairs.find(({ actor }) => actor !== null)?.actor ?? null
  const found = await subjects.getOrgIds([...refs.values()], signedIn)
  const orgs = new Map([...refs.keys()].map((key, index) => [key, found[index] ?? ""]))
  return pairs.map(({ thread }, index) => known[index] === true && orgs.get(keyOf(thread)) === thread.orgId)
}

/**
 * `canViewMany` for checks that may repeat, such as one per comment on the same record, asking about each distinct
 * actor, subject and request once.
 */
async function canViewDistinct(subjects: Subjects, checks: readonly SubjectCheck[]): Promise<boolean[]> {
  if (checks.length === 0) {
    return []
  }
  const ids = new Map<object, number>()
  const idOf = (value: object | null | undefined) => {
    if (!value) {
      return null
    }
    if (!ids.has(value)) {
      ids.set(value, ids.size)
    }
    return ids.get(value) ?? null
  }
  const distinct = new Map<string, SubjectCheck>()
  const keys = checks.map((check) => {
    const key = JSON.stringify([idOf(check.actor), idOf(check.request), check.subjectType, check.subjectId])
    distinct.set(key, check)
    return key
  })
  const answers = await subjects.canViewMany([...distinct.values()])
  const byKey = new Map([...distinct.keys()].map((key, index) => [key, answers[index] === true]))
  return keys.map((key) => byKey.get(key) === true)
}

async function viewThreadsByRules(
  rules: Readonly<Record<string, CommentRules>>,
  subjects: Subjects,
  pairs: readonly { actor: Actor | null; thread: CommentThread }[],
  placed: readonly boolean[]
): Promise<boolean[]> {
  const candidates = pairs.flatMap((_, index) => (placed[index] ? [index] : []))
  const viewers = await canViewDistinct(
    subjects,
    candidates.map((index) => {
      const { actor, thread } = pairs[index] as (typeof pairs)[number]
      return { actor, subjectType: thread.subjectType, subjectId: thread.subjectId }
    })
  )
  const allowed = pairs.map(() => false)
  await Promise.all(
    candidates.map(async (index, position) => {
      const { actor, thread } = pairs[index] as (typeof pairs)[number]
      if (!viewers[position]) {
        return
      }
      if (thread.visibility === "default") {
        allowed[index] = true
        return
      }
      const declared = rules[thread.subjectType]?.visibility ?? {}
      const check = Object.hasOwn(declared, thread.visibility) ? declared[thread.visibility] : undefined
      allowed[index] =
        actor !== null &&
        check !== undefined &&
        Boolean(await check({ actor, subjectType: thread.subjectType, subjectId: thread.subjectId }))
    })
  )
  return allowed
}

/** Whether someone can see a thread, by the rule `canViewThreads` applies. */
export async function canViewThread(
  rules: Readonly<Record<string, CommentRules>>,
  subjects: Subjects,
  actor: Actor | null,
  thread: CommentThread
): Promise<boolean> {
  const [allowed] = await canViewThreads(rules, subjects, [{ actor, thread }])
  return allowed === true
}

/**
 * Which of several actors may be mentioned in a thread: `canMention` when the subject type has it, else whether they
 * can view the thread, checked with one `canViewMany` call.
 */
export async function mentionable(
  rules: Readonly<Record<string, CommentRules>>,
  subjects: Subjects,
  actors: readonly Actor[],
  thread: CommentThread
): Promise<Actor[]> {
  const { canMention } = subjectOf(rules, thread.subjectType)
  if (canMention) {
    const allowed = await Promise.all(actors.map(async (actor) => canMention({ actor, thread })))
    return actors.filter((_, index) => allowed[index])
  }
  const allowed = await canViewThreads(
    rules,
    subjects,
    actors.map((actor) => ({ actor, thread }))
  )
  return actors.filter((_, index) => allowed[index])
}
