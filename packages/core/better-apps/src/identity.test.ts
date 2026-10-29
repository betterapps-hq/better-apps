import { describe, expect, it } from "vitest"
import { BetterAppsError, localIdentity } from "./index.js"

const request = new Request("https://app.test/")

describe("localIdentity", () => {
  it("acts as one local user, outside any organization", async () => {
    const identity = localIdentity()
    expect(await identity.getActor(request)).toEqual({ userId: "local", orgId: null, roles: [] })
    expect(await identity.getUsers?.(["local", "someone"])).toEqual([
      { id: "local", name: "Local user", email: undefined, image: undefined }
    ])
  })

  it("takes the user's id, name and roles", async () => {
    const identity = localIdentity({ id: "me", name: "Ada", email: "ada@example.com", roles: ["admin"] })
    expect(await identity.getActor(request)).toEqual({ userId: "me", orgId: null, roles: ["admin"] })
    expect(await identity.getActorsFor(["me", "other"], null)).toEqual([
      { userId: "me", orgId: null, roles: ["admin"] }
    ])
  })

  it("has no members in an organization", async () => {
    const identity = localIdentity()
    expect(await identity.getActorsFor(["local"], "acme")).toEqual([])
    expect(await identity.searchUsers?.("local", { orgId: "acme" })).toEqual([])
  })

  it("finds the user by name or email", async () => {
    const identity = localIdentity({ name: "Ada Lovelace", email: "ada@example.com" })
    expect(await identity.searchUsers?.("  LOVE ", { orgId: null })).toHaveLength(1)
    expect(await identity.searchUsers?.("example.com", { orgId: null })).toHaveLength(1)
    expect(await identity.searchUsers?.("grace", { orgId: null })).toEqual([])
  })
})

describe("BetterAppsError", () => {
  it("uses the code as the message and keeps issue paths as plain keys", () => {
    const error = new BetterAppsError("INVALID_INPUT", undefined, {
      issues: [{ message: "Required" }, { message: "Too long", path: [{ key: "items" }, 2, Symbol.for("note")] }]
    })
    expect(error.message).toBe("INVALID_INPUT")
    expect(error.issues).toEqual([{ message: "Required" }, { message: "Too long", path: ["items", 2, "Symbol(note)"] }])
  })

  it("defaults to 400 for codes it doesn't know, even ones named like object members", () => {
    expect(new BetterAppsError("PAYMENT_REQUIRED").status).toBe(400)
    expect(new BetterAppsError("constructor").status).toBe(400)
    expect(new BetterAppsError("toString", undefined, { status: 402 }).status).toBe(402)
  })
})
