import { createClerkClient } from "@clerk/backend"
import { describe, expect, it, vi } from "vitest"
import { clerkIdentity, type ClerkIdentityClient, type ClerkUser } from "./index.js"

interface DirectoryUser {
  id: string
  firstName?: string
  lastName?: string
  username?: string
  email?: string
  /** The default is an avatar URL. */
  image?: string
  /** Roles by organization id, such as `{ acme: "org:admin" }`. */
  orgs?: Record<string, string>
}

/** A Clerk client whose backend API answers from a fixed list of users, the way Clerk's does. */
function mockClerk(
  directory: DirectoryUser[],
  auth: Awaited<ReturnType<ClerkIdentityClient["authenticateRequest"]>> = { toAuth: () => null }
) {
  const toUser = (user: DirectoryUser): ClerkUser => ({
    id: user.id,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    username: user.username ?? null,
    imageUrl: user.image ?? `https://img.clerk.com/${user.id}`,
    primaryEmailAddressId: user.email ? `idn_${user.id}` : null,
    emailAddresses: user.email ? [{ id: `idn_${user.id}`, emailAddress: user.email }] : []
  })
  const client = {
    authenticateRequest: vi.fn<ClerkIdentityClient["authenticateRequest"]>(async () => auth),
    users: {
      getUserList: vi.fn<ClerkIdentityClient["users"]["getUserList"]>(
        async ({ userId, query, organizationId, limit = 10, offset = 0 }) => {
          const text = query?.toLowerCase()
          const matches = directory.filter(
            (user) =>
              (!userId || userId.includes(user.id)) &&
              (!organizationId || organizationId.some((orgId) => user.orgs?.[orgId])) &&
              (!text ||
                [user.id, user.firstName, user.lastName, user.username, user.email].some((value) =>
                  value?.toLowerCase().includes(text)
                ))
          )
          return { data: matches.slice(offset, offset + limit).map(toUser) }
        }
      )
    },
    organizations: {
      getOrganizationMembershipList: vi.fn<ClerkIdentityClient["organizations"]["getOrganizationMembershipList"]>(
        async ({ organizationId, userId, limit = 10 }) => {
          if (organizationId === "deleted") {
            throw Object.assign(new Error("Not Found"), { status: 404 })
          }
          const members = directory.filter(
            (user) => user.orgs?.[organizationId] && (!userId || userId.includes(user.id))
          )
          return {
            data: members.slice(0, limit).map((user) => ({
              role: user.orgs![organizationId]!,
              // Clerk leaves out the user's data for memberships it can't show.
              publicUserData: user.id === "user_hidden" ? null : { userId: user.id }
            }))
          }
        }
      )
    }
  } satisfies ClerkIdentityClient
  return client
}

const people: DirectoryUser[] = [
  { id: "user_ada", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", orgs: { acme: "org:admin" } },
  {
    id: "user_grace",
    firstName: "Grace",
    lastName: "Hopper",
    email: "grace@example.com",
    orgs: { acme: "org:member" }
  },
  { id: "user_alan", username: "alan", email: "alan@example.com", orgs: { initech: "org:billing_manager" } },
  { id: "user_noname", image: "" },
  { id: "user_hidden", orgs: { acme: "org:member" } }
]

const many = (count: number, orgs?: Record<string, string>): DirectoryUser[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `user_${index}`,
    firstName: "User",
    lastName: String(index),
    email: `user${index}@example.com`,
    ...(orgs ? { orgs } : {})
  }))

