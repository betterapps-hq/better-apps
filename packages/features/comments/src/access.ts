import type { Actor } from "better-apps"
import { CommentsError } from "./errors.js"
import type { SubjectArgs, SubjectType } from "./options.js"
import type { CommentThread } from "./schema.js"

/** What a caller may do with a subject's threads in one visibility. */
export interface Access {
  view: boolean
  comment: boolean
  moderate: boolean
}

/** Who a call acts as. Server code that names no actor is trusted, so access checks pass. */
export interface Caller {
  actor: Actor | null
  trusted: boolean
}

const everything: Access = { view: true, comment: true, moderate: true }
const nothing: Access = { view: false, comment: false, moderate: false }

/** The subject type registered under a name, or `INVALID_INPUT`. */
export function subjectOf(subjects: Readonly<Record<string, SubjectType>>, subjectType: string): SubjectType {
  if (!Object.hasOwn(subjects, subjectType)) {
    throw new CommentsError("INVALID_INPUT", `Comments aren't set up for the "${subjectType}" subject type.`)
  }
  return subjects[subjectType] as SubjectType
}

/** The organization that owns a subject, or `""` when the app has none. */
export async function orgOf(subject: SubjectType, caller: Caller, subjectType: string, subjectId: string) {
  if (!subject.getOrgId) {
    if (caller.actor && caller.actor.orgId !== null) {
      throw new Error(
        `The "${subjectType}" subject type needs getOrgId, because the identity adapter reports organizations.`
      )
    }
    return ""
  }
  return (await subject.getOrgId({ subjectType, subjectId })) ?? ""
}

/** Whether a visibility is `default` or one the subject type declares. */
export function isDeclaredVisibility(subject: SubjectType, visibility: string): boolean {
  return visibility === "default" || (subject.visibility !== undefined && Object.hasOwn(subject.visibility, visibility))
}

/** The visibilities an actor can see on a subject, `default` first. */
export async function visibleTo(subject: SubjectType, args: SubjectArgs): Promise<string[]> {
  const declared = Object.entries(subject.visibility ?? {})
  const passed = await Promise.all(declared.map(async ([, check]) => check(args)))
  return ["default", ...declared.flatMap(([name], index) => (passed[index] ? [name] : []))]
}

/** What a caller may do with the threads of a subject in one visibility. */
export async function accessTo(
  subject: SubjectType,
  caller: Caller,
  subjectType: string,
  subjectId: string,
  visibility: string
): Promise<Access> {
  if (caller.trusted) {
    return everything
  }
  const { actor } = caller
  if (!actor) {
    return { ...nothing, view: subject.publicRead === true && visibility === "default" }
  }
  const args = { actor, subjectType, subjectId }
  const check = visibility === "default" ? undefined : subject.visibility?.[visibility]
  const [view, visible] = await Promise.all([subject.canView(args), check ? check(args) : visibility === "default"])
  if (!view || !visible) {
    return nothing
  }
  const [comment, moderate] = await Promise.all([subject.canComment(args), subject.canModerate?.(args) ?? false])
  return { view: true, comment, moderate }
}

/** Refuses a read the caller can't make: `UNAUTHENTICATED` when signing in might help, else `NOT_FOUND`. */
export function requireView(access: Access, subject: SubjectType, caller: Caller): void {
  if (!access.view) {
    throw caller.actor === null && !caller.trusted && !subject.publicRead
      ? new CommentsError("UNAUTHENTICATED", "Sign in to see these comments.")
      : new CommentsError("NOT_FOUND", "That thread doesn't exist, or you can't see it.")
  }
}

/** `canView` for many pairs, through `canViewMany` when the subject type has it. */
export async function canViewMany(subject: SubjectType, pairs: readonly SubjectArgs[]): Promise<readonly boolean[]> {
  if (pairs.length === 0) {
    return []
  }
  return subject.canViewMany
    ? subject.canViewMany(pairs)
    : Promise.all(pairs.map(async (pair) => subject.canView(pair)))
}

/**
 * The one rule for whether someone can see a thread: its organization must be its subject's, `canView` must pass, and
 * the actor must pass the thread's visibility check. Reads, mentions, notifications and live updates all use it.
 */
export async function canViewThread(
  subject: SubjectType,
  actor: Actor | null,
  thread: CommentThread,
  subjectOrgId: string
): Promise<boolean> {
  if (thread.orgId !== subjectOrgId) {
    return false
  }
  const access = await accessTo(
    subject,
    { actor, trusted: false },
    thread.subjectType,
    thread.subjectId,
    thread.visibility
  )
  return access.view
}

/**
 * Which of several actors may be mentioned in a thread: `canMention` when the subject type has it, else whether they
 * can view the thread, checked with one `canViewMany` call.
 */
export async function mentionable(
  subject: SubjectType,
  actors: readonly Actor[],
  thread: CommentThread
): Promise<Actor[]> {
  if (subject.canMention) {
    const allowed = await Promise.all(actors.map(async (actor) => subject.canMention?.({ actor, thread })))
    return actors.filter((_, index) => allowed[index])
  }
  const { subjectType, subjectId, visibility } = thread
  const viewers = await canViewMany(
    subject,
    actors.map((actor) => ({ actor, subjectType, subjectId }))
  )
  const check = visibility === "default" ? undefined : subject.visibility?.[visibility]
  const candidates = actors.filter((_, index) => viewers[index])
  if (!check) {
    return visibility === "default" ? candidates : []
  }
  const visible = await Promise.all(candidates.map(async (actor) => check({ actor, subjectType, subjectId })))
  return candidates.filter((_, index) => visible[index])
}
