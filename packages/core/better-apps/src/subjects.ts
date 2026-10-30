import type { DatabaseAdapter } from "./database.js"
import { BetterAppsError } from "./errors.js"
import type { Actor, Identity } from "./identity.js"

/** A record features attach things to, such as an invoice: its subject type and id. */
export interface SubjectRef {
  subjectType: string
  subjectId: string
}

/** A subject, and the signed-in user asking about it. */
export interface SubjectArgs extends SubjectRef {
  actor: Actor
}

/** A subject, and who's asking about it: a signed-in user, or `null` for a signed-out visitor. */
export interface SubjectCheck extends SubjectRef {
  actor: Actor | null
}

/** What subject checks receive besides their arguments, for subject types that read Better Apps' own tables. */
export interface SubjectContext {
  db: DatabaseAdapter
  identity: Identity
  /** The app's subjects, for a subject type whose access follows another's, such as a comment's its thread's. */
  subjects: Subjects
}

/**
 * A kind of record features attach things to, such as `invoice`. The app answers who can see one, and every feature
 * enforces that answer on what it attaches, such as comments, reactions and attachments.
 */
export interface SubjectDefinition {
  /** Whether a signed-in user can see the subject, and so what features attach to it. */
  canView: (args: SubjectArgs, context: SubjectContext) => boolean | Promise<boolean>
  /**
   * `canView` for many user and subject pairs at once, in the same order, for lists, badges and mention checks. Apps
   * whose check is a query answer it in one. The default runs `canView` for each pair, concurrently.
   */
  canViewMany?:
    | ((pairs: readonly SubjectArgs[], context: SubjectContext) => readonly boolean[] | Promise<readonly boolean[]>)
    | undefined
  /**
   * The organization that owns the subject, which features store with what they attach so subject ids repeated across
   * organizations never mix. Required when the identity adapter reports organizations.
   */
  getOrgId?: ((ref: SubjectRef, context: SubjectContext) => string | null | Promise<string | null>) | undefined
  /** Lets signed-out visitors see the subject: `true` for every one, or a check per subject. Nobody, by default. */
  publicRead?: boolean | ((ref: SubjectRef, context: SubjectContext) => boolean | Promise<boolean>) | undefined
}

/** Declares a subject type outside the app's options and keeps its callbacks typed. */
export function defineSubject(subject: SubjectDefinition): SubjectDefinition {
  return subject
}

/** Who can see the app's subjects. Actions, subscribers and server code use it to check access the same way. */
export interface Subjects {
  /** Whether the app or one of its features declares a subject type. */
  has(subjectType: string): boolean
  /**
   * The organization that owns a subject, or `null`. Pass the actor a feature acts for: a subject type without
   * `getOrgId` throws when the actor belongs to an organization, rather than mixing organizations' data.
   */
  getOrgId(ref: SubjectRef, actor?: Actor | null): Promise<string | null>
  /** Whether someone can see a subject. A signed-out visitor, `null`, sees only public subjects. */
  canView(actor: Actor | null, ref: SubjectRef): Promise<boolean>
  /** `canView` for many pairs, in the same order, with one `canViewMany` call per subject type. */
  canViewMany(checks: readonly SubjectCheck[]): Promise<boolean[]>
  /** Whether signed-out visitors can see a subject. */
  isPublic(ref: SubjectRef): Promise<boolean>
}

/** The app's subject types, from its options and its features, answering access checks. */
export function createSubjects(
  declared: ReadonlyMap<string, SubjectDefinition>,
  options: { db: DatabaseAdapter; identity: Identity }
): Subjects {
  const definitionOf = (subjectType: string): SubjectDefinition => {
    const definition = declared.get(subjectType)
    if (!definition) {
      throw new BetterAppsError("INVALID_INPUT", `There's no "${subjectType}" subject type.`)
    }
    return definition
  }

  const isPublic = async (ref: SubjectRef): Promise<boolean> => {
    const { publicRead } = definitionOf(ref.subjectType)
    if (typeof publicRead === "function") {
      return (await publicRead(ref, context)) === true
    }
    return publicRead === true
  }

  const viewersOf = async (definition: SubjectDefinition, pairs: readonly SubjectArgs[]) => {
    if (pairs.length === 0) {
      return []
    }
    if (definition.canViewMany) {
      return definition.canViewMany(pairs, context)
    }
    return Promise.all(pairs.map(async (pair) => definition.canView(pair, context)))
  }

  const canViewMany = async (checks: readonly SubjectCheck[]): Promise<boolean[]> => {
    const allowed = checks.map(() => false)
    const byType = new Map<string, number[]>()
    for (const [index, check] of checks.entries()) {
      byType.set(check.subjectType, [...(byType.get(check.subjectType) ?? []), index])
    }
    await Promise.all(
      [...byType].map(async ([subjectType, indexes]) => {
        const definition = definitionOf(subjectType)
        const signedIn = indexes.filter((index) => checks[index]?.actor)
        const signedOut = indexes.filter((index) => !checks[index]?.actor)
        const pairs = signedIn.map((index) => checks[index] as SubjectArgs)
        const [viewers, visitors] = await Promise.all([
          viewersOf(definition, pairs),
          Promise.all(signedOut.map(async (index) => isPublic(checks[index] as SubjectRef)))
        ])
        for (const [position, index] of signedIn.entries()) {
          allowed[index] = viewers[position] === true
        }
        for (const [position, index] of signedOut.entries()) {
          allowed[index] = visitors[position] === true
        }
      })
    )
    return allowed
  }

  const subjects: Subjects = {
    has: (subjectType) => declared.has(subjectType),
    async getOrgId(ref, actor) {
      const definition = definitionOf(ref.subjectType)
      if (!definition.getOrgId) {
        if (actor && actor.orgId !== null) {
          throw new Error(
            `The "${ref.subjectType}" subject type needs getOrgId, because the identity adapter reports organizations.`
          )
        }
        return null
      }
      return (await definition.getOrgId(ref, context)) ?? null
    },
    async canView(actor, ref) {
      const [allowed] = await canViewMany([{ ...ref, actor }])
      return allowed === true
    },
    canViewMany,
    isPublic
  }
  const context: SubjectContext = { db: options.db, identity: options.identity, subjects }
  return subjects
}
