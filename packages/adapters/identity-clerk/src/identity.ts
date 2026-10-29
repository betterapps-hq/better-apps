import { createClerkClient } from "@clerk/backend"
import type { Actor, Identity, IdentityUser } from "better-apps"

/** A Clerk user, the fields the identity reads. */
export interface ClerkUser {
  id: string
  firstName: string | null
  lastName: string | null
  username: string | null
  imageUrl: string
  primaryEmailAddressId: string | null
  emailAddresses: readonly { id: string; emailAddress: string }[]
}

/** A membership in a Clerk organization, the fields the identity reads. */
export interface ClerkMembership {
  /** The member's role, such as `org:admin`. */
  role: string
  publicUserData?: { userId: string } | null | undefined
}

/** The signed-in state Clerk reads from a request, the fields the identity reads. */
export interface ClerkAuth {
  userId: string | null
  orgId?: string | null | undefined
  orgRole?: string | null | undefined
}

/** The parts of a Clerk backend client, the one `createClerkClient` returns, that the identity calls. */
export interface ClerkIdentityClient {
  authenticateRequest(
    request: Request,
    options?: { authorizedParties?: string[] | undefined }
  ): Promise<{ toAuth(): ClerkAuth | null }>
  users: {
    getUserList(params: {
      userId?: string[]
      query?: string
      organizationId?: string[]
      limit?: number
      offset?: number
    }): Promise<{ data: ClerkUser[] }>
  }
  organizations: {
    getOrganizationMembershipList(params: {
      organizationId: string
      userId?: string[]
      limit?: number
    }): Promise<{ data: ClerkMembership[] }>
  }
}

/** Options for `clerkIdentity`: a Clerk client to share, or the keys to create one. */
export type ClerkIdentityOptions = (
  | { clerkClient: ClerkIdentityClient }
  | { clerkClient?: undefined; secretKey: string; publishableKey: string }
) & {
  /** The origins allowed to send session tokens, such as `https://app.example.com`. Clerk recommends setting them. */
  authorizedParties?: string[] | undefined
  /**
   * Whether `searchUsers` with no organization searches every user, for apps without organizations. The default is
   * false, so nobody outside an organization can look through every user's name and email.
   */
  searchOutsideOrgs?: boolean | undefined
}

// Clerk filters by at most 100 user ids per call and returns at most 500 results per page.
const idsPerCall = 100
const pageSize = 500
const concurrentCalls = 5

/**
 * An identity that reads users from Clerk: the signed-in user, their active organization and role from the request's
 * session token, and other users and memberships from Clerk's backend API. Roles drop Clerk's `org:` prefix, so
 * `org:admin` becomes `admin`. Sign-in and sessions stay with Clerk's own packages.
 */
export function clerkIdentity(options: ClerkIdentityOptions): Identity {
  const clerk =
    options.clerkClient ?? createClerkClient({ secretKey: options.secretKey, publishableKey: options.publishableKey })
  const { authorizedParties, searchOutsideOrgs = false } = options

  const findUsers = async (ids: readonly string[]) => {
    const pages = await mapConcurrently(chunk(ids, idsPerCall), concurrentCalls, (page) =>
      clerk.users.getUserList({ userId: page, limit: page.length })
    )
    return new Map(pages.flatMap((page) => page.data).map((user) => [user.id, user]))
  }

  const findRoles = async (orgId: string, ids: readonly string[]) => {
    const pages = await mapConcurrently(chunk(ids, idsPerCall), concurrentCalls, async (page) => {
      try {
        const { data } = await clerk.organizations.getOrganizationMembershipList({
          organizationId: orgId,
          userId: page,
          limit: page.length
        })
        return data
      } catch (error) {
        // An organization that no longer exists has no members.
        if (isNotFound(error)) {
          return []
        }
        throw error
      }
    })
    return new Map(
      pages.flat().flatMap((membership) => {
        const userId = membership.publicUserData?.userId
        return userId ? [[userId, roleName(membership.role)] as const] : []
      })
    )
  }

  return {
    getActor: async (request) => {
      const state = await clerk.authenticateRequest(request, { authorizedParties })
      const auth = state.toAuth()
      if (!auth?.userId) {
        return null
      }
      if (!auth.orgId) {
        return { userId: auth.userId, orgId: null, roles: [] }
      }
      return { userId: auth.userId, orgId: auth.orgId, roles: auth.orgRole ? [roleName(auth.orgRole)] : [] }
    },
    getActorsFor: async (userIds, orgId) => {
      const ids = unique(userIds)
      if (ids.length === 0) {
        return []
      }
      if (orgId === null) {
        const users = await findUsers(ids)
        return ids.flatMap((id): Actor[] => (users.has(id) ? [{ userId: id, orgId: null, roles: [] }] : []))
      }
      const roles = await findRoles(orgId, ids)
      return ids.flatMap((id): Actor[] => {
        const role = roles.get(id)
        return role === undefined ? [] : [{ userId: id, orgId, roles: [role] }]
      })
    },
    getUsers: async (userIds) => {
      const ids = unique(userIds)
      const users = ids.length === 0 ? new Map<string, ClerkUser>() : await findUsers(ids)
      return ids.flatMap((id) => {
        const user = users.get(id)
        return user ? [toProfile(user)] : []
      })
    },
    searchUsers: async (query, { orgId, limit = 10 }) => {
      if (limit <= 0 || (orgId === null && !searchOutsideOrgs)) {
        return []
      }
      const text = query.trim()
      const found: IdentityUser[] = []
      while (found.length < limit) {
        const size = Math.min(limit - found.length, pageSize)
        const { data } = await clerk.users.getUserList({
          ...(text ? { query: text } : {}),
          ...(orgId === null ? {} : { organizationId: [orgId] }),
          limit: size,
          offset: found.length
        })
        found.push(...data.map(toProfile))
        if (data.length < size) {
          break
        }
      }
      return found
    }
  }
}

/** Clerk prefixes organization roles with `org:`. Other providers don't, so it's dropped. */
function roleName(role: string): string {
  return role.startsWith("org:") ? role.slice("org:".length) : role
}

function toProfile(user: ClerkUser): IdentityUser {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || null
  const email = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)?.emailAddress ?? null
  return { id: user.id, name, email, image: user.imageUrl || null }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
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