// A key pair standing in for a Clerk instance's, so real session tokens verify without a network.
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"]
)
const spki = Buffer.from(await crypto.subtle.exportKey("spki", publicKey)).toString("base64")
const jwtKey = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----`
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")

/** Signs a session token the way Clerk does, with version 2 claims. */
const sessionToken = async (claims: object, { azp = "https://app.test" } = {}) => {
  const now = Math.floor(Date.now() / 1000)
  const body = `${encode({ alg: "RS256", typ: "JWT", kid: "ins_test" })}.${encode({
    sub: "user_ada",
    sid: "sess_1",
    iss: "https://clerk.app.test",
    azp,
    iat: now - 10,
    nbf: now - 10,
    exp: now + 60,
    v: 2,
    ...claims
  })}`
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(body))
  return `${body}.${Buffer.from(signature).toString("base64url")}`
}

const clerkClient = createClerkClient({
  secretKey: "sk_test_identity",
  publishableKey: `pk_test_${btoa("clerk.app.test$")}`,
  jwtKey
})
const identity = clerkIdentity({ clerkClient, authorizedParties: ["https://app.test"] })
const request = (token?: string) =>
  new Request("https://app.test/api/apps/notes/add", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {}
  })

describe("clerkIdentity", () => {
  describe("getActor with Clerk's session tokens", () => {
    it("acts as nobody without a session token or with an invalid one", async () => {
      expect(await identity.getActor(request())).toBeNull()
      expect(await identity.getActor(request("not.a.token"))).toBeNull()
      const expired = await sessionToken({ exp: Math.floor(Date.now() / 1000) - 60 })
      expect(await identity.getActor(request(expired))).toBeNull()
      expect(await identity.getActor(request(await sessionToken({}, { azp: "https://evil.test" })))).toBeNull()
    })

    it("acts outside any organization without an active one", async () => {
      expect(await identity.getActor(request(await sessionToken({})))).toEqual({
        userId: "user_ada",
        orgId: null,
        roles: []
      })
    })

    it("acts in the active organization with the role, without Clerk's org: prefix", async () => {
      const token = await sessionToken({ o: { id: "org_acme", rol: "admin", slg: "acme" } })
      expect(await identity.getActor(request(token))).toEqual({
        userId: "user_ada",
        orgId: "org_acme",
        roles: ["admin"]
      })
    })

    it("acts as nobody while the session has tasks to finish", async () => {
      expect(await identity.getActor(request(await sessionToken({ sts: "pending" })))).toBeNull()
    })
  })

  describe("getActor", () => {
    it("passes the authorized parties and keeps roles other providers would", async () => {
      const clerk = mockClerk([], { toAuth: () => ({ userId: "user_ada", orgId: "org_acme", orgRole: "admin" }) })
      const identity = clerkIdentity({ clerkClient: clerk, authorizedParties: ["https://app.test"] })
      const request = new Request("https://app.test/")
      expect(await identity.getActor(request)).toEqual({ userId: "user_ada", orgId: "org_acme", roles: ["admin"] })
      expect(clerk.authenticateRequest).toHaveBeenCalledWith(request, { authorizedParties: ["https://app.test"] })
    })

    it("gives no roles when the organization has none", async () => {
      const clerk = mockClerk([], { toAuth: () => ({ userId: "user_ada", orgId: "org_acme", orgRole: null }) })
      expect(await clerkIdentity({ clerkClient: clerk }).getActor(new Request("https://app.test/"))).toEqual({
        userId: "user_ada",
        orgId: "org_acme",
        roles: []
      })
    })

    it("creates a client from the keys", async () => {
      const identity = clerkIdentity({
        secretKey: "sk_test_identity",
        publishableKey: `pk_test_${btoa("clerk.app.test$")}`
      })
      expect(await identity.getActor(new Request("https://app.test/"))).toBeNull()
    })
  })

  describe("getActorsFor", () => {
    it("builds actors for the organization's members in the order asked, leaving out everyone else", async () => {
      const clerk = mockClerk(people)
      const identity = clerkIdentity({ clerkClient: clerk })
      expect(
        await identity.getActorsFor(["user_grace", "user_alan", "user_missing", "user_ada", "user_grace"], "acme")
      ).toEqual([
        { userId: "user_grace", orgId: "acme", roles: ["member"] },
        { userId: "user_ada", orgId: "acme", roles: ["admin"] }
      ])
      expect(clerk.organizations.getOrganizationMembershipList).toHaveBeenCalledWith({
        organizationId: "acme",
        userId: ["user_grace", "user_alan", "user_missing", "user_ada"],
        limit: 4
      })
      expect(await identity.getActorsFor(["user_alan"], "initech")).toEqual([
        { userId: "user_alan", orgId: "initech", roles: ["billing_manager"] }
      ])
      expect(await identity.getActorsFor([], "acme")).toEqual([])
    })

    it("leaves out memberships without the user's data", async () => {
      expect(await clerkIdentity({ clerkClient: mockClerk(people) }).getActorsFor(["user_hidden"], "acme")).toEqual([])
    })

    it("leaves out everyone when the organization no longer exists", async () => {
      expect(await clerkIdentity({ clerkClient: mockClerk(people) }).getActorsFor(["user_ada"], "deleted")).toEqual([])
    })

    it("lets other failures through", async () => {
      const clerk = mockClerk(people)
      clerk.organizations.getOrganizationMembershipList.mockRejectedValueOnce(
        Object.assign(new Error("Too Many Requests"), { status: 429 })
      )
      await expect(clerkIdentity({ clerkClient: clerk }).getActorsFor(["user_ada"], "acme")).rejects.toThrow(
        "Too Many Requests"
      )
    })

    it("builds actors outside any organization for every user that exists", async () => {
      expect(
        await clerkIdentity({ clerkClient: mockClerk(people) }).getActorsFor(
          ["user_alan", "user_missing", "user_ada"],
          null
        )
      ).toEqual([
        { userId: "user_alan", orgId: null, roles: [] },
        { userId: "user_ada", orgId: null, roles: [] }
      ])
    })

    it("asks for at most 100 users per call", async () => {
      const directory = many(250, { acme: "org:member" })
      const clerk = mockClerk(directory)
      const identity = clerkIdentity({ clerkClient: clerk })
      const ids = directory.map((user) => user.id)
      expect(await identity.getActorsFor(ids, "acme")).toHaveLength(250)
      expect(
        clerk.organizations.getOrganizationMembershipList.mock.calls.map(([params]) => params.userId?.length)
      ).toEqual([100, 100, 50])
      expect(await identity.getActorsFor(ids, null)).toHaveLength(250)
      expect(clerk.users.getUserList.mock.calls.map(([params]) => params.userId?.length)).toEqual([100, 100, 50])
    })

    it("starts no more calls after one fails", async () => {
      const directory = many(1200)
      const clerk = mockClerk(directory)
      clerk.users.getUserList.mockRejectedValueOnce(Object.assign(new Error("Too many requests"), { status: 429 }))
      const identity = clerkIdentity({ clerkClient: clerk })
      await expect(
        identity.getActorsFor(
          directory.map((user) => user.id),
          null
        )
      ).rejects.toThrow("Too many requests")
      // The five calls already under way finish; none of the other seven chunks is asked for.
      expect(clerk.users.getUserList).toHaveBeenCalledTimes(5)
    })
  })

  describe("getUsers", () => {
    it("looks up names, primary emails and avatars, leaving out users that don't exist", async () => {
      const identity = clerkIdentity({ clerkClient: mockClerk(people) })
      expect(
        await identity.getUsers?.(["user_grace", "user_missing", "user_alan", "user_noname", "user_grace"])
      ).toEqual([
        {
          id: "user_grace",
          name: "Grace Hopper",
          email: "grace@example.com",
          image: "https://img.clerk.com/user_grace"
        },
        { id: "user_alan", name: "alan", email: "alan@example.com", image: "https://img.clerk.com/user_alan" },
        { id: "user_noname", name: null, email: null, image: null }
      ])
      expect(await identity.getUsers?.([])).toEqual([])
    })

    it("asks for at most 100 users per call", async () => {
      const directory = many(201)
      const clerk = mockClerk(directory)
      const users = await clerkIdentity({ clerkClient: clerk }).getUsers?.(directory.map((user) => user.id))
      expect(users?.map((user) => user.id)).toEqual(directory.map((user) => user.id))
      expect(clerk.users.getUserList).toHaveBeenCalledTimes(3)
    })
  })

  describe("searchUsers", () => {
    it("searches the organization's members through Clerk", async () => {
      const clerk = mockClerk(people)
      const identity = clerkIdentity({ clerkClient: clerk })
      expect(await identity.searchUsers?.("  hopper ", { orgId: "acme" })).toEqual([
        {
          id: "user_grace",
          name: "Grace Hopper",
          email: "grace@example.com",
          image: "https://img.clerk.com/user_grace"
        }
      ])
      expect(clerk.users.getUserList).toHaveBeenLastCalledWith({
        query: "hopper",
        organizationId: ["acme"],
        limit: 10,
        offset: 0
      })
      expect((await identity.searchUsers?.("", { orgId: "acme", limit: 1 }))?.map((user) => user.id)).toEqual([
        "user_ada"
      ])
      expect(clerk.users.getUserList).toHaveBeenLastCalledWith({ organizationId: ["acme"], limit: 1, offset: 0 })
      expect(await identity.searchUsers?.("alan", { orgId: "acme" })).toEqual([])
      expect(await identity.searchUsers?.("ada", { orgId: "acme", limit: 0 })).toEqual([])
    })

    it("reads more pages for limits over Clerk's page size", async () => {
      const clerk = mockClerk(many(1200, { acme: "org:member" }))
      const identity = clerkIdentity({ clerkClient: clerk })
      expect(await identity.searchUsers?.("user", { orgId: "acme", limit: 1100 })).toHaveLength(1100)
      expect(clerk.users.getUserList.mock.calls.map(([params]) => [params.limit, params.offset])).toEqual([
        [500, 0],
        [500, 500],
        [100, 1000]
      ])
      clerk.users.getUserList.mockClear()
      expect(await identity.searchUsers?.("user1", { orgId: "acme", limit: 600 })).toHaveLength(311)
      expect(clerk.users.getUserList).toHaveBeenCalledTimes(1)
    })

    it("suggests nobody outside an organization unless the app allows it", async () => {
      const clerk = mockClerk(people)
      expect(await clerkIdentity({ clerkClient: clerk }).searchUsers?.("a", { orgId: null })).toEqual([])
      expect(clerk.users.getUserList).not.toHaveBeenCalled()
      const open = clerkIdentity({ clerkClient: clerk, searchOutsideOrgs: true })
      expect((await open.searchUsers?.("alan", { orgId: null }))?.map((user) => user.id)).toEqual(["user_alan"])
      expect(clerk.users.getUserList).toHaveBeenLastCalledWith({ query: "alan", limit: 10, offset: 0 })
    })
  })

  it("has no local user table", () => {
    expect(clerkIdentity({ clerkClient: mockClerk([]) }).userTable).toBeUndefined()
  })
})
