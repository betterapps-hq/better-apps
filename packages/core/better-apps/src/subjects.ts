import type { DatabaseAdapter } from "./database.js"
import { BetterAppsError } from "./errors.js"
import type { Actor, Identity } from "./identity.js"
import type { ErrorContext } from "./outbox.js"

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
  /**
   * The request the person asking made, so access it carries, such as a share link they opened, counts too. Pass it
   * only when the check is about that person, and leave it out for writes.
   */
  request?: Request | null | undefined
}

/** Options for a single `canView` check. */
export interface ViewOptions {
  /** The request the person asking made, so grants it carries count. See `SubjectCheck.request`. */
  request?: Request | null | undefined
}

/** A subject a feature's grants are asked about, and the request whose grants count. */
export interface GrantCheck extends SubjectRef {
  request: Request
}

/** What a feature's grants receive besides the checks. */
export interface GrantArgs {
  /**
   * Reports an error the grants recovered from, such as a lookup that failed and so granted nothing, to the app's
   * `onError`, named as the feature's, handing the report to a checked request's `waitUntil` when one has it. It never
   * throws, and it doesn't wait for the report.
   */
  reportError: (error: unknown) => void
}

/**
 * Access a request carries besides the app's rules, such as a share link a visitor opened, which a feature declares as
 * its `grants`. It only widens checks that pass the request, and only for seeing subjects.
 */
export interface SubjectGrants {
  /**
   * Which of the subjects each check's request may see, in the same order. It's asked only about checks the app's rules
   * refuse, once per call of `canViewMany`, with every request in it, such as one per live connection, so it can read
   * what they all carry in one query. A subject asked twice for the same request is asked once.
   */
  canViewMany(
    checks: readonly GrantCheck[],
    args: GrantArgs,
    context: SubjectContext
  ): readonly boolean[] | Promise<readonly boolean[]>
}

/** A feature's grants, and the feature they're reported as. */
interface FeatureGrants {
  feature: string
  grants: SubjectGrants
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
  /**
   * `getOrgId` for many subjects at once, in the same order, for lists. Apps whose lookup is a query answer it in one.
   * The default runs `getOrgId` for each subject, concurrently.
   */
  getOrgIds?:
    | ((
        refs: readonly SubjectRef[],
        context: SubjectContext
      ) => readonly (string | null)[] | Promise<readonly (string | null)[]>)
    | undefined
  /** Lets signed-out visitors see the subject: `true` for every one, or a check per subject. Nobody, by default. */
  publicRead?: boolean | ((ref: SubjectRef, context: SubjectContext) => boolean | Promise<boolean>) | undefined
  /**
   * `publicRead` for many subjects at once, in the same order, for lists that signed-out visitors load. The default runs
   * `publicRead` for each subject, concurrently.
   */
  publicReadMany?:
    | ((refs: readonly SubjectRef[], context: SubjectContext) => readonly boolean[] | Promise<readonly boolean[]>)
    | undefined
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
  /** `getOrgId` for many subjects, in the same order, with one `getOrgIds` call per subject type. */
  getOrgIds(refs: readonly SubjectRef[], actor?: Actor | null): Promise<(string | null)[]>
  /**
   * Whether someone can see a subject. A signed-out visitor, `null`, sees only public subjects. With the request they
   * made, access it carries, such as a share link, counts too.
   */
  canView(actor: Actor | null, ref: SubjectRef, options?: ViewOptions): Promise<boolean>
  /**
   * `canView` for many checks, in the same order, with one `canViewMany` call per subject type, and one call of each
   * feature's grants per request for the checks the app's rules refuse.
   */
  canViewMany(checks: readonly SubjectCheck[]): Promise<boolean[]>
  /** Whether signed-out visitors can see a subject. */
  isPublic(ref: SubjectRef): Promise<boolean>
  /** `isPublic` for many subjects, in the same order, with one `publicReadMany` call per subject type. */
  isPublicMany(refs: readonly SubjectRef[]): Promise<boolean[]>
}

