import { DatabaseSync } from "node:sqlite"
import { betterAuth, type BetterAuthOptions } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { organization } from "better-auth/plugins/organization"
import { describe, expect, it, vi } from "vite-plus/test"
import { betterAuthIdentity } from "./index.js"

const baseURL = "https://app.test"
const common = {
  baseURL,
  secret: "a-test-secret-that-is-at-least-32-characters",
  emailAndPassword: { enabled: true },
  telemetry: { enabled: false },
  logger: { level: "error" }
} satisfies BetterAuthOptions

/** A Better Auth instance with the organization plugin, on a fresh in-memory database. */
async function createAuth(options: Pick<BetterAuthOptions, "session" | "user"> = {}) {
  const database = new DatabaseSync(":memory:")
  const auth = betterAuth({ ...common, ...options, database, plugins: [organization()] })
  await migrate(auth.options)
  return { auth, ...helpers(auth.handler, database) }
}

async function createAuthWithoutOrganizations() {
  const database = new DatabaseSync(":memory:")
  const auth = betterAuth({ ...common, database })
  await migrate(auth.options)
  return { auth, ...helpers(auth.handler, database) }
}

async function migrate(options: BetterAuthOptions) {
  const { runMigrations } = await getMigrations(options)
  await runMigrations()
}

