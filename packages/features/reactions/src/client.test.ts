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
    expect(state.reactors[reactionKey("invoice", "inv-1", "👍")]?.userIds ?? []).toEqual([])
    expect(state.subjects[key1]?.pending).toEqual([])
    expect(await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1"] })).toEqual({
      "inv-1": [{ emoji: "🎉", count: 1, reacted: false }]
    })
  })

  it("clears the viewer's other reaction when another tab already swapped it, and each person has one", async () => {
    const { api, as, reactions } = browser("bob", { maxPerUser: 1 })
    await api.react({ ...inv1, emoji: "👍" }, as("bob"))
    await reactions.load("invoice", ["inv-1"])
    // Another tab swaps it, and this one, still showing 👍, picks 🎉 too.
    await api.react({ ...inv1, emoji: "🎉" }, as("bob"))
    await reactions.react({ ...inv1, emoji: "🎉" })
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "🎉", count: 1, reacted: true }])
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

  it("keeps a load's answer that's older than the viewer's changes made meanwhile, making them again on top", async () => {
    const { holdAnswer, reactions, requests } = browser()
    await reactions.load("invoice", ["inv-1"])
    const release = holdAnswer("listReactions")
    const loading = reactions.load("invoice", ["inv-1"])
    // The load reaches the server before the changes, and its answer arrives after.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await reactions.react({ ...inv1, emoji: "👍" })
    await reactions.react({ ...inv1, emoji: "🎉" })
    const loads = requests.filter((name) => name === "listReactions").length
    release()
    await loading
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([
      { emoji: "👍", count: 1, reacted: true },
      { emoji: "🎉", count: 1, reacted: true }
    ])
    // The viewer's own changes don't make it load again.
    expect(requests.filter((name) => name === "listReactions")).toHaveLength(loads)
  })

  it("loads again rather than keep a load's answer that someone else's change came during", async () => {
    const { api, as, events, hold, identity, reactions } = browser()
    const target = { ...inv1, emoji: "👍" }
    await reactions.load("invoice", ["inv-1"])
    // The load goes out first, but the server reads after both reactions, so its answer is newer than Ada's event.
    const release = hold("listReactions")
    const loading = reactions.load("invoice", ["inv-1"])
    await new Promise((resolve) => setTimeout(resolve, 20))
    await api.react(target, as("ada"))
    await api.react(target, as("cy"))
    const event = await api.toClientEvent({
      event: events("reaction.added").at(-2) as BetterAppsEvent,
      viewer: identity.actor("bob")
    })
    if (!event) {
      throw new Error("No event was shown.")
    }
    reactions.applyEvent(event)
    release()
    await loading
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "👍", count: 2, reacted: false }])
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
    await reactions.unreact({ ...target })
    // Someone whose name hasn't loaded starts the list over, so it loads again with their name.
    await reactions.react(target)
    expect(reactions.store.getSnapshot().reactors[key]).toBeUndefined()
    await reactions.loadReactors(target)
    expect(reactions.store.getSnapshot().reactors[key]?.userIds).toEqual(["ada", "bob", "cy"])
    expect(reactions.store.getSnapshot().users.cy?.name).toBeDefined()
    await reactions.unreact(target)
    expect(reactions.store.getSnapshot().reactors[key]?.userIds).toEqual(["ada", "bob"])
    // Someone already named is added at once.
    await reactions.react(target)
    expect(reactions.store.getSnapshot().reactors[key]?.userIds).toEqual(["ada", "bob", "cy"])
  })

  it("loads a record again when someone else's events arrive out of order", async () => {
    const { api, as, events, identity, reactions, requests } = browser()
    const target = { ...inv1, emoji: "👍" }
    await reactions.load("invoice", ["inv-1"])
    await api.react(target, as("ada"))
    await api.unreact(target, as("ada"))
    const shown = async (type: "reaction.added" | "reaction.removed") => {
      const event = await api.toClientEvent({
        event: events(type).at(-1) as BetterAppsEvent,
        viewer: identity.actor("bob")
      })
      if (!event) {
        throw new Error("No event was shown.")
      }
      return event
    }
    const added = await shown("reaction.added")
    const removed = await shown("reaction.removed")
    const loads = requests.filter((name) => name === "listReactions").length
    // The removal arrives before the add it undoes.
    reactions.applyEvent(removed)
    reactions.applyEvent(added)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([])
    expect(requests.filter((name) => name === "listReactions").length).toBeGreaterThan(loads)
  })

  it("pages through many reactors, keeping those listed when their live event arrives", async () => {
    const { api, as, events, identity, reactions } = browser("cy", {}, { reactorsPerPage: 1 })
    const target = { ...inv1, emoji: "👍" }
    await api.react(target, as("ada"))
    await api.react(target, as("bob"))
    const key = reactionKey("invoice", "inv-1", "👍")
    await reactions.loadReactors(target)
    expect(reactions.store.getSnapshot().reactors[key]).toMatchObject({ userIds: ["ada"], state: "ready" })
    expect(reactions.store.getSnapshot().reactors[key]?.cursor).not.toBeNull()
    // Ada's live event arrives after the page that already lists her.
    const event = await api.toClientEvent({
      event: events("reaction.added")[0] as BetterAppsEvent,
      viewer: identity.actor("cy")
    })
    if (!event) {
      throw new Error("No event was shown.")
    }
    reactions.applyEvent(event)
    expect(reactions.store.getSnapshot().reactors[key]?.userIds).toEqual(["ada"])
    await reactions.loadMoreReactors(target)
    expect(reactions.store.getSnapshot().reactors[key]?.userIds).toEqual(["ada", "bob"])
  })

  it("asks again for a page of reactors that someone left while it was on its way", async () => {
    const { api, as, events, holdAnswer, identity, reactions, requests } = browser("cy")
    const target = { ...inv1, emoji: "👍" }
    await api.react(target, as("ada"))
    await api.react(target, as("bob"))
    const release = holdAnswer("listReactors")
    const loading = reactions.loadReactors(target)
    // The server has read the page, with Bob, before he takes his reaction back.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await api.unreact(target, as("bob"))
    const event = await api.toClientEvent({
      event: events("reaction.removed").at(-1) as BetterAppsEvent,
      viewer: identity.actor("cy")
    })
    if (!event) {
      throw new Error("No event was shown.")
    }
    reactions.applyEvent(event)
    release()
    await loading
    expect(reactions.store.getSnapshot().reactors[reactionKey("invoice", "inv-1", "👍")]?.userIds).toEqual(["ada"])
    expect(requests.filter((name) => name === "listReactors")).toHaveLength(2)
  })

  it("doesn't let a page on its way put back reactors a moderator removed", async () => {
    const { api, as, events, holdAnswer, identity, reactions } = browser("cy")
    const target = { ...inv1, emoji: "👍" }
    await api.react(target, as("ada"))
    await api.react(target, as("bob"))
    const release = holdAnswer("listReactors")
    const loading = reactions.loadReactors(target)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await api.removeReactions(inv1)
    const event = await api.toClientEvent({
      event: events("subject.changed").at(-1) as BetterAppsEvent,
      viewer: identity.actor("cy")
    })
    if (!event) {
      throw new Error("No event was shown.")
    }
    reactions.applyEvent(event)
    release()
    await loading
    expect(reactions.store.getSnapshot().reactors[reactionKey("invoice", "inv-1", "👍")]?.userIds ?? []).toEqual([])
  })

  it("starts reactors over from the first page when the list is dropped while a later page loads", async () => {
    const { api, as, events, holdAnswer, identity, reactions } = browser("cy", {}, { reactorsPerPage: 1 })
    const target = { ...inv1, emoji: "👍" }
    for (const userId of ["ada", "bob", "cy"] as const) {
      await api.react(target, as(userId))
    }
    const key = reactionKey("invoice", "inv-1", "👍")
    await reactions.loadReactors(target)
    const release = holdAnswer("listReactors")
    const more = reactions.loadMoreReactors(target)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await api.removeReactions({ ...inv1, userId: "bob" })
    const event = await api.toClientEvent({
      event: events("subject.changed").at(-1) as BetterAppsEvent,
      viewer: identity.actor("cy")
    })
    if (!event) {
      throw new Error("No event was shown.")
    }
    reactions.applyEvent(event)
    release()
    await more
    expect(reactions.store.getSnapshot().reactors[key]?.userIds).toEqual(["ada"])
    await reactions.loadMoreReactors(target)
    expect(reactions.store.getSnapshot().reactors[key]?.userIds).toEqual(["ada", "cy"])
  })

  it("loads again rather than make someone else's count and the viewer's own change to one emoji again", async () => {
    const { api, as, events, hold, identity, reactions } = browser()
    const target = { ...inv1, emoji: "👍" }
    await reactions.load("invoice", ["inv-1"])
    // The load goes out first, but the server reads after both changes, so its answer already has them.
    const release = hold("listReactions")
    const loading = reactions.load("invoice", ["inv-1"])
    await new Promise((resolve) => setTimeout(resolve, 20))
    await api.react(target, as("ada"))
    const event = await api.toClientEvent({
      event: events("reaction.added").at(-1) as BetterAppsEvent,
      viewer: identity.actor("bob")
    })
    if (!event) {
      throw new Error("No event was shown.")
    }
    reactions.applyEvent(event)
    await reactions.react(target)
    release()
    await loading
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([{ emoji: "👍", count: 2, reacted: true }])
  })

  it("loads a record again when a late event for the viewer's own reaction disagrees", async () => {
    const { api, events, identity, reactions, requests } = browser()
    const target = { ...inv1, emoji: "👍" }
    await reactions.load("invoice", ["inv-1"])
    await reactions.react(target)
    await reactions.unreact(target)
    // The event for the reaction since taken back arrives last.
    const event = await api.toClientEvent({
      event: events("reaction.added").at(-1) as BetterAppsEvent,
      viewer: identity.actor("bob")
    })
    if (!event) {
      throw new Error("No event was shown.")
    }
    const loads = requests.filter((name) => name === "listReactions").length
    reactions.applyEvent(event)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(reactions.store.getSnapshot().subjects[key1]?.reactions).toEqual([])
    expect(requests.filter((name) => name === "listReactions")).toHaveLength(loads + 1)
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

  it("never sends a load asked for just before a reset", async () => {
    const { reactions, requests } = browser()
    const loading = reactions.load("invoice", ["inv-1"])
    reactions.reset()
    await expect(loading).rejects.toMatchObject({ code: "ABORTED" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(requests).not.toContain("listReactions")
    expect(reactions.store.getSnapshot().subjects).toEqual({})
  })
})
