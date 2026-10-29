import type { Actor, Identity, IdentityUser } from "better-apps"

/** A user of a test identity. */
export interface TestUser {
  id: string
  name?: string | null | undefined
  email?: string | null | undefined
  image?: string | null | undefined
  /** The organization the user belongs to. The default is none. */
  orgId?: string | null | undefined
  roles?: readonly string[] | undefined
}

/** An identity that acts as whichever test user a request names. */
export interface TestIdentity extends Identity {
  /** The actor a user acts as, for `app.api` calls. */
  actor(userId: string): Actor
  /** Headers that make a request to `app.handler` act as the user. */
  headers(userId: string): Record<string, string>
}

/** The header a test request names its user in. */
export const testUserHeader = "x-better-apps-test-user"

/**
 * An identity for tests, with a fixed list of users, each in at most one organization. A request acts as the user its
 * `x-better-apps-test-user` header names. It trusts that header, so never use it outside tests.
 */
export function testIdentity(
  users: readonly TestUser[],
  options: { userTable?: string | undefined } = {}
): TestIdentity {
  const byId = new Map(users.map((user) => [user.id, user]))
  const toActor = (user: TestUser): Actor => ({ userId: user.id, orgId: user.orgId ?? null, roles: user.roles ?? [] })
  const toProfile = (user: TestUser): IdentityUser => ({
    id: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
    image: user.image ?? null
  })
  const actor = (userId: string) => {
    const user = byId.get(userId)
    if (!user) {
      throw new Error(`There is no test user "${userId}".`)
    }
    return toActor(user)
  }
  return {
    actor,
    headers: (userId) => {
      actor(userId)
      return { [testUserHeader]: userId }
    },
    getActor: async (request) => {
      const user = byId.get(request.headers.get(testUserHeader) ?? "")
      return user ? toActor(user) : null
    },
    getActorsFor: async (userIds, orgId) =>
      userIds.flatMap((id) => {
        const user = byId.get(id)
        return user && (user.orgId ?? null) === orgId ? [toActor(user)] : []
      }),
    getUsers: async (userIds) =>
      userIds.flatMap((id) => {
        const user = byId.get(id)
        return user ? [toProfile(user)] : []
      }),
    searchUsers: async (query, { orgId, limit = 10 }) => {
      const text = query.trim().toLowerCase()
      return users
        .filter((user) => (user.orgId ?? null) === orgId)
        .filter((user) => [user.name, user.email].some((value) => value?.toLowerCase().includes(text)))
        .slice(0, limit)
        .map(toProfile)
    },
    userTable: options.userTable
  }
}
