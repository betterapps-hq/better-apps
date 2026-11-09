import type { BetterAppsEvent } from "better-apps"
import { describe, expect, it } from "vite-plus/test"
import { browser } from "../test/browser.js"
import { createReactionsClient, reactionKey, subjectKey, type ClientReactionChange } from "./client.js"

const inv1 = { subjectType: "invoice", subjectId: "inv-1" } as const
const key1 = subjectKey("invoice", "inv-1")

describe("reactions client", () => {
  it("is one per Better Apps client", () => {
    const { client, reactions } = browser()
    expect(createReactionsClient(client)).toBe(reactions)
  })

  it("loads records asked for in the same tick in one call", async () => {
    const { api, as, reactions, requests } = browser()
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    const loading = Promise.all([
      reactions.load("invoice", ["inv-1"]),
      reactions.load("invoice", ["inv-2", "inv-1"]),
      reactions.load("invoice", [])
    ])
    expect(reactions.store.getSnapshot().subjects[key1]?.state).toBe("loading")
    await loading
    // The first load of a subject type also learns its settings.
    expect(requests.sort()).toEqual(["getSettings", "listReactions"])
    expect(reactions.store.getSnapshot().subjects[key1]).toEqual({
      reactions: [{ emoji: "👍", count: 1, reacted: false }],
      state: "ready",
      error: null,
      pending: []
    })
    expect(reactions.store.getSnapshot().subjects[subjectKey("invoice", "inv-2")]?.reactions).toEqual([])
  })

  it("splits loads over 50 records into calls", async () => {
    const { reactions, requests } = browser()
    await reactions.load(
      "invoice",
      Array.from({ length: 60 }, (_, index) => `inv-${index}`)
    )
    expect(requests.filter((name) => name === "listReactions")).toHaveLength(2)
  })

  it("marks a failed load", async () => {
    const { reactions } = browser("bob")
    await expect(reactions.load("ticket" as "invoice", ["t-1"])).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(reactions.store.getSnapshot().subjects[subjectKey("ticket", "t-1")]?.state).toBe("error")
  })

  it("toggles a reaction at once, and confirms it", async () => {
    const { api, reactions } = browser()
    await reactions.load("invoice", ["inv-1"])
    const adding = reactions.toggle({ ...inv1, emoji: "👍" })
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "👍", count: 1, reacted: true }])
    expect(reactions.store.getSnapshot().subjects[key1]?.pending).toEqual(["👍"])
    await expect(adding).resolves.toMatchObject({ added: true })
    expect(reactions.store.getSnapshot().subjects[key1]?.pending).toEqual([])
    await reactions.toggle({ ...inv1, emoji: "👍" })
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([])
    expect(await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1"] })).toEqual({ "inv-1": [] })
  })

  it("ends where the last of several quick toggles left it", async () => {
    const { api, reactions } = browser()
    await reactions.load("invoice", ["inv-1"])
    const target = { ...inv1, emoji: "👍" }
    await Promise.all([reactions.toggle(target), reactions.toggle(target), reactions.toggle(target)])
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "👍", count: 1, reacted: true }])
    expect(await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1"] })).toEqual({
      "inv-1": [{ emoji: "👍", count: 1, reacted: false }]
    })
  })

  it("swaps the viewer's reaction when each person has one", async () => {
    const { api, reactions } = browser("bob", { maxPerUser: 1 })
    await reactions.load("invoice", ["inv-1"])
    await reactions.loadReactors({ ...inv1, emoji: "👍" })
    await Promise.all([reactions.toggle({ ...inv1, emoji: "👍" }), reactions.toggle({ ...inv1, emoji: "🎉" })])
    const state = reactions.store.getSnapshot()
    expect(state.subjects[key1]?.reactions).toEqual([{ emoji: "🎉", count: 1, reacted: true }])
    expect(state.reactors[reactionKey("invoice", "inv-1", "👍")]?.userIds).toEqual([])
    expect(state.subjects[key1]?.pending).toEqual([])
    expect(await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1"] })).toEqual({
      "inv-1": [{ emoji: "🎉", count: 1, reacted: false }]
    })
  })

  it("rolls back a refused reaction", async () => {
    const { reactions } = browser()
    const locked = { subjectType: "invoice", subjectId: "inv-locked" } as const
    await reactions.load("invoice", ["inv-locked"])
    await expect(reactions.react({ ...locked, emoji: "👍" })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(reactions.store.getSnapshot().subjects[subjectKey("invoice", "inv-locked")]).toMatchObject({
      reactions: [],
      pending: []
    })
  })

  it("counts a reaction the server already had, such as from another tab, once", async () => {
    const { api, as, reactions, requests } = browser()
    await reactions.load("invoice", ["inv-1"])
    await api.react({ ...inv1, emoji: "👍" }, as("bob"))
    await expect(reactions.react({ ...inv1, emoji: "👍" })).resolves.toMatchObject({ added: false })
    expect(requests.filter((name) => name !== "getSettings")).toEqual(["listReactions", "react"])
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "👍", count: 1, reacted: true }])
  })

  it("counts a swap once when its live events arrive before the answer", async () => {
    const { reactions } = browser("bob", { maxPerUser: 1 })
    await reactions.load("invoice", ["inv-1"])
    await reactions.react({ ...inv1, emoji: "👍" })
    const swapping = reactions.react({ ...inv1, emoji: "🎉" })
    // The events reach the browser over a live connection, which can beat the HTTP answer.
    const mine = { ...inv1, userId: "bob", mine: true } as const
    reactions.applyEvent({ ...mine, id: "e1", type: "reaction.removed", emoji: "👍" })
    reactions.applyEvent({ ...mine, id: "e2", type: "reaction.added", emoji: "🎉" })
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "🎉", count: 1, reacted: true }])
    await swapping
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "🎉", count: 1, reacted: true }])
  })

  it("keeps a write going through a reload, and rolls back only that write when refused", async () => {
    const { hold, reactions } = browser()
    const locked = { subjectType: "invoice", subjectId: "inv-locked" } as const
    const key = subjectKey("invoice", "inv-locked")
    await reactions.load("invoice", ["inv-locked"])
    const release = hold("react")
    const refused = reactions.react({ ...locked, emoji: "👍" })
    refused.catch(() => undefined)
    await reactions.load("invoice", ["inv-locked"])
    release()
    expect(reactions.store.getSnapshot().subjects[key]?.reactions).toEqual([{ emoji: "👍", count: 1, reacted: true }])
    await expect(refused).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(reactions.store.getSnapshot().subjects[key]?.reactions).toEqual([])
  })

  it("lets moderators remove someone's reaction, and loads the record again", async () => {
    const { api, as, reactions, requests } = browser("ada", {
      subjects: { invoice: { canModerate: ({ actor }) => actor.roles.includes("admin") }, page: {} }
    })
    await api.react({ ...inv1, emoji: "👍" }, as("bob"))
    await reactions.load("invoice", ["inv-1"])
    await reactions.loadReactors({ ...inv1, emoji: "👍" })
    await expect(reactions.removeReactions({ ...inv1, emoji: "👍", userId: "bob" })).resolves.toEqual({ removed: 1 })
    expect(requests.at(-1)).toBe("listReactions")
    const state = reactions.store.getSnapshot()
    expect(state.subjects[key1]?.reactions).toEqual([])
    expect(state.reactors[reactionKey("invoice", "inv-1", "👍")]).toBeUndefined()
  })

  it("shows a swap at once when each person has one, and stores one spelling of each emoji", async () => {
    const { hold, reactions } = browser("bob", { maxPerUser: 1 })
    await reactions.load("invoice", ["inv-1"])
    await reactions.loadSettings(inv1)
    await reactions.react({ ...inv1, emoji: "❤" })
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "❤️", count: 1, reacted: true }])
    const release = hold("react")
    const swapping = reactions.toggle({ ...inv1, emoji: "👍" })
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "👍", count: 1, reacted: true }])
    release()
    await swapping
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "👍", count: 1, reacted: true }])
    expect(reactions.store.getSnapshot().settings[key1]).toMatchObject({ maxPerUser: 1, emojis: null })
  })

  it("keeps a load's answer that's older than changes made meanwhile, making them again on top", async () => {
    const { api, as, events, holdAnswer, identity, reactions, requests } = browser()
    await reactions.load("invoice", ["inv-1"])
    const release = holdAnswer("listReactions")
    const loading = reactions.load("invoice", ["inv-1"])
    // The load reaches the server before the changes, and its answer arrives after.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await reactions.react({ ...inv1, emoji: "👍" })
    await api.react({ ...inv1, emoji: "🎉" }, as("ada"))
    const event = await api.toClientEvent({
      event: events("reaction.added").at(-1) as BetterAppsEvent,
      viewer: identity.actor("bob")
    })
    if (!event) {
      throw new Error("No event was shown.")
    }
    reactions.applyEvent(event)
    const loads = requests.filter((name) => name === "listReactions").length
    release()
    await loading
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([
      { emoji: "👍", count: 1, reacted: true },
      { emoji: "🎉", count: 1, reacted: false }
    ])
    // A busy record doesn't keep loading again.
    expect(requests.filter((name) => name === "listReactions")).toHaveLength(loads)
  })

  it("keeps a toggle made before a record's first load answered", async () => {
    const { holdAnswer, reactions } = browser()
    const release = holdAnswer("listReactions")
    const loading = reactions.load("invoice", ["inv-1"])
    await new Promise((resolve) => setTimeout(resolve, 20))
    await reactions.react({ ...inv1, emoji: "👍" })
    release()
    await loading
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "👍", count: 1, reacted: true }])
  })

  it("loads a record again when many of its reactions changed at once", async () => {
    const { api, as, reactions, requests } = browser()
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    await reactions.load("invoice", ["inv-1"])
    await reactions.loadReactors({ ...inv1, emoji: "👍" })
    await api.removeReactions(inv1)
    const loads = requests.filter((name) => name === "listReactions").length
    reactions.applyEvent({ id: "cleared", type: "subject.changed", ...inv1 })
    expect(reactions.store.getSnapshot().reactors[reactionKey("invoice", "inv-1", "👍")]).toBeUndefined()
    await reactions.load("invoice", ["inv-1"])
    expect(requests.filter((name) => name === "listReactions").length).toBeGreaterThan(loads)
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([])
    reactions.applyEvent({ id: "elsewhere", type: "subject.changed", subjectType: "invoice", subjectId: "inv-2" })
    expect(reactions.store.getSnapshot().subjects[subjectKey("invoice", "inv-2")]).toBeUndefined()
  })

  it("shows a new chip where the record's list puts it, and keys reactors by one spelling", async () => {
    const { api, as, reactions } = browser("bob", { emojis: ["🎉", "❤️", "👍"] })
    await api.react({ ...inv1, emoji: "❤" }, as("ada"))
    await reactions.load("invoice", ["inv-1"])
    await reactions.loadSettings(inv1)
    await reactions.react({ ...inv1, emoji: "👍" })
    await reactions.react({ ...inv1, emoji: "🎉" })
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions.map((reaction) => reaction.emoji)).toEqual([
      "🎉",
      "❤️",
      "👍"
    ])
    await reactions.loadReactors({ ...inv1, emoji: "❤" })
    expect(reactions.store.getSnapshot().reactors[reactionKey("invoice", "inv-1", "❤️")]?.userIds).toEqual(["ada"])
  })

  it("loads who reacted, page by page, and keeps the list current", async () => {
    const { api, as, reactions } = browser("cy")
    const target = { ...inv1, emoji: "👍" }
    await api.react(target, as("ada"))
    await api.react(target, as("bob"))
    await reactions.loadReactors(target)
    const key = reactionKey("invoice", "inv-1", "👍")
    expect(reactions.store.getSnapshot().reactors[key]).toMatchObject({ userIds: ["ada", "bob"], state: "ready" })
    expect(reactions.store.getSnapshot().users.bob?.name).toBe("Bob Babbage")
    await reactions.loadMoreReactors(target)
    await reactions.react(target)
    expect(reactions.store.getSnapshot().reactors[key]?.userIds).toEqual(["ada", "bob", "cy"])
    await reactions.unreact(target)
    expect(reactions.store.getSnapshot().reactors[key]?.userIds).toEqual(["ada", "bob"])
  })

  it("pages through many reactors", async () => {
    const { reactions, client } = browser("ada")
    const pages = [
      { userIds: ["ada"], cursor: "next", users: {} },
      { userIds: ["ada", "bob"], cursor: null, users: {} }
    ]
    const target = { ...inv1, emoji: "👍" }
    const original = client.$call
    ;(client as { $call: typeof original }).$call = async (feature, action, input, options) =>
      action === "listReactors" ? pages.shift() : original(feature, action, input, options)
    const fresh = createReactionsClient(client)
    expect(fresh).toBe(reactions)
    await reactions.loadReactors(target)
    expect(reactions.store.getSnapshot().reactors[reactionKey("invoice", "inv-1", "👍")]?.cursor).toBeNull()
  })

  it("marks reactors that failed to load", async () => {
    const { reactions } = browser("gus")
    const target = { ...inv1, emoji: "👍" }
    await expect(reactions.loadReactors(target)).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(reactions.store.getSnapshot().reactors[reactionKey("invoice", "inv-1", "👍")]?.state).toBe("error")
  })

  it("applies live events once, and loads a record again after someone else's change", async () => {
    const { api, as, events, identity, reactions, requests } = browser()
    await reactions.load("invoice", ["inv-1"])
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    const event = (await api.toClientEvent({
      event: events("reaction.added")[0] as BetterAppsEvent,
      viewer: identity.actor("bob")
    })) as ClientReactionChange | null
    if (!event) {
      throw new Error("No event was shown.")
    }
    const before = requests.length
    reactions.applyEvent(event)
    reactions.applyEvent(event)
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "👍", count: 1, reacted: false }])
    // The event's count matches what the store now shows, so the record needs no load.
    expect(requests).toHaveLength(before)
    // The same change reported twice, such as by two removals that raced, counts once the record loads again.
    reactions.applyEvent({ ...event, id: "again" })
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "👍", count: 2, reacted: false }])
    await reactions.load("invoice", ["inv-1"])
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "👍", count: 1, reacted: false }])

    // The viewer's own changes are set, not counted, and need no load.
    await reactions.react({ ...inv1, emoji: "👍" })
    const loads = requests.filter((name) => name === "listReactions").length
    reactions.applyEvent({ ...event, id: "mine", userId: "bob", mine: true })
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "👍", count: 2, reacted: true }])
    expect(requests.filter((name) => name === "listReactions")).toHaveLength(loads)
    // An event that may not say who reacted leaves lists of reactors alone.
    await reactions.loadReactors({ ...inv1, emoji: "👍" })
    reactions.applyEvent({ ...event, id: "nameless", type: "reaction.removed", userId: "" })
    expect(reactions.store.getSnapshot().reactors[reactionKey("invoice", "inv-1", "👍")]?.userIds).toEqual([
      "ada",
      "bob"
    ])
    reactions.applyEvent({ ...event, id: "elsewhere", subjectId: "inv-2" })
    expect(reactions.store.getSnapshot().subjects[subjectKey("invoice", "inv-2")]).toBeUndefined()
  })

  it("dehydrates loaded records for a server render, and hydrates them", async () => {
    const server = browser()
    await server.api.react({ ...inv1, emoji: "👍" }, server.as("ada"))
    await server.reactions.load("invoice", ["inv-1"])
    await server.reactions.loadReactors({ ...inv1, emoji: "👍" })
    server.reactions.load("invoice", ["inv-2"]).catch(() => undefined)
    const snapshot = server.reactions.dehydrate()
    expect(Object.keys(snapshot.subjects)).toEqual([key1])
    const { reactions } = browser()
    reactions.hydrate(snapshot)
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "👍", count: 1, reacted: false }])
    expect(reactions.store.getSnapshot().users.ada?.name).toBe("Ada Lovelace")
  })

  it("empties on reset, and drops answers meant for the previous person", async () => {
    const { reactions } = browser()
    const resets: number[] = []
    const stop = reactions.onReset(() => resets.push(1))
    await reactions.load("invoice", ["inv-1"])
    const writing = reactions.react({ ...inv1, emoji: "👍" })
    reactions.reset()
    await expect(writing).rejects.toMatchObject({ code: "ABORTED" })
    expect(reactions.store.getSnapshot()).toEqual({ subjects: {}, reactors: {}, users: {}, settings: {} })
    stop()
    reactions.reset()
    expect(resets).toEqual([1])
  })
})
