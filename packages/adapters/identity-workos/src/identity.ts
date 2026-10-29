import { WorkOS } from "@workos-inc/node"
import type { Actor, Identity, IdentityUser } from "better-apps"

/** A WorkOS user, the fields the identity reads. */
export interface WorkOSUser {
  id: string
  email: string
  name?: string | null | undefined
  firstName: string | null
  lastName: string | null
  profilePictureUrl: string | null
}

/** A membership in a WorkOS organization, the fields the identity reads. */
export interface WorkOSMembership {
  userId: string
  status: "active" | "inactive" | "pending"
  role: { slug: string }
  roles?: { slug: string }[] | undefined
}

/** A page of a WorkOS list. */
export interface WorkOSList<T> {
  data: T[]
  listMetadata: { after?: string | null | undefined }
}

/** What WorkOS reads from a session cookie, the fields the identity reads. */
export type WorkOSAuthentication =
  | { authenticated: false }
  | {
      authenticated: true
      user: { id: string }
      organizationId?: string | undefined
      role?: string | undefined
      roles?: string[] | undefined
    }

/** The parts of a WorkOS client, the one `new WorkOS()` creates, that the identity calls. */
export interface WorkOSIdentityClient {
  userManagement: {
    loadSealedSession(options: { sessionData: string; cookiePassword: string }): {
      authenticate(): Promise<WorkOSAuthentication>
    }
    getUser(userId: string): Promise<WorkOSUser>
    listUsers(options: { organizationId?: string; limit?: number; after?: string }): Promise<WorkOSList<WorkOSUser>>
    listOrganizationMemberships(options: {
      organizationId: string
      userId: string
      statuses?: ("active" | "inactive" | "pending")[]
    }): Promise<WorkOSList<WorkOSMembership>>
  }
}

/** Options for `workosIdentity`: a WorkOS client to share, or the keys to create one, and the session cookie. */
export type WorkOSIdentityOptions = (
  | { workos: WorkOSIdentityClient }
  | { workos?: undefined; apiKey: string; clientId: string }
) & {
  /** The password AuthKit seals the session cookie with. */
  cookiePassword: string
  /** The default is `wos-session`, AuthKit's. */
  cookieName?: string | undefined
  /**
   * Whether `searchUsers` with no organization searches every user, for apps without organizations. The default is
   * false, so nobody outside an organization can look through every user's name and email.
   */
  searchOutsideOrgs?: boolean | undefined
}

// WorkOS returns at most 100 results per page, and a search reads at most 10 of them. Users are cached for a minute, at
// most 1,000 of them.
const pageSize = 100
const pagesSearched = 10
const concurrentCalls = 10
const cacheTime = 60_000
const cacheSize = 1000

/**
 * An identity that reads users from WorkOS: the signed-in user, their organization and roles from AuthKit's sealed
 * session cookie, and other users and memberships from WorkOS's user management API. It never refreshes the session,
 * since the new cookie couldn't reach the browser, so sign-in and refresh stay with AuthKit.
 */
