import { WorkOS } from "@workos-inc/node"
import { afterEach, describe, expect, it, vi } from "vitest"
import { workosIdentity, type WorkOSIdentityClient, type WorkOSMembership, type WorkOSUser } from "./index.js"

const cookiePassword = "a-cookie-password-that-is-at-least-32-characters"

// A key pair standing in for WorkOS's, and a fake WorkOS API that serves its public key and authenticates passwords,
// so the real SDK seals and verifies sessions without a network.
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"]
)
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "key_test", alg: "RS256", use: "sig" }
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
let authentication: object = {}
vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
  const { pathname } = new URL(input instanceof Request ? input.url : String(input))
  if (pathname === "/sso/jwks/client_test") {
    return Response.json({ keys: [jwk] })
  }
  if (pathname === "/user_management/authenticate") {
    return Response.json(authentication)
  }
  return Response.json({ message: "Not found" }, { status: 404 })
})

/** Signs an access token the way WorkOS does. */
async function accessToken(claims: object) {
  const now = Math.floor(Date.now() / 1000)
  const body = `${encode({ alg: "RS256", typ: "JWT", kid: "key_test" })}.${encode({
    sub: "user_ada",
    sid: "session_1",
    iat: now - 10,
    exp: now + 300,
    ...claims
  })}`
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(body))
  return `${body}.${Buffer.from(signature).toString("base64url")}`
}

const workos = new WorkOS("sk_test_identity", { clientId: "client_test" })

/** Signs in through the real SDK and returns the sealed session cookie AuthKit would set. */
async function sessionCookie(claims: object, password = cookiePassword) {
  authentication = {
    user: {
      object: "user",
      id: "user_ada",
      email: "ada@example.com",
      email_verified: true,
      first_name: "Ada",
      last_name: "Lovelace",
      profile_picture_url: null,
      last_sign_in_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      external_id: null,
      metadata: {}
    },
    access_token: await accessToken(claims),
    refresh_token: "refresh_1",
    authentication_method: "Password"
  }
  const { sealedSession } = await workos.userManagement.authenticateWithPassword({
    email: "ada@example.com",
    password: "correct horse battery staple",
    session: { sealSession: true, cookiePassword: password }
  })
  return sealedSession!
}

const request = (cookie?: string) =>
  new Request("https://app.test/api/apps/notes/add", { method: "POST", headers: cookie ? { cookie } : {} })

interface DirectoryUser {
  id: string
  name?: string
  firstName?: string
  lastName?: string
  email?: string
  /** Memberships by organization id. */
  orgs?: Record<string, Pick<WorkOSMembership, "status" | "role" | "roles">>
}

/** A WorkOS client whose user management API answers from a fixed list of users, the way WorkOS's does. */
function mockWorkOS(directory: DirectoryUser[]) {
  const notFound = () => Object.assign(new Error("Not Found"), { status: 404 })
  const toUser = (user: DirectoryUser): WorkOSUser => ({
    id: user.id,
    email: user.email ?? `${user.id}@example.com`,
    name: user.name ?? null,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    profilePictureUrl: `https://img.workos.test/${user.id}`
  })
  const userManagement = {
    loadSealedSession: vi.fn<WorkOSIdentityClient["userManagement"]["loadSealedSession"]>(() => ({
      authenticate: async () => ({ authenticated: false })
    })),
    getUser: vi.fn<WorkOSIdentityClient["userManagement"]["getUser"]>(async (userId) => {
      const user = directory.find((entry) => entry.id === userId)
      if (!user) {
        throw notFound()
      }
      return toUser(user)
    }),
    listUsers: vi.fn<WorkOSIdentityClient["userManagement"]["listUsers"]>(
      async ({ organizationId, limit = 10, after }) => {
        const users = directory.filter((user) => !organizationId || user.orgs?.[organizationId])
        const start = after ? Number(after) : 0
        const end = start + limit
        return {
          data: users.slice(start, end).map(toUser),
          listMetadata: { after: end < users.length ? String(end) : null }
        }
      }
    ),
    // Returns memberships of every status, so the identity's own check shows.
    listOrganizationMemberships: vi.fn<WorkOSIdentityClient["userManagement"]["listOrganizationMemberships"]>(
      async ({ organizationId, userId }) => {
        if (organizationId === "org_deleted") {
          throw notFound()
        }
        const membership = directory.find((user) => user.id === userId)?.orgs?.[organizationId]
        return { data: membership ? [{ userId, ...membership }] : [], listMetadata: {} }
      }
    )
  }
  return { userManagement } satisfies WorkOSIdentityClient
}

