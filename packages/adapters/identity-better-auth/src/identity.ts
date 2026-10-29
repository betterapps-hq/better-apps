import type { Actor, Identity, IdentityUser } from "better-apps"

/** A condition in a query through Better Auth's database adapter. */
export interface BetterAuthWhere {
  field: string
  value: string | string[]
  operator?: "eq" | "in" | "contains" | undefined
  connector?: "AND" | "OR" | undefined
  mode?: "sensitive" | "insensitive" | undefined
}

/** The reads the identity makes through Better Auth's database adapter, whichever database it runs on. */
export interface BetterAuthDatabase {
  findOne<T>(data: { model: string; where: BetterAuthWhere[] }): Promise<T | null>
  findMany<T>(data: {
    model: string
    where?: BetterAuthWhere[] | undefined
    select?: string[] | undefined
    sortBy?: { field: string; direction: "asc" | "desc" } | undefined
    limit?: number | undefined
    offset?: number | undefined
  }): Promise<T[]>
  count(data: { model: string; where?: BetterAuthWhere[] | undefined }): Promise<number>
}

/** The parts of a Better Auth instance, the one `betterAuth()` returns, that the identity reads. */
export interface BetterAuthInstance {
  // `object &` keeps an app's options assignable when they set neither field.
  options: object & {
    user?: { modelName?: string | undefined } | undefined
    plugins?: readonly { id: string }[] | undefined
  }
  api: {
    getSession(context: {
      headers: Headers
      query?: { disableRefresh?: boolean | undefined } | undefined
      asResponse?: false | undefined
      returnHeaders?: false | undefined
    }): Promise<{
      user: { id: string }
      session: { userId: string; activeOrganizationId?: string | null | undefined }
    } | null>
  }
  $context: Promise<{ adapter: BetterAuthDatabase }>
}

/** Options for `betterAuthIdentity`. */
export interface BetterAuthIdentityOptions {
  /**
   * Whether `searchUsers` with no organization searches every user. The default is true without the organization
   * plugin, for apps without organizations, and false with it, so nobody outside an organization can look through every
   * user's name and email.
   */
  searchOutsideOrgs?: boolean | undefined
}

// Better Auth's user and member models, the fields the identity reads.
interface UserRow {
  id: string
  name: string
  email: string
  image?: string | null | undefined
}

interface MemberRow {
  userId: string
  role: string
}

// Cloudflare D1 binds at most 100 parameters per statement, so ids are queried 90 at a time, leaving room for the rest.
const idsPerQuery = 90
const userFields = ["id", "name", "email", "image"]
// A search reads an organization of up to this many members in full, and reads at most this many users in a larger one.
const searchedInFull = 1000

/**
 * An identity that reads users from a Better Auth instance: the signed-in user from the request's session, and, with
 * the organization plugin, the session's active organization and the member's roles in it. It never writes sessions, so
 * sign-in, refresh and sign-out stay with Better Auth.
 */
