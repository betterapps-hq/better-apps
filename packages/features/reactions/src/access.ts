import type { ActionContext, Actor, SubjectRef, Subjects } from "better-apps"
import { ReactionsError } from "./errors.js"
import type { ReactionRules } from "./options.js"

export type Context = ActionContext<unknown>

/**
 * Server code that passes neither an actor nor a request is trusted, so its reads skip access checks. It can't react,
 * since a reaction is always someone's.
 */
export function isTrusted(context: Context): boolean {
  return context.source === "api" && context.actor === null && context.request === null
}

/** The organization that owns a subject, or `""` when the app has none. */
export async function orgOf(subjects: Subjects, ref: SubjectRef, actor: Actor | null): Promise<string> {
  return (await subjects.getOrgId(ref, actor)) ?? ""
}

/** The organizations that own many subjects, in order, with one lookup per subject type. */
export async function orgsOf(subjects: Subjects, refs: readonly SubjectRef[], actor: Actor | null): Promise<string[]> {
  return (await subjects.getOrgIds(refs, actor)).map((orgId) => orgId ?? "")
}

/**
 * Which subjects a caller can see the reactions of: trusted server code sees all, a signed-out visitor sees public
 * ones, and anyone else what `canView` allows, each checked in one call per subject type.
 */
export async function viewable(context: Context, refs: readonly SubjectRef[]): Promise<boolean[]> {
  if (isTrusted(context)) {
    return refs.map(() => true)
  }
  const { actor, subjects } = context
  if (!actor) {
    return subjects.isPublicMany(refs)
  }
  return subjects.canViewMany(refs.map((ref) => ({ actor, ...ref })))
}

/** Refuses a read of a subject the caller can't see: `UNAUTHENTICATED` when signing in might help, else `NOT_FOUND`. */
export async function requireView(context: Context, ref: SubjectRef): Promise<void> {
  const [allowed] = await viewable(context, [ref])
  if (allowed) {
    return
  }
  if (!context.actor && !isTrusted(context)) {
    throw new ReactionsError("UNAUTHENTICATED", "Sign in to see these reactions.")
  }
  throw new ReactionsError("NOT_FOUND", "That record doesn't exist, or you can't see it.")
}

/** The signed-in user who can see a subject, such as to take back their own reaction, or the error that says why not. */
export async function requireViewer(context: Context, ref: SubjectRef): Promise<Actor> {
  const { actor, subjects } = context
  if (!actor) {
    throw new ReactionsError("UNAUTHENTICATED", "Sign in to react.")
  }
  if (!(await subjects.canView(actor, ref))) {
    throw new ReactionsError("NOT_FOUND", "That record doesn't exist, or you can't see it.")
  }
  return actor
}

/** The signed-in user who may react to a subject, or the error that says why they can't. */
export async function requireReactor(rules: ReactionRules, context: Context, ref: SubjectRef): Promise<Actor> {
  const actor = await requireViewer(context, ref)
  if (rules.canReact && !(await rules.canReact({ actor, ...ref }))) {
    throw new ReactionsError("FORBIDDEN", "You can't react to this.")
  }
  return actor
}

/** Whether the caller is trusted server code, or a signed-in user `canModerate` allows on the subject. */
export async function isModerator(rules: ReactionRules, context: Context, ref: SubjectRef): Promise<boolean> {
  if (isTrusted(context)) {
    return true
  }
  const { actor } = context
  return actor !== null && rules.canModerate !== undefined && (await rules.canModerate({ actor, ...ref }))
}

/** Allows trusted server code, and signed-in users who can see the subject and moderate its reactions. */
export async function requireModerator(rules: ReactionRules, context: Context, ref: SubjectRef): Promise<void> {
  if (isTrusted(context)) {
    return
  }
  const { actor, subjects } = context
  if (!actor) {
    throw new ReactionsError("UNAUTHENTICATED", "Sign in to remove reactions.")
  }
  if (!(await subjects.canView(actor, ref))) {
    throw new ReactionsError("NOT_FOUND", "That record doesn't exist, or you can't see it.")
  }
  if (!rules.canModerate || !(await rules.canModerate({ actor, ...ref }))) {
    throw new ReactionsError("FORBIDDEN", "You can't remove other people's reactions here.")
  }
}
