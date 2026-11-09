import { comments, commentSubjectTypes } from "@better-apps/comments"
import { createTestApp } from "@better-apps/testing"
import type { BetterAppsEvent } from "better-apps"
import { describe, expect, it } from "vite-plus/test"
import { expectCode, options, setup, shares, sharing, subjects, users } from "../test/app.js"
import { reactions } from "./index.js"

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

  it("never make a non-member a moderator, so who reacted stays hidden", async () => {
    // Admins moderate, by role alone: Ada is one, in another organization than inv-globex's.
    const canModerate = ({ actor }: { actor: { roles: readonly string[] } }) => actor.roles.includes("admin")
    const { api, identity, events } = await seeded({
      reactorVisibility: "hidden",
      subjects: { ...options.subjects, invoice: { ...options.subjects.invoice, canModerate } }
    })
    const listed = { ...shared, emoji: "👍" }
    const ada = { actor: identity.actor("ada"), request: sharing("inv-globex") }
    expect(
      (await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-globex"] }, ada))["inv-globex"]
    ).toHaveLength(1)
    await expectCode(api.listReactors(listed, ada), "FORBIDDEN")
    expect((await api.listReactors(listed, { actor: identity.actor("gus") })).userIds).toEqual(["gus"])
    const event = events("reaction.added")[0] as BetterAppsEvent
    expect(await api.toClientEvent({ event, viewer: ada.actor, request: ada.request })).toMatchObject({ userId: "" })
  })

  it("reach many live viewers at once, each by their own request", async () => {
    const { api, identity, events } = await seeded()
    const event = events("reaction.added")[0] as BetterAppsEvent
    const bob = identity.actor("bob")
    expect(
      await api.toClientEvents({
        event,
        viewers: [
          { actor: bob, request: sharing("inv-globex") },
          { actor: bob },
          { actor: null, request: sharing("inv-globex") },
          { actor: bob, request: sharing("inv-1") },
          { actor: identity.actor("gus") }
        ]
      })
    ).toEqual([
      expect.objectContaining({ userId: "" }),
      null,
      expect.objectContaining({ userId: "" }),
      null,
      expect.objectContaining({ userId: "gus", mine: true })
    ])
  })

  it("reach the reactions on a record's comments, through a grant to the record", async () => {
    const { app, identity } = createTestApp({
      subjects,
      features: [
        comments({ subjects: { invoice: { canComment: () => true } } }),
        reactions({ subjects: { [commentSubjectTypes.comment]: {} } }),
        shares
      ],
      users
    })
    const gus = { actor: identity.actor("gus") }
    const { comment } = await app.api.comments.createThread({ ...shared, body: "Due Friday" }, gus)
    const onComment = { subjectType: commentSubjectTypes.comment, subjectId: comment.id }
    await app.api.reactions.react({ ...onComment, emoji: "👍" }, gus)
    const list = { subjectType: commentSubjectTypes.comment, subjectIds: [comment.id] }
    const bob = { actor: identity.actor("bob"), request: sharing("inv-globex") }
    expect((await app.api.reactions.listReactions(list, bob))[comment.id]).toEqual([
      { emoji: "👍", count: 1, reacted: false }
    ])
    expect(
      (await app.api.reactions.listReactions(list, { actor: null, request: sharing("inv-globex") }))[comment.id]
    ).toHaveLength(1)
    expect((await app.api.reactions.listReactions(list, { actor: identity.actor("bob") }))[comment.id]).toEqual([])
    await expectCode(app.api.reactions.react({ ...onComment, emoji: "🎉" }, bob), "NOT_FOUND")
  })
})
