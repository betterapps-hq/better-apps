import type { BetterAppsEvent } from "better-apps"
import { describe, expect, it } from "vite-plus/test"
import { expectCode, setup, sharing } from "../test/app.js"

// Gus's organization owns inv-globex; Bob, in another one, sees it only through a grant, such as a share link.
const shared = { subjectType: "invoice", subjectId: "inv-globex" } as const

async function seeded(extra: Parameters<typeof setup>[0] = {}) {
  const app = setup(extra)
  await app.api.react({ ...shared, emoji: "👍" }, app.as("gus"))
  return app
}

describe("reactions a request's grant reaches", () => {
  it("can be read, with the record's settings", async () => {
    const { api, as } = await seeded()
    const bob = { ...as("bob"), request: sharing("inv-globex") }
    expect(await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-globex"] }, bob)).toEqual({
      "inv-globex": [{ emoji: "👍", count: 1, reacted: false }]
    })
    expect(await api.getSettings(shared, bob)).toMatchObject({ reactorVisibility: "viewers" })
    const visitor = { actor: null, request: sharing("inv-globex") }
    expect(
      (await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-globex"] }, visitor))["inv-globex"]
    ).toHaveLength(1)
    // Without the grant, nothing changes.
    expect(await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-globex"] }, as("bob"))).toEqual({
      "inv-globex": []
    })
    await expectCode(api.getSettings(shared, { ...as("bob"), request: sharing("inv-1") }), "NOT_FOUND")
  })

  it("show who reacted only where everyone may see it", async () => {
    const viewers = await seeded()
    const listed = { ...shared, emoji: "👍" }
    await expectCode(
      viewers.api.listReactors(listed, { ...viewers.as("bob"), request: sharing("inv-globex") }),
      "FORBIDDEN"
    )
    await expectCode(
      viewers.api.listReactors(listed, { actor: null, request: sharing("inv-globex") }),
      "UNAUTHENTICATED"
    )
    expect((await viewers.api.listReactors(listed, viewers.as("gus"))).userIds).toEqual(["gus"])

    const open = await seeded({ reactorVisibility: "public" })
    expect((await open.api.listReactors(listed, { actor: null, request: sharing("inv-globex") })).userIds).toEqual([
      "gus"
    ])
  })

  it("can't be added or taken back, whatever the grant", async () => {
    const { api, as, events } = await seeded()
    const bob = { ...as("bob"), request: sharing("inv-globex") }
    await expectCode(api.react({ ...shared, emoji: "🎉" }, bob), "NOT_FOUND")
    await expectCode(api.unreact({ ...shared, emoji: "👍" }, bob), "NOT_FOUND")
    await expectCode(api.removeReactions({ ...shared }, bob), "NOT_FOUND")
    await expectCode(
      api.react({ ...shared, emoji: "🎉" }, { actor: null, request: sharing("inv-globex") }),
      "UNAUTHENTICATED"
    )
    // Only Gus's reaction was ever added.
    expect(events("reaction.added")).toHaveLength(1)
  })

  it("reach a live viewer whose request carries the grant, without who reacted", async () => {
    const { api, identity, events } = await seeded()
    const event = events("reaction.added")[0] as BetterAppsEvent
    const viewer = identity.actor("bob")
    expect(await api.toClientEvent({ event, viewer })).toBeNull()
    expect(await api.toClientEvent({ event, viewer, request: sharing("inv-globex") })).toMatchObject({
      type: "reaction.added",
      emoji: "👍",
      userId: "",
      mine: false
    })
  })
})