/** The app's subject types, from its options and its features, answering access checks. */
export function createSubjects(
  declared: ReadonlyMap<string, SubjectDefinition>,
  options: {
    db: DatabaseAdapter
    identity: Identity
    grants?: readonly FeatureGrants[] | undefined
    /** Reports a grant's error as its feature's, with the requests it was checking. It never throws. */
    reportError?: ((error: unknown, context: ErrorContext, requests: readonly Request[]) => void) | undefined
  }
): Subjects {
  const grants = options.grants ?? []
  const definitionOf = (subjectType: string): SubjectDefinition => {
    const definition = declared.get(subjectType)
    if (!definition) {
      throw new BetterAppsError("INVALID_INPUT", `There's no "${subjectType}" subject type.`)
    }
    return definition
  }

  /** `publicRead` for one subject, for subject types without `publicReadMany`. */
  const publicReadOne = async (ref: SubjectRef): Promise<boolean> => {
    const { publicRead } = definitionOf(ref.subjectType)
    if (typeof publicRead === "function") {
      return (await publicRead(ref, context)) === true
    }
    return publicRead === true
  }

  /** Runs a lookup once per subject type over that type's subjects, and puts the answers back in the callers' order. */
  const byType = async <Ref extends SubjectRef, Answer>(
    refs: readonly Ref[],
    fallback: Answer,
    lookup: (definition: SubjectDefinition, refs: Ref[]) => Promise<readonly Answer[]>
  ): Promise<Answer[]> => {
    const answers = refs.map(() => fallback)
    const groups = new Map<string, number[]>()
    for (const [index, ref] of refs.entries()) {
      groups.set(ref.subjectType, [...(groups.get(ref.subjectType) ?? []), index])
    }
    await Promise.all(
      [...groups].map(async ([subjectType, indexes]) => {
        const found = await lookup(
          definitionOf(subjectType),
          indexes.map((index) => refs[index] as Ref)
        )
        for (const [position, index] of indexes.entries()) {
          answers[index] = found[position] ?? fallback
        }
      })
    )
    return answers
  }

  const isPublicMany = async (refs: readonly SubjectRef[]): Promise<boolean[]> =>
    byType(refs, false, async (definition, group) => {
      if (group.length === 0) {
        return []
      }
      if (definition.publicReadMany) {
        return (await definition.publicReadMany(group, context)).map((allowed) => allowed === true)
      }
      return Promise.all(group.map(async (ref) => publicReadOne(ref)))
    })

  const viewersOf = async (definition: SubjectDefinition, pairs: readonly SubjectArgs[]) => {
    if (pairs.length === 0) {
      return []
    }
    if (definition.canViewMany) {
      return definition.canViewMany(pairs, context)
    }
    return Promise.all(pairs.map(async (pair) => definition.canView(pair, context)))
  }

  const byRules = async (checks: readonly SubjectCheck[]): Promise<boolean[]> =>
    byType(checks, false, async (definition, group) => {
      const signedIn = group.flatMap((check, index) => (check.actor ? [index] : []))
      const signedOut = group.flatMap((check, index) => (check.actor ? [] : [index]))
      const [viewers, visitors] = await Promise.all([
        viewersOf(
          definition,
          signedIn.map((index) => group[index] as SubjectArgs)
        ),
        isPublicMany(signedOut.map((index) => group[index] as SubjectRef))
      ])
      const allowed = group.map(() => false)
      for (const [position, index] of signedIn.entries()) {
        allowed[index] = viewers[position] === true
      }
      for (const [position, index] of signedOut.entries()) {
        allowed[index] = visitors[position] === true
      }
      return allowed
    })

  /**
   * Widens the app's answers with the grants each check's request carries, asking each feature once about every refused
   * check that carries a request, with repeated ones asked once.
   */
  const canViewMany = async (checks: readonly SubjectCheck[]): Promise<boolean[]> => {
    const allowed = await byRules(checks)
    if (grants.length === 0) {
      return allowed
    }
    const requestIds = new Map<Request, number>()
    const asked = new Map<string, { check: GrantCheck; indexes: number[] }>()
    for (const [index, { subjectType, subjectId, request }] of checks.entries()) {
      if (allowed[index] || !request) {
        continue
      }
      if (!requestIds.has(request)) {
        requestIds.set(request, requestIds.size)
      }
      const key = JSON.stringify([requestIds.get(request), subjectType, subjectId])
      const found = asked.get(key) ?? { check: { subjectType, subjectId, request }, indexes: [] }
      found.indexes.push(index)
      asked.set(key, found)
    }
    if (asked.size === 0) {
      return allowed
    }
    const askedChecks = [...asked.values()].map(({ check }) => check)
    const requests = [...requestIds.keys()]
    const answers = await Promise.all(
      grants.map(async ({ feature, grants: granted }) => {
        const reportError = (error: unknown) => options.reportError?.(error, { feature }, requests)
        try {
          return await granted.canViewMany(askedChecks, { reportError }, context)
        } catch (error) {
          // A grant that fails grants nothing, rather than failing the check and other features' grants with it.
          reportError(error)
          return askedChecks.map(() => false)
        }
      })
    )
    for (const [position, { indexes }] of [...asked.values()].entries()) {
      if (answers.some((granted) => granted[position] === true)) {
        for (const index of indexes) {
          allowed[index] = true
        }
      }
    }
    return allowed
  }

  const subjects: Subjects = {
    has: (subjectType) => declared.has(subjectType),
    async getOrgId(ref, actor) {
      const [orgId] = await subjects.getOrgIds([ref], actor)
      return orgId ?? null
    },
    getOrgIds: async (refs, actor) =>
      byType<SubjectRef, string | null>(refs, null, async (definition, group) => {
        if (definition.getOrgIds) {
          return definition.getOrgIds(group, context)
        }
        const { getOrgId } = definition
        if (!getOrgId) {
          if (actor && actor.orgId !== null) {
            throw new Error(
              `The "${(group[0] as SubjectRef).subjectType}" subject type needs getOrgId, because the identity adapter reports organizations.`
            )
          }
          return []
        }
        return Promise.all(group.map(async (ref) => (await getOrgId(ref, context)) ?? null))
      }),
    async canView(actor, ref, { request } = {}) {
      const [allowed] = await canViewMany([{ ...ref, actor, request }])
      return allowed === true
    },
    canViewMany,
    // The same rules as lists, so a subject type with only `publicReadMany` answers alike either way.
    async isPublic(ref) {
      const [allowed] = await isPublicMany([ref])
      return allowed === true
    },
    isPublicMany
  }
  const context: SubjectContext = { db: options.db, identity: options.identity, subjects }
  return subjects
}