export function betterAuthIdentity(auth: BetterAuthInstance, options: BetterAuthIdentityOptions = {}): Identity {
  const organizations = auth.options.plugins?.some((plugin) => plugin.id === "organization") ?? false
  const searchOutsideOrgs = options.searchOutsideOrgs ?? !organizations
  const database = async () => (await auth.$context).adapter

  const findUsers = async (db: BetterAuthDatabase, ids: readonly string[]) => {
    const pages = await Promise.all(
      chunk(ids, idsPerQuery).map((page) =>
        db.findMany<UserRow>({
          model: "user",
          where: [{ field: "id", operator: "in", value: page }],
          select: userFields,
          limit: page.length
        })
      )
    )
    return new Map(pages.flat().map((user) => [user.id, user]))
  }

  const findMembers = async (db: BetterAuthDatabase, orgId: string, ids: readonly string[]) => {
    const pages = await Promise.all(
      chunk(ids, idsPerQuery).map((page) =>
        db.findMany<MemberRow>({
          model: "member",
          where: [
            { field: "organizationId", value: orgId },
            { field: "userId", operator: "in", value: page }
          ],
          select: ["userId", "role"],
          limit: page.length
        })
      )
    )
    return new Map(pages.flat().map((member) => [member.userId, member]))
  }

  return {
    getActor: async (request) => {
      // Refreshing would write a cookie that never reaches the browser, so the session is only read.
      const result = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } })
      if (!result) {
        return null
      }
      const userId = result.user.id
      const orgId = result.session.activeOrganizationId
      if (!orgId || !organizations) {
        return { userId, orgId: null, roles: [] }
      }
      const db = await database()
      const member = await db.findOne<MemberRow>({
        model: "member",
        where: [
          { field: "organizationId", value: orgId },
          { field: "userId", value: userId }
        ]
      })
      // A session can name an organization the user has since left. They act outside it until they choose another.
      return member ? { userId, orgId, roles: parseRoles(member.role) } : { userId, orgId: null, roles: [] }
    },
    getActorsFor: async (userIds, orgId) => {
      const ids = unique(userIds)
      if (ids.length === 0 || (orgId !== null && !organizations)) {
        return []
      }
      const db = await database()
      if (orgId === null) {
        const users = await findUsers(db, ids)
        return ids.flatMap((id): Actor[] => (users.has(id) ? [{ userId: id, orgId: null, roles: [] }] : []))
      }
      const [users, members] = await Promise.all([findUsers(db, ids), findMembers(db, orgId, ids)])
      return ids.flatMap((id): Actor[] => {
        const member = members.get(id)
        return member && users.has(id) ? [{ userId: id, orgId, roles: parseRoles(member.role) }] : []
      })
    },
    getUsers: async (userIds) => {
      const ids = unique(userIds)
      if (ids.length === 0) {
        return []
      }
      const users = await findUsers(await database(), ids)
      return ids.flatMap((id) => {
        const user = users.get(id)
        return user ? [toProfile(user)] : []
      })
    },
    searchUsers: async (query, { orgId, limit = 10 }) => {
      if (limit <= 0 || (orgId === null ? !searchOutsideOrgs : !organizations)) {
        return []
      }
      const text = query.trim().toLowerCase()
      const db = await database()
      const byText = (offset: number, pageLimit: number) =>
        db.findMany<UserRow>({
          model: "user",
          where: text
            ? [
                { field: "name", operator: "contains", value: text, mode: "insensitive", connector: "OR" },
                { field: "email", operator: "contains", value: text, mode: "insensitive", connector: "OR" }
              ]
            : [],
          select: userFields,
          sortBy: { field: "name", direction: "asc" },
          limit: pageLimit,
          offset
        })
      if (orgId === null) {
        return (await byText(0, limit)).map(toProfile)
      }
      // The organization's members and the name match can't go in one query, because Better Auth's adapters don't all
      // group an AND with ORs the same way. So a search reads one side a page at a time and checks the other.
      const inOrg = [{ field: "organizationId", value: orgId }]
      const found: IdentityUser[] = []
      const members = await db.count({ model: "member", where: inOrg })
      if (!text || members <= searchedInFull) {
        // Reads the members and keeps those whose name or email matches, until it has enough.
        for (let offset = 0; offset < members && found.length < limit; offset += idsPerQuery) {
          const page = await db.findMany<{ userId: string }>({
            model: "member",
            where: inOrg,
            // Sorting by a column that isn't selected fails on some adapters.
            select: ["id", "userId"],
            sortBy: { field: "id", direction: "asc" },
            limit: idsPerQuery,
            offset
          })
          const users = await findUsers(
            db,
            page.map((member) => member.userId)
          )
          const matches = [...users.values()]
            .filter((user) => [user.name, user.email].some((value) => value.toLowerCase().includes(text)))
            .sort((a, b) => a.name.localeCompare(b.name))
          found.push(...matches.slice(0, limit - found.length).map(toProfile))
        }
        return found
      }
      // A larger organization would take too many reads, so the database finds the users whose name or email matches,
      // and the members among them are kept. A short query that matches over 1,000 users can miss some members; a
      // longer one narrows it.
      for (let offset = 0; offset < searchedInFull && found.length < limit; offset += idsPerQuery) {
        const users = await byText(offset, idsPerQuery)
        const inThisOrg = await findMembers(
          db,
          orgId,
          users.map((user) => user.id)
        )
        found.push(
          ...users
            .filter((user) => inThisOrg.has(user.id))
            .slice(0, limit - found.length)
            .map(toProfile)
        )
        if (users.length < idsPerQuery) {
          break
        }
      }
      return found
    },
    userTable: auth.options.user?.modelName ?? "user"
  }
}

/** Better Auth's organization plugin stores several roles as one comma-separated string. */
function parseRoles(role: string): string[] {
  return unique(
    role
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
  )
}

function toProfile(user: UserRow): IdentityUser {
  return { id: user.id, name: user.name || null, email: user.email, image: user.image ?? null }
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