export function workosIdentity(options: WorkOSIdentityOptions): Identity {
  const workos = options.workos ?? new WorkOS(options.apiKey, { clientId: options.clientId })
  const { cookiePassword, cookieName = "wos-session", searchOutsideOrgs = false } = options
  const users = new Map<string, { expiresAt: number; user: Promise<IdentityUser | null> }>()

  /** Looks a user up, or reuses a lookup from the last minute. Users that don't exist are remembered too. */
  const getUser = (userId: string) => {
    const now = Date.now()
    const cached = users.get(userId)
    users.delete(userId)
    if (cached && cached.expiresAt > now) {
      users.set(userId, cached)
      return cached.user
    }
    const user = workos.userManagement.getUser(userId).then(toProfile, (error: unknown) => {
      if (isNotFound(error)) {
        return null
      }
      throw error
    })
    users.set(userId, { expiresAt: now + cacheTime, user })
    if (users.size > cacheSize) {
      users.delete(users.keys().next().value!)
    }
    // A failed lookup isn't remembered.
    user.catch(() => {
      if (users.get(userId)?.user === user) {
        users.delete(userId)
      }
    })
    return user
  }

  const getMembership = async (orgId: string, userId: string) => {
    try {
      const { data } = await workos.userManagement.listOrganizationMemberships({
        organizationId: orgId,
        userId,
        statuses: ["active"]
      })
      return data.find((membership) => membership.userId === userId && membership.status === "active")
    } catch (error) {
      // An organization or user that no longer exists has no membership.
      if (isNotFound(error)) {
        return undefined
      }
      throw error
    }
  }

  return {
    getActor: async (request) => {
      const sessionData = readCookie(request, cookieName)
      if (!sessionData) {
        return null
      }
      const session = await workos.userManagement.loadSealedSession({ sessionData, cookiePassword }).authenticate()
      if (!session.authenticated) {
        return null
      }
      if (!session.organizationId) {
        return { userId: session.user.id, orgId: null, roles: [] }
      }
      // `roles` lists every role when the member has several, and `role` is the main one.
      let roles = session.roles ?? []
      if (roles.length === 0 && session.role) {
        roles = [session.role]
      }
      return { userId: session.user.id, orgId: session.organizationId, roles: unique(roles) }
    },
    getActorsFor: async (userIds, orgId) => {
      const ids = unique(userIds)
      if (orgId === null) {
        const found = await mapConcurrently(ids, concurrentCalls, getUser)
        return ids.flatMap((id, index): Actor[] => (found[index] ? [{ userId: id, orgId: null, roles: [] }] : []))
      }
      const memberships = await mapConcurrently(ids, concurrentCalls, (id) => getMembership(orgId, id))
      return ids.flatMap((id, index): Actor[] => {
        const membership = memberships[index]
        if (!membership) {
          return []
        }
        const roles = membership.roles?.length ? membership.roles : [membership.role]
        return [{ userId: id, orgId, roles: unique(roles.map((role) => role.slug)) }]
      })
    },
    getUsers: async (userIds) => {
      const found = await mapConcurrently(unique(userIds), concurrentCalls, getUser)
      return found.filter((user) => user !== null)
    },
    searchUsers: async (query, { orgId, limit = 10 }) => {
      if (limit <= 0 || (orgId === null && !searchOutsideOrgs)) {
        return []
      }
      // WorkOS has no text search, so this reads the users a page at a time and keeps those whose name or email
      // matches, until it has enough. It stops after the first 1,000 users, so a keystroke never reads a large
      // organization end to end.
      const text = query.trim().toLowerCase()
      const found: IdentityUser[] = []
      let after: string | undefined
      let pages = 0
      do {
        pages += 1
        const page = await workos.userManagement.listUsers({
          ...(orgId === null ? {} : { organizationId: orgId }),
          limit: pageSize,
          ...(after ? { after } : {})
        })
        for (const user of page.data) {
          const profile = toProfile(user)
          if ([profile.name, profile.email].some((value) => value?.toLowerCase().includes(text))) {
            found.push(profile)
            if (found.length === limit) {
              return found
            }
          }
        }
        after = page.listMetadata.after ?? undefined
      } while (after && pages < pagesSearched)
      return found
    }
  }
}

function toProfile(user: WorkOSUser): IdentityUser {
  const name = user.name || [user.firstName, user.lastName].filter(Boolean).join(" ") || null
  return { id: user.id, name, email: user.email, image: user.profilePictureUrl }
}

/** Reads a cookie from a request's `Cookie` header. */
function readCookie(request: Request, name: string): string | undefined {
  for (const pair of request.headers.get("cookie")?.split(";") ?? []) {
    const separator = pair.indexOf("=")
    if (separator !== -1 && pair.slice(0, separator).trim() === name) {
      const value = pair.slice(separator + 1).trim()
      try {
        return decodeURIComponent(value)
      } catch {
        return value
      }
    }
  }
  return undefined
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

/**
 * Maps items to calls, running at most `limit` at a time, and returns the results in order. Once a call fails, such as
 * on a rate limit, no more calls start.
 */
async function mapConcurrently<T, R>(items: readonly T[], limit: number, call: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  let failed = false
  const run = async () => {
    while (!failed && next < items.length) {
      const index = next++
      try {
        results[index] = await call(items[index]!)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}
