/** Who a request acts for, as the identity adapter sees them. */
export interface Actor {
  userId: string
  /** The organization the user is acting in, or `null` for apps and users without organizations. */
  orgId: string | null
  /** The user's roles in that organization. */
  roles: readonly string[]
}

/**
 * Who a write is attributed to: a signed-in user, or, from server code, someone outside the identity provider, such as
 * an email sender or a sync job.
 */
export type Author =
  | { type: "user"; userId: string }
  | { type: "external"; name: string }
  | { type: "system"; name: string }

/** What features show for a user, such as a comment's author. */
export interface IdentityUser {
  id: string
  name: string | null
  email?: string | null | undefined
  image?: string | null | undefined
}

/** Reads users from the app's identity provider. Features never call the provider themselves. */
export interface Identity {
  /** The user a request acts for, or `null` when nobody is signed in. */
  getActor(request: Request): Promise<Actor | null>
  /**
   * Builds actors for users who aren't making the request, in one call, so a feature can check what, say, the people
   * mentioned in a comment can see. Users who aren't members of the organization are left out.
   */
  getActorsFor(userIds: readonly string[], orgId: string | null): Promise<Actor[]>
  /** Looks up names and avatars. Users that can't be found are left out. */
  getUsers?(userIds: readonly string[]): Promise<IdentityUser[]>
  /** Suggests users for a search, such as a mention, among an organization's members. */
  searchUsers?(query: string, options: { orgId: string | null; limit?: number | undefined }): Promise<IdentityUser[]>
  /** The model of a local user table, such as Better Auth's `user`, so feature tables can reference it. */
  userTable?: string | undefined
}

/** The one user of an app without sign-in. */
export interface LocalUser {
  /** The default is `local`. */
  id?: string | undefined
  /** The default is `Local user`. */
  name?: string | undefined
  email?: string | null | undefined
  image?: string | null | undefined
  roles?: readonly string[] | undefined
}

/**
 * An identity for apps without sign-in, such as a local tool or an example app. Every request acts as the same user,
 * outside any organization.
 */
export function localIdentity(user: LocalUser = {}): Identity {
  const id = user.id ?? "local"
  const profile: IdentityUser = { id, name: user.name ?? "Local user", email: user.email, image: user.image }
  const actor: Actor = { userId: id, orgId: null, roles: user.roles ?? [] }
  return {
    getActor: async () => actor,
    getActorsFor: async (userIds, orgId) => (orgId === null && userIds.includes(id) ? [actor] : []),
    getUsers: async (userIds) => (userIds.includes(id) ? [profile] : []),
    searchUsers: async (query, { orgId }) => {
      const text = query.trim().toLowerCase()
      const matches = [profile.name, profile.email].some((value) => value?.toLowerCase().includes(text))
      return orgId === null && matches ? [profile] : []
    }
  }
}