const admin = { status: "active", role: { slug: "admin" } } as const
const member = { status: "active", role: { slug: "member" } } as const

const people: DirectoryUser[] = [
  { id: "user_ada", name: "Ada Lovelace", email: "ada@example.com", orgs: { org_acme: admin } },
  {
    id: "user_grace",
    firstName: "Grace",
    lastName: "Hopper",
    email: "grace@example.com",
    orgs: { org_acme: { status: "active", role: { slug: "member" }, roles: [{ slug: "member" }, { slug: "billing" }] } }
  },
  {
    id: "user_alan",
    firstName: "Alan",
    email: "alan@example.com",
    orgs: { org_acme: { ...member, status: "inactive" } }
  },
  { id: "user_noname", email: "noname@example.com" }
]

const many = (count: number, orgs?: DirectoryUser["orgs"]): DirectoryUser[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `user_${index}`,
    name: `User ${index}`,
    email: `user${index}@example.com`,
    ...(orgs ? { orgs } : {})
  }))

afterEach(() => {
  vi.useRealTimers()
})

describe("workosIdentity", () => {
  describe("getActor with AuthKit's session cookie", () => {
    const identity = workosIdentity({ workos, cookiePassword })

    it("acts as nobody without a session cookie or with an invalid one", async () => {
      expect(await identity.getActor(request())).toBeNull()
      expect(await identity.getActor(request("other=value; wos-session="))).toBeNull()
      expect(await identity.getActor(request("wos-session=not-a-sealed-session"))).toBeNull()
      expect(await identity.getActor(request("wos-session=%E0%A4%A"))).toBeNull()
      const sealedElsewhere = await sessionCookie({}, "another-cookie-password-that-is-32-characters")
      expect(await identity.getActor(request(`wos-session=${sealedElsewhere}`))).toBeNull()
      const expired = await sessionCookie({ exp: Math.floor(Date.now() / 1000) - 60 })
      expect(await identity.getActor(request(`wos-session=${expired}`))).toBeNull()
    })

    it("acts outside any organization without one", async () => {
      const cookie = await sessionCookie({ role: "member" })
      expect(await identity.getActor(request(`theme=dark; wos-session=${cookie}`))).toEqual({
        userId: "user_ada",
        orgId: null,
        roles: []
      })
    })

    it("acts in the session's organization with its role or roles", async () => {
      const single = await sessionCookie({ org_id: "org_acme", role: "admin" })
      expect(await identity.getActor(request(`wos-session=${single}`))).toEqual({
        userId: "user_ada",
        orgId: "org_acme",
        roles: ["admin"]
      })
      const several = await sessionCookie({ org_id: "org_acme", role: "admin", roles: ["admin", "billing"] })
      expect(await identity.getActor(request(`wos-session=${several}`))).toEqual({
        userId: "user_ada",
        orgId: "org_acme",
        roles: ["admin", "billing"]
      })
      const none = await sessionCookie({ org_id: "org_acme" })
      expect(await identity.getActor(request(`wos-session=${none}`))).toEqual({
        userId: "user_ada",
        orgId: "org_acme",
        roles: []
      })
    })

    it("reads an encoded cookie under the name the app chose", async () => {
      const cookie = (await sessionCookie({ org_id: "org_acme", role: "admin" })).replaceAll("~", "%7E")
      const named = workosIdentity({ workos, cookiePassword, cookieName: "session" })
      expect(await named.getActor(request(`session=${cookie}`))).toMatchObject({ orgId: "org_acme" })
      expect(await named.getActor(request(`wos-session=${cookie}`))).toBeNull()
    })

    it("creates a client from the keys", async () => {
      const created = workosIdentity({ apiKey: "sk_test_identity", clientId: "client_test", cookiePassword })
      const cookie = await sessionCookie({ org_id: "org_acme", role: "admin" })
      expect(await created.getActor(request(`wos-session=${cookie}`))).toMatchObject({ userId: "user_ada" })
    })
  })

  describe("getActor", () => {
    it("loads the session with the cookie password", async () => {
      const client = mockWorkOS([])
      expect(
        await workosIdentity({ workos: client, cookiePassword }).getActor(request("wos-session=sealed"))
      ).toBeNull()
      expect(client.userManagement.loadSealedSession).toHaveBeenCalledWith({ sessionData: "sealed", cookiePassword })
    })
  })

  describe("getActorsFor", () => {
    it("builds actors for the organization's active members in the order asked, leaving out everyone else", async () => {
      const client = mockWorkOS(people)
      const identity = workosIdentity({ workos: client, cookiePassword })
      expect(
        await identity.getActorsFor(["user_grace", "user_alan", "user_missing", "user_ada", "user_grace"], "org_acme")
      ).toEqual([
        { userId: "user_grace", orgId: "org_acme", roles: ["member", "billing"] },
        { userId: "user_ada", orgId: "org_acme", roles: ["admin"] }
      ])
      expect(client.userManagement.listOrganizationMemberships).toHaveBeenCalledWith({
        organizationId: "org_acme",
        userId: "user_ada",
        statuses: ["active"]
      })
      expect(client.userManagement.listOrganizationMemberships).toHaveBeenCalledTimes(4)
      expect(await identity.getActorsFor(["user_ada"], "org_initech")).toEqual([])
      expect(await identity.getActorsFor([], "org_acme")).toEqual([])
    })

    it("leaves out everyone when the organization no longer exists", async () => {
      const identity = workosIdentity({ workos: mockWorkOS(people), cookiePassword })
      expect(await identity.getActorsFor(["user_ada"], "org_deleted")).toEqual([])
    })

    it("lets other failures through", async () => {
      const client = mockWorkOS(people)
      client.userManagement.listOrganizationMemberships.mockRejectedValueOnce(new Error("Rate limited"))
      const identity = workosIdentity({ workos: client, cookiePassword })
      await expect(identity.getActorsFor(["user_ada"], "org_acme")).rejects.toThrow("Rate limited")
    })

    it("builds actors outside any organization for every user that exists", async () => {
      const identity = workosIdentity({ workos: mockWorkOS(people), cookiePassword })
      expect(await identity.getActorsFor(["user_alan", "user_missing", "user_ada"], null)).toEqual([
        { userId: "user_alan", orgId: null, roles: [] },
        { userId: "user_ada", orgId: null, roles: [] }
      ])
    })

    it("makes at most 10 calls at a time", async () => {
      const directory = many(35, { org_acme: member })
      const client = mockWorkOS(directory)
      let running = 0
      let most = 0
      client.userManagement.listOrganizationMemberships.mockImplementation(async ({ userId }) => {
        running++
        most = Math.max(most, running)
        await new Promise((resolve) => setTimeout(resolve, 1))
        running--
        return { data: [{ userId, ...member }], listMetadata: {} }
      })
      const actors = await workosIdentity({ workos: client, cookiePassword }).getActorsFor(
        directory.map((user) => user.id),
        "org_acme"
      )
      expect(actors).toHaveLength(35)
      expect(most).toBe(10)
    })

    it("starts no more calls after one fails", async () => {
      const directory = many(35, { org_acme: member })
      const client = mockWorkOS(directory)
      client.userManagement.listOrganizationMemberships.mockRejectedValueOnce(new Error("Rate limited"))
      const identity = workosIdentity({ workos: client, cookiePassword })
      await expect(
        identity.getActorsFor(
          directory.map((user) => user.id),
          "org_acme"
        )
      ).rejects.toThrow("Rate limited")
      // The ten calls already under way finish; none of the other 25 users is asked for.
      expect(client.userManagement.listOrganizationMemberships).toHaveBeenCalledTimes(10)
    })
  })

  describe("getUsers", () => {
    it("looks up names, emails and avatars, leaving out users that don't exist", async () => {
      const identity = workosIdentity({ workos: mockWorkOS(people), cookiePassword })
      expect(
        await identity.getUsers?.(["user_grace", "user_missing", "user_ada", "user_noname", "user_grace"])
      ).toEqual([
        {
          id: "user_grace",
          name: "Grace Hopper",
          email: "grace@example.com",
          image: "https://img.workos.test/user_grace"
        },
        { id: "user_ada", name: "Ada Lovelace", email: "ada@example.com", image: "https://img.workos.test/user_ada" },
        { id: "user_noname", name: null, email: "noname@example.com", image: "https://img.workos.test/user_noname" }
      ])
    })

    it("remembers users, and users that don't exist, for a minute", async () => {
      vi.useFakeTimers()
      const client = mockWorkOS(people)
      const identity = workosIdentity({ workos: client, cookiePassword })
      await identity.getUsers?.(["user_ada", "user_missing"])
      await identity.getActorsFor(["user_ada", "user_missing"], null)
      expect(client.userManagement.getUser).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(60_001)
      await identity.getUsers?.(["user_ada"])
      expect(client.userManagement.getUser).toHaveBeenCalledTimes(3)
    })

    it("shares a lookup already under way", async () => {
      const client = mockWorkOS(people)
      const identity = workosIdentity({ workos: client, cookiePassword })
      await Promise.all([identity.getUsers?.(["user_ada"]), identity.getUsers?.(["user_ada"])])
      expect(client.userManagement.getUser).toHaveBeenCalledTimes(1)
    })

    it("remembers at most 1,000 users, forgetting the least recently used", async () => {
      const directory = many(1001)
      const client = mockWorkOS(directory)
      const identity = workosIdentity({ workos: client, cookiePassword })
      await identity.getUsers?.(["user_0", "user_1"])
      await identity.getUsers?.(["user_0"])
      await identity.getUsers?.(directory.slice(2).map((user) => user.id))
      client.userManagement.getUser.mockClear()
      await identity.getUsers?.(["user_0", "user_1"])
      expect(client.userManagement.getUser.mock.calls).toEqual([["user_1"]])
    })

    it("lets other failures through without remembering them", async () => {
      const client = mockWorkOS(people)
      client.userManagement.getUser.mockRejectedValueOnce(new Error("Unavailable"))
      const identity = workosIdentity({ workos: client, cookiePassword })
      await expect(identity.getUsers?.(["user_ada"])).rejects.toThrow("Unavailable")
      expect(await identity.getUsers?.(["user_ada"])).toHaveLength(1)
    })
  })

  describe("searchUsers", () => {
    it("matches names and emails among the organization's users, ignoring case", async () => {
      const client = mockWorkOS(people)
      const identity = workosIdentity({ workos: client, cookiePassword })
      expect(await identity.searchUsers?.("  HOPPER ", { orgId: "org_acme" })).toEqual([
        {
          id: "user_grace",
          name: "Grace Hopper",
          email: "grace@example.com",
          image: "https://img.workos.test/user_grace"
        }
      ])
      expect(client.userManagement.listUsers).toHaveBeenCalledWith({ organizationId: "org_acme", limit: 100 })
      expect((await identity.searchUsers?.("example.com", { orgId: "org_acme" }))?.map((user) => user.id)).toEqual([
        "user_ada",
        "user_grace",
        "user_alan"
      ])
      expect(await identity.searchUsers?.("noname", { orgId: "org_acme" })).toEqual([])
      expect(await identity.searchUsers?.("ada", { orgId: "org_acme", limit: 0 })).toEqual([])
    })

    it("reads pages until it has enough", async () => {
      const client = mockWorkOS(many(450, { org_acme: member }))
      const identity = workosIdentity({ workos: client, cookiePassword })
      expect(await identity.searchUsers?.("user", { orgId: "org_acme" })).toHaveLength(10)
      expect(client.userManagement.listUsers).toHaveBeenCalledTimes(1)
      client.userManagement.listUsers.mockClear()
      const found = await identity.searchUsers?.("user 4", { orgId: "org_acme", limit: 11 })
      expect(found?.map((user) => user.name)).toEqual([
        "User 4",
        ...Array.from({ length: 10 }, (_, i) => `User ${40 + i}`)
      ])
      expect(client.userManagement.listUsers).toHaveBeenCalledTimes(1)
      client.userManagement.listUsers.mockClear()
      expect(await identity.searchUsers?.("user 44", { orgId: "org_acme", limit: 20 })).toHaveLength(11)
      expect(client.userManagement.listUsers.mock.calls.map(([options]) => options.after)).toEqual([
        undefined,
        "100",
        "200",
        "300",
        "400"
      ])
    })

    it("reads at most the first 1,000 users", async () => {
      const client = mockWorkOS(many(1200, { org_acme: member }))
      const identity = workosIdentity({ workos: client, cookiePassword })
      expect(await identity.searchUsers?.("user 999", { orgId: "org_acme" })).toHaveLength(1)
      client.userManagement.listUsers.mockClear()
      expect(await identity.searchUsers?.("user 1100", { orgId: "org_acme" })).toEqual([])
      expect(client.userManagement.listUsers).toHaveBeenCalledTimes(10)
    })

    it("suggests nobody outside an organization unless the app allows it", async () => {
      const client = mockWorkOS(people)
      expect(await workosIdentity({ workos: client, cookiePassword }).searchUsers?.("a", { orgId: null })).toEqual([])
      expect(client.userManagement.listUsers).not.toHaveBeenCalled()
      const open = workosIdentity({ workos: client, cookiePassword, searchOutsideOrgs: true })
      expect((await open.searchUsers?.("NONAME", { orgId: null }))?.map((user) => user.id)).toEqual(["user_noname"])
      expect(client.userManagement.listUsers).toHaveBeenCalledWith({ limit: 100 })
    })
  })

  it("has no local user table", () => {
    expect(workosIdentity({ workos: mockWorkOS([]), cookiePassword }).userTable).toBeUndefined()
  })
})