function helpers(handler: (request: Request) => Promise<Response>, database: DatabaseSync) {
  /** Signs up the way a browser does and returns the headers it sends afterwards, with the session cookie. */
  const signUp = async (name: string, email: string) => {
    const response = await handler(
      new Request(`${baseURL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseURL },
        body: JSON.stringify({ name, email, password: "correct horse battery staple" })
      })
    )
    const { user } = (await response.json()) as { user: { id: string } }
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    return { user, headers: new Headers({ cookie }) }
  }

  /** Adds users straight to the database, faster than signing each one up. */
  const addUsers = (
    count: number,
    name: (index: number) => string = (index) => `User ${index}`,
    email: (index: number) => string = (index) => `user${index}@example.com`
  ) => {
    const insert = database.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)"
    )
    return Array.from({ length: count }, (_, index) => {
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      insert.run(id, name(index), email(index), now, now)
      return id
    })
  }

  const addMembers = (organizationId: string, userIds: readonly string[], role = "member") => {
    const insert = database.prepare(
      "INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)"
    )
    for (const userId of userIds) {
      insert.run(crypto.randomUUID(), organizationId, userId, role, new Date().toISOString())
    }
  }

  const request = (headers?: Headers) => new Request(`${baseURL}/api/apps/notes/add`, { method: "POST", headers })

  return { database, signUp, addUsers, addMembers, request }
}

async function createOrganizationApp() {
  const setup = await createAuth()
  const { auth, signUp } = setup
  const ada = await signUp("Ada Lovelace", "ada@example.com")
  const grace = await signUp("Grace Hopper", "grace@example.com")
  const alan = await signUp("Alan Turing", "alan@example.com")
  const acme = await auth.api.createOrganization({ body: { name: "Acme", slug: "acme" }, headers: ada.headers })
  await auth.api.addMember({ body: { userId: grace.user.id, organizationId: acme.id, role: ["admin", "member"] } })
  return { ...setup, ada, grace, alan, acme }
}

describe("betterAuthIdentity", () => {
  describe("getActor", () => {
    it("acts as nobody without a session or with an invalid one", async () => {
      const { auth, request } = await createAuth()
      const identity = betterAuthIdentity(auth)
      expect(await identity.getActor(request())).toBeNull()
      expect(
        await identity.getActor(request(new Headers({ cookie: "better-auth.session_token=forged.value" })))
      ).toBeNull()
    })

    it("acts outside any organization until the session chooses one", async () => {
      const { auth, signUp, request } = await createAuth()
      const ada = await signUp("Ada Lovelace", "ada@example.com")
      expect(await betterAuthIdentity(auth).getActor(request(ada.headers))).toEqual({
        userId: ada.user.id,
        orgId: null,
        roles: []
      })
    })

    it("acts in the session's active organization with the member's roles", async () => {
      const { auth, ada, grace, acme, request } = await createOrganizationApp()
      const identity = betterAuthIdentity(auth)
      expect(await identity.getActor(request(ada.headers))).toEqual({
        userId: ada.user.id,
        orgId: acme.id,
        roles: ["owner"]
      })

      await auth.api.setActiveOrganization({ body: { organizationId: acme.id }, headers: grace.headers })
      expect(await identity.getActor(request(grace.headers))).toEqual({
        userId: grace.user.id,
        orgId: acme.id,
        roles: ["admin", "member"]
      })
    })

    it("acts outside the organization once the user is no longer a member", async () => {
      const { auth, database, ada, request } = await createOrganizationApp()
      database.prepare("DELETE FROM member WHERE userId = ?").run(ada.user.id)
      expect(await betterAuthIdentity(auth).getActor(request(ada.headers))).toEqual({
        userId: ada.user.id,
        orgId: null,
        roles: []
      })
    })

    it("acts as nobody once the session expires", async () => {
      const { auth, database, signUp, request } = await createAuth()
      const ada = await signUp("Ada Lovelace", "ada@example.com")
      database.prepare("UPDATE session SET expiresAt = ?").run(new Date(Date.now() - 1000).toISOString())
      expect(await betterAuthIdentity(auth).getActor(request(ada.headers))).toBeNull()
    })

    it("reads the session without refreshing it", async () => {
      const { auth, database, signUp, request } = await createAuth({ session: { updateAge: 0 } })
      const ada = await signUp("Ada Lovelace", "ada@example.com")
      const expiresAt = () => database.prepare("SELECT expiresAt FROM session").get()?.expiresAt
      const before = expiresAt()
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(await betterAuthIdentity(auth).getActor(request(ada.headers))).toMatchObject({ userId: ada.user.id })
      expect(expiresAt()).toBe(before)
    })

    it("acts outside any organization without the organization plugin", async () => {
      const { auth, signUp, request } = await createAuthWithoutOrganizations()
      const ada = await signUp("Ada Lovelace", "ada@example.com")
      expect(await betterAuthIdentity(auth).getActor(request(ada.headers))).toEqual({
        userId: ada.user.id,
        orgId: null,
        roles: []
      })
    })
  })

  describe("getActorsFor", () => {
    it("builds actors for the organization's members in the order asked, leaving out everyone else", async () => {
      const { auth, ada, grace, alan, acme } = await createOrganizationApp()
      const identity = betterAuthIdentity(auth)
      expect(
        await identity.getActorsFor([grace.user.id, alan.user.id, "missing", ada.user.id, grace.user.id], acme.id)
      ).toEqual([
        { userId: grace.user.id, orgId: acme.id, roles: ["admin", "member"] },
        { userId: ada.user.id, orgId: acme.id, roles: ["owner"] }
      ])
      expect(await identity.getActorsFor([ada.user.id], "another-org")).toEqual([])
      expect(await identity.getActorsFor([], acme.id)).toEqual([])
    })

    it("builds actors outside any organization for every user that exists", async () => {
      const { auth, ada, alan } = await createOrganizationApp()
      expect(await betterAuthIdentity(auth).getActorsFor([alan.user.id, "missing", ada.user.id], null)).toEqual([
        { userId: alan.user.id, orgId: null, roles: [] },
        { userId: ada.user.id, orgId: null, roles: [] }
      ])
    })

    it("queries long lists of users in pages", async () => {
      const { auth, addUsers, addMembers, acme } = await createOrganizationApp()
      const ids = addUsers(200)
      const members = ids.filter((_, index) => index % 2 === 0)
      addMembers(acme.id, members)
      const identity = betterAuthIdentity(auth)
      expect(await identity.getActorsFor(ids, acme.id)).toEqual(
        members.map((userId) => ({ userId, orgId: acme.id, roles: ["member"] }))
      )
      expect(await identity.getActorsFor(ids, null)).toHaveLength(200)
    })

    it("leaves out everyone for an organization without the organization plugin", async () => {
      const { auth, signUp } = await createAuthWithoutOrganizations()
      const ada = await signUp("Ada Lovelace", "ada@example.com")
      const identity = betterAuthIdentity(auth)
      expect(await identity.getActorsFor([ada.user.id], "acme")).toEqual([])
      expect(await identity.getActorsFor([ada.user.id], null)).toEqual([
        { userId: ada.user.id, orgId: null, roles: [] }
      ])
    })
  })

  describe("getUsers", () => {
    it("looks up names, emails and avatars, leaving out users that don't exist", async () => {
      const { auth, database, addUsers, ada, grace } = await createOrganizationApp()
      database.prepare("UPDATE user SET image = ? WHERE id = ?").run("https://example.com/grace.png", grace.user.id)
      const [unnamed] = addUsers(1, () => "")
      const identity = betterAuthIdentity(auth)
      expect(await identity.getUsers?.([grace.user.id, "missing", ada.user.id, unnamed!, grace.user.id])).toEqual([
        { id: grace.user.id, name: "Grace Hopper", email: "grace@example.com", image: "https://example.com/grace.png" },
        { id: ada.user.id, name: "Ada Lovelace", email: "ada@example.com", image: null },
        { id: unnamed, name: null, email: "user0@example.com", image: null }
      ])
      expect(await identity.getUsers?.([])).toEqual([])
    })

    it("looks up long lists of users in pages", async () => {
      const { auth, addUsers } = await createAuth()
      const ids = addUsers(150)
      const found = await betterAuthIdentity(auth).getUsers?.(ids)
      expect(found?.map((user) => user.id)).toEqual(ids)
    })
  })

  describe("searchUsers", () => {
    it("matches names and emails among the organization's members, ignoring case", async () => {
      const { auth, acme } = await createOrganizationApp()
      const identity = betterAuthIdentity(auth)
      expect(await identity.searchUsers?.("  GRACE ", { orgId: acme.id })).toEqual([
        { id: expect.any(String), name: "Grace Hopper", email: "grace@example.com", image: null }
      ])
      expect((await identity.searchUsers?.("example.com", { orgId: acme.id }))?.map((user) => user.name)).toEqual([
        "Ada Lovelace",
        "Grace Hopper"
      ])
      expect(await identity.searchUsers?.("alan", { orgId: acme.id })).toEqual([])
      expect(await identity.searchUsers?.("ada", { orgId: "another-org" })).toEqual([])
      expect(await identity.searchUsers?.("ada", { orgId: acme.id, limit: 0 })).toEqual([])
    })

    it("reads large organizations in pages until it has enough", async () => {
      const { auth, addUsers, addMembers, acme } = await createOrganizationApp()
      addMembers(
        acme.id,
        addUsers(200, (index) => `User ${String(index).padStart(3, "0")}`)
      )
      const identity = betterAuthIdentity(auth)
      expect(await identity.searchUsers?.("user", { orgId: acme.id })).toHaveLength(10)
      expect(await identity.searchUsers?.("user", { orgId: acme.id, limit: 150 })).toHaveLength(150)
      const names = (await identity.searchUsers?.("user 19", { orgId: acme.id, limit: 20 }))?.map((user) => user.name)
      expect(names?.sort()).toEqual(Array.from({ length: 10 }, (_, index) => `User 19${index}`))
      expect(await identity.searchUsers?.("", { orgId: acme.id, limit: 500 })).toHaveLength(202)
    })

    it("searches users by name and email in organizations of over 1,000 members", async () => {
      const { auth, addUsers, addMembers, acme } = await createOrganizationApp()
      addMembers(
        acme.id,
        addUsers(1100, (index) => `Member ${String(index).padStart(4, "0")}`)
      )
      addUsers(
        50,
        (index) => `Member outside ${index}`,
        (index) => `outside${index}@example.com`
      )
      const findMany = vi.spyOn((await auth.$context).adapter, "findMany")
      const identity = betterAuthIdentity(auth)
      const names = (await identity.searchUsers?.("member 10", { orgId: acme.id, limit: 200 }))?.map(
        (user) => user.name
      )
      expect(names).toEqual(Array.from({ length: 100 }, (_, index) => `Member ${1000 + index}`))
      // Two pages of matching users, and the members among each.
      expect(findMany).toHaveBeenCalledTimes(4)
      expect(await identity.searchUsers?.("outside", { orgId: acme.id })).toEqual([])
      expect(await identity.searchUsers?.("", { orgId: acme.id, limit: 5 })).toHaveLength(5)
    })

    it("suggests nobody outside an organization unless the app allows it", async () => {
      const { auth } = await createOrganizationApp()
      expect(await betterAuthIdentity(auth).searchUsers?.("a", { orgId: null })).toEqual([])
      const open = betterAuthIdentity(auth, { searchOutsideOrgs: true })
      expect((await open.searchUsers?.("CE", { orgId: null }))?.map((user) => user.name)).toEqual([
        "Ada Lovelace",
        "Grace Hopper"
      ])
      expect(await open.searchUsers?.("", { orgId: null, limit: 2 })).toHaveLength(2)
    })

    it("searches every user in an app without organizations", async () => {
      const { auth, signUp } = await createAuthWithoutOrganizations()
      await signUp("Ada Lovelace", "ada@example.com")
      await signUp("Grace Hopper", "grace@example.com")
      const identity = betterAuthIdentity(auth)
      expect((await identity.searchUsers?.("ada", { orgId: null }))?.map((user) => user.email)).toEqual([
        "ada@example.com"
      ])
      expect(await identity.searchUsers?.("ada", { orgId: "acme" })).toEqual([])
      expect(
        await betterAuthIdentity(auth, { searchOutsideOrgs: false }).searchUsers?.("ada", { orgId: null })
      ).toEqual([])
    })
  })

  it("names Better Auth's user table so feature tables can reference it", async () => {
    const { auth } = await createAuth()
    expect(betterAuthIdentity(auth).userTable).toBe("user")
    const renamed = await createAuth({ user: { modelName: "account_user" } })
    expect(betterAuthIdentity(renamed.auth).userTable).toBe("account_user")
  })
})
