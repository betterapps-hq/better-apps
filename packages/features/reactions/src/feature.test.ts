import { createTestApp } from "@better-apps/testing"
import {
  defineAction,
  defineEvent,
  defineFeature,
  type BetterAppsEvent,
  type EventHandler,
  type SubjectDefinition
} from "better-apps"
import { describe, expect, it, vi } from "vite-plus/test"
import { expectCode, invoices, setup, subjects, users } from "../test/app.js"
import { isEmoji, normalizeEmoji, reactionEvents, reactionModel, reactions } from "./index.js"

const inv1 = { subjectType: "invoice", subjectId: "inv-1" } as const
const at = (minute: number) => new Date(Date.UTC(2026, 10, 2, 9, minute))

describe("isEmoji", () => {
  it("accepts one emoji, with modifiers, joiners, flags and keycaps", () => {
    const emojis = ["👍", "👍🏽", "👩‍💻", "🇳🇿", "1️⃣", "❤️", "🏳️‍🌈"]
    expect(emojis.filter((emoji) => !isEmoji(emoji))).toEqual([])
  })

  it("refuses text, several emoji and empty strings", () => {
    const values = ["", "a", "1", "👍👍", "👍 ", ":shipit:", "x".repeat(40), "a👍", "👍a", "\u200D👍"]
    expect(values.filter((value) => isEmoji(value))).toEqual([])
  })
})

describe("normalizeEmoji", () => {
  it("spells each emoji one way, and leaves other names alone", () => {
    expect(normalizeEmoji("❤")).toBe("❤️")
    expect(normalizeEmoji("❤️")).toBe("❤️")
    expect(normalizeEmoji("1⃣")).toBe("1️⃣")
    expect(normalizeEmoji("🏳‍🌈")).toBe("🏳️‍🌈")
    expect(normalizeEmoji("☝🏽")).toBe("☝🏽")
    expect(normalizeEmoji("👍")).toBe("👍")
    expect(normalizeEmoji(":shipit:")).toBe(":shipit:")
    expect(normalizeEmoji("12")).toBe("12")
  })
})

describe("reactions options", () => {
  it("refuse setups that can't work", () => {
    expect(() => reactions({ subjects: {} })).toThrow("at least one subject type")
    expect(() => reactions({ subjects: { page: {} }, emojis: [] })).toThrow("Leave out `emojis`")
    expect(() => reactions({ subjects: { page: {} }, emojis: ["👍", "👍"] })).toThrow("listed twice")
    expect(() => reactions({ subjects: { page: {} }, emojis: [""] })).toThrow("1 to 64 characters")
    expect(() => reactions({ subjects: { page: {} }, maxPerUser: 0 })).toThrow("`maxPerUser`")
    expect(() => reactions({ subjects: { page: { maxPerUser: 101 } } })).toThrow("`maxPerUser`")
    expect(() => reactions({ subjects: { page: {} }, emojis: ["❤", "❤️"] })).toThrow("listed twice")
  })
})

describe("react and unreact", () => {
  it("count each person once per emoji, and say who reacted", async () => {
    const { api, as, events } = setup()
    expect(await api.react({ ...inv1, emoji: "👍" }, { ...as("ada"), createdAt: at(1) })).toMatchObject({
      added: true,
      reaction: { ...inv1, emoji: "👍", userId: "ada", orgId: "acme" }
    })
    expect((await api.react({ ...inv1, emoji: "👍" }, as("ada"))).added).toBe(false)
    await api.react({ ...inv1, emoji: "🚀" }, { ...as("bob"), createdAt: at(2) })
    await api.react({ ...inv1, emoji: "👍" }, { ...as("bob"), createdAt: at(3) })
    await api.react({ ...inv1, emoji: "🎉" }, { ...as("bob"), createdAt: at(4) })
    expect(events("reaction.added")).toHaveLength(4)
    expect(events("reaction.added")[0]?.data).toEqual({ ...inv1, emoji: "👍", orgId: "acme", userId: "ada", count: 1 })
    expect(events("reaction.added")[2]?.data).toMatchObject({ emoji: "👍", count: 2 })

    const listed = await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1", "inv-2"] }, as("ada"))
    expect(listed).toEqual({
      "inv-1": [
        { emoji: "👍", count: 2, reacted: true },
        { emoji: "🚀", count: 1, reacted: false },
        { emoji: "🎉", count: 1, reacted: false }
      ],
      "inv-2": []
    })

    expect(await api.unreact({ ...inv1, emoji: "👍" }, as("ada"))).toMatchObject({ removed: true })
    expect(await api.unreact({ ...inv1, emoji: "👍" }, as("ada"))).toEqual({ reaction: null, removed: false })
    expect(events("reaction.removed")).toHaveLength(1)
    const after = await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1"] }, as("ada"))
    // Chips keep the order their emoji were first used in, among the reactions still there.
    expect(after["inv-1"]?.map((reaction) => reaction.emoji)).toEqual(["🚀", "👍", "🎉"])
    expect(after["inv-1"]?.[1]).toEqual({ emoji: "👍", count: 1, reacted: false })
  })

  it("report a removal once when two removals race", async () => {
    const { api, as, events } = setup()
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    const results = await Promise.all([
      api.unreact({ ...inv1, emoji: "👍" }, as("ada")),
      api.unreact({ ...inv1, emoji: "👍" }, as("ada"))
    ])
    expect(results.map((result) => result.removed).sort()).toEqual([false, true])
    expect(events("reaction.removed")).toHaveLength(1)
  })

  it("report a reaction once when a swap and a removal race for it", async () => {
    const { api, as, database, events } = setup({ maxPerUser: 1 })
    await api.react({ ...inv1, emoji: "❤️" }, as("ada"))
    await Promise.all([
      api.unreact({ ...inv1, emoji: "❤️" }, as("ada")),
      api.react({ ...inv1, emoji: "👍" }, as("ada"))
    ])
    expect(events("reaction.removed").filter((event) => (event.data as { emoji: string }).emoji === "❤️")).toHaveLength(
      1
    )
    expect(database.sqlite.prepare(`SELECT emoji FROM ${reactionModel}`).all()).toEqual([{ emoji: "👍" }])
  })

  it("let a swap make room under the record's limit", async () => {
    const { api, as } = setup({ maxEmojis: 2, maxPerUser: 1 })
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    await api.react({ ...inv1, emoji: "🎉" }, as("bob"))
    expect(await api.react({ ...inv1, emoji: "🚀" }, as("ada"))).toMatchObject({ added: true })
    await api.react({ ...inv1, emoji: "🎉" }, as("cy"))
    await expectCode(api.react({ ...inv1, emoji: "👀" }, as("bob")), "LIMIT_EXCEEDED")
  })

  it("skip what can't be a reaction in an organization's own list, and allow none for an empty one", async () => {
    let calls = 0
    const { api, as } = setup({
      emojis: ({ orgId }) => {
        calls += 1
        return orgId === "acme" ? ["👍", "👍", "", "x".repeat(80), 7 as unknown as string] : []
      }
    })
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    expect(await api.getSettings(inv1, as("ada"))).toMatchObject({ emojis: ["👍"] })
    await expectCode(
      api.react({ subjectType: "invoice", subjectId: "inv-globex", emoji: "👍" }, as("gus")),
      "INVALID_INPUT"
    )
    // Each organization's list is asked for once a minute.
    expect(calls).toBe(2)
  })

  it("ask an organization for its list again once told to forget it, keeping unlisted emoji after the rest", async () => {
    let list = ["🚀", "🎉", "👍"]
    let calls = 0
    const { api, as } = setup({
      emojis: () => {
        calls += 1
        return list
      }
    })
    await api.react({ ...inv1, emoji: "🚀" }, { ...as("ada"), createdAt: at(1) })
    await api.react({ ...inv1, emoji: "🎉" }, { ...as("ada"), createdAt: at(2) })
    await api.react({ ...inv1, emoji: "👍" }, { ...as("ada"), createdAt: at(3) })
    list = ["👍"]
    await api.getSettings(inv1, as("ada"))
    expect(calls).toBe(1)
    await api.forgetEmojis({ orgId: "acme" })
    const found = await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1"] }, as("ada"))
    expect(calls).toBe(2)
    expect(found["inv-1"]?.map((reaction) => reaction.emoji)).toEqual(["👍", "🚀", "🎉"])
    await api.forgetEmojis({})
    await api.getSettings(inv1, as("ada"))
    expect(calls).toBe(3)
  })

  it("keep listing reactions when an organization's list fails to load", async () => {
    const { api, as } = setup({
      emojis: () => {
        throw new Error("The list is down.")
      }
    })
    expect(await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1"] }, as("ada"))).toEqual({
      "inv-1": []
    })
  })

  it("limit how many different emoji one record has", async () => {
    const { api, as } = setup({ maxEmojis: 2 })
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    await api.react({ ...inv1, emoji: "🎉" }, as("bob"))
    await expectCode(api.react({ ...inv1, emoji: "🚀" }, as("cy")), "LIMIT_EXCEEDED")
    expect(await api.react({ ...inv1, emoji: "👍" }, as("cy"))).toMatchObject({ added: true })
    expect(() => reactions({ subjects: { page: {} }, maxEmojis: 0 })).toThrow("`maxEmojis`")
  })

  it("take each organization's own list of emoji", async () => {
    const { api, as, identity } = setup({
      emojis: async ({ orgId }) => (orgId === "globex" ? [":globex:", "👍"] : ["👍", "🎉"])
    })
    await expectCode(api.react({ ...inv1, emoji: ":globex:" }, as("ada")), "INVALID_INPUT")
    await api.react({ ...inv1, emoji: "🎉" }, as("ada"))
    await api.react({ ...inv1, emoji: "👍" }, as("bob"))
    const globex = { subjectType: "invoice", subjectId: "inv-globex" } as const
    await api.react({ ...globex, emoji: ":globex:" }, as("gus"))
    expect(await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1"] }, as("ada"))).toEqual({
      "inv-1": [
        { emoji: "👍", count: 1, reacted: false },
        { emoji: "🎉", count: 1, reacted: true }
      ]
    })
    expect(await api.getSettings(globex, as("gus"))).toEqual({
      emojis: [":globex:", "👍"],
      emojisByOrg: true,
      maxPerUser: 20,
      maxEmojis: 50,
      reactorVisibility: "viewers"
    })
    await expectCode(api.getSettings(globex, { actor: identity.actor("ada") }), "NOT_FOUND")
  })

  it("add a reaction once when two calls race", async () => {
    const { api, as, database, events } = setup()
    const results = await Promise.all([
      api.react({ ...inv1, emoji: "👍" }, as("ada")),
      api.react({ ...inv1, emoji: "👍" }, as("ada"))
    ])
    expect(results.map((result) => result.added).sort()).toEqual([false, true])
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${reactionModel}`).get()).toEqual({ count: 1 })
    expect(events("reaction.added")).toHaveLength(1)
  })

  it("keep to the limit when different emoji race", async () => {
    const { api, as, database } = setup({ maxPerUser: 2 })
    const results = await Promise.allSettled(
      ["👍", "🎉", "🚀", "👀"].map(async (emoji) => api.react({ ...inv1, emoji }, as("ada")))
    )
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2)
    expect(results.filter((result) => result.status === "rejected")).toEqual(
      Array.from({ length: 2 }, () =>
        expect.objectContaining({ reason: expect.objectContaining({ code: "LIMIT_EXCEEDED" }) })
      )
    )
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${reactionModel}`).get()).toEqual({ count: 2 })
  })

  it("leave one reaction, and report each replacement once, when swaps race", async () => {
    const { api, as, database, events } = setup({ maxPerUser: 1 })
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    await Promise.all(["🎉", "🚀", "👀"].map(async (emoji) => api.react({ ...inv1, emoji }, as("ada"))))
    const rows = database.sqlite.prepare(`SELECT emoji FROM ${reactionModel}`).all() as { emoji: string }[]
    expect(rows).toHaveLength(1)
    // Each reaction that went is reported once, and every reaction added but the last one went.
    const added = events("reaction.added").map((event) => (event.data as { emoji: string }).emoji)
    const removed = events("reaction.removed").map((event) => (event.data as { emoji: string }).emoji)
    expect(added).toHaveLength(4)
    expect(removed.sort()).toEqual(added.filter((emoji) => emoji !== rows[0]?.emoji).sort())
    expect(events("reaction.removed").every((event) => (event.data as { reason: string }).reason === "replaced")).toBe(
      true
    )
  })

  it("treat two spellings of one emoji as one reaction", async () => {
    const { api, as } = setup()
    await api.react({ ...inv1, emoji: "❤" }, as("ada"))
    expect(await api.react({ ...inv1, emoji: "❤️" }, as("bob"))).toMatchObject({
      added: true,
      reaction: { emoji: "❤️" }
    })
    expect((await api.react({ ...inv1, emoji: "❤️" }, as("ada"))).added).toBe(false)
    const found = await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1"] }, as("ada"))
    expect(found["inv-1"]).toEqual([{ emoji: "❤️", count: 2, reacted: true }])
    expect(await api.unreact({ ...inv1, emoji: "❤" }, as("ada"))).toMatchObject({ removed: true })
    const listed = setup({ emojis: ["❤"] })
    await listed.api.react({ ...inv1, emoji: "❤️" }, listed.as("ada"))
  })

  it("take settings per subject type", async () => {
    const { api, as, post } = setup({
      emojis: ["👍", "👎"],
      subjects: { invoice: {}, page: { emojis: ["⭐"], maxPerUser: 1, reactorVisibility: "public" } }
    })
    const home = { subjectType: "page", subjectId: "home" } as const
    await expectCode(api.react({ ...home, emoji: "👍" }, as("ada")), "INVALID_INPUT")
    await api.react({ ...home, emoji: "⭐" }, as("ada"))
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    await api.react({ ...inv1, emoji: "👎" }, as("ada"))
    await expectCode(api.react({ ...inv1, emoji: "⭐" }, as("ada")), "INVALID_INPUT")
    const reactors = await post("listReactors", { ...home, emoji: "⭐" })
    expect(await reactors.json()).toMatchObject({ userIds: ["ada"] })
  })

  it("allow any single emoji, or only the app's list in its order", async () => {
    const open = setup()
    await expectCode(open.api.react({ ...inv1, emoji: "nope" }, open.as("ada")), "INVALID_INPUT")
    await expectCode(open.api.react({ ...inv1, emoji: "👍👍" }, open.as("ada")), "INVALID_INPUT")

    const listed = setup({ emojis: ["🎉", ":shipit:", "👍"] })
    await expectCode(listed.api.react({ ...inv1, emoji: "🚀" }, listed.as("ada")), "INVALID_INPUT")
    await listed.api.react({ ...inv1, emoji: "👍" }, listed.as("ada"))
    await listed.api.react({ ...inv1, emoji: "👍" }, listed.as("bob"))
    await listed.api.react({ ...inv1, emoji: ":shipit:" }, listed.as("ada"))
    await listed.api.react({ ...inv1, emoji: "🎉" }, listed.as("ada"))
    const found = await listed.api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1"] }, listed.as("ada"))
    expect(found["inv-1"]?.map((reaction) => reaction.emoji)).toEqual(["🎉", ":shipit:", "👍"])
    expect(await listed.api.unreact({ ...inv1, emoji: ":shipit:" }, listed.as("ada"))).toMatchObject({ removed: true })
  })

  it("limit how many emoji one person uses on one record", async () => {
    const { api, as } = setup({ maxPerUser: 2 })
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    await api.react({ ...inv1, emoji: "🎉" }, as("ada"))
    await expectCode(api.react({ ...inv1, emoji: "🚀" }, as("ada")), "LIMIT_EXCEEDED")
    expect((await api.react({ ...inv1, emoji: "👍" }, as("ada"))).added).toBe(false)
    await api.react({ ...inv1, emoji: "🚀" }, as("bob"))
  })

  it("replace a person's reaction when each person has one", async () => {
    const { api, as, events } = setup({ maxPerUser: 1 })
    const first = await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    expect(first.replaced).toEqual([])
    const second = await api.react({ ...inv1, emoji: "🎉" }, as("ada"))
    expect(second).toMatchObject({ added: true, replaced: [{ emoji: "👍", userId: "ada" }] })
    expect((await api.react({ ...inv1, emoji: "🎉" }, as("ada"))).added).toBe(false)
    await api.react({ ...inv1, emoji: "👍" }, as("bob"))
    const found = await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1"] }, as("ada"))
    expect(found["inv-1"]).toEqual([
      { emoji: "🎉", count: 1, reacted: true },
      { emoji: "👍", count: 1, reacted: false }
    ])
    expect(events("reaction.removed").map((event) => event.data)).toEqual([
      expect.objectContaining({ emoji: "👍", userId: "ada", reason: "replaced" })
    ])
  })

  it("let moderators remove anyone's reactions, one at a time or together", async () => {
    const { api, as, events } = setup({
      subjects: { invoice: { canModerate: ({ actor }) => actor.roles.includes("admin") }, page: {} }
    })
    await api.react({ ...inv1, emoji: "👍" }, as("bob"))
    await api.react({ ...inv1, emoji: "🎉" }, as("bob"))
    await api.react({ ...inv1, emoji: "🎉" }, as("cy"))
    const target = { ...inv1, emoji: "👍", userId: "bob" }
    await expectCode(api.removeReactions(target, as("cy")), "FORBIDDEN")
    await expectCode(api.removeReactions(target, as("gus")), "NOT_FOUND")
    await expectCode(
      api.removeReactions(target, { actor: null, request: new Request("https://app.test") }),
      "UNAUTHENTICATED"
    )
    await expectCode(api.removeReactions({ ...target, subjectType: "page", subjectId: "home" }, as("ada")), "FORBIDDEN")
    expect(await api.removeReactions(target, as("ada"))).toEqual({ removed: 1, done: true })
    expect(events("reaction.removed")[0]?.data).toMatchObject({ userId: "bob", reason: "moderated" })
    expect(await api.removeReactions(target)).toEqual({ removed: 0, done: true })
    expect(await api.removeReactions({ ...inv1, emoji: "🎉" }, as("ada"))).toEqual({ removed: 2, done: true })
    await api.react({ ...inv1, emoji: "🚀" }, as("cy"))
    expect(await api.removeReactions(inv1)).toEqual({ removed: 1, done: true })
  })

  it("remove many reactions a page at a time, reporting each", async () => {
    const { api, as, database, events } = setup()
    const ids = Array.from({ length: 130 }, (_, index) => `inv-many-${index}`)
    for (const id of ids) {
      invoices.set(id, { orgId: "acme" })
    }
    try {
      for (const id of ids) {
        await api.react({ subjectType: "invoice", subjectId: id, emoji: "👍" }, as("ada"))
      }
      // Each call removes one page, and says whether to call again.
      expect(await api.removeUser({ userId: "ada" })).toEqual({ removed: 100, done: false })
      expect(events("reaction.removed")).toHaveLength(100)
      expect(events("subject.changed")).toHaveLength(100)
      expect(events("user.removed")).toHaveLength(0)
      expect(await api.removeUser({ userId: "ada" })).toEqual({ removed: 30, done: true })
      expect(events("reaction.removed")).toHaveLength(130)
      expect(events("user.removed")).toHaveLength(1)
      expect(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${reactionModel}`).get()).toEqual({ count: 0 })
    } finally {
      for (const id of ids) {
        invoices.delete(id)
      }
    }
  })

  it("tell browsers once when many of a record's reactions change, rather than per reaction", async () => {
    const { api, as, events, identity } = setup({
      subjects: { invoice: { canModerate: ({ actor }) => actor.roles.includes("admin") }, page: {} }
    })
    await api.react({ ...inv1, emoji: "👍" }, as("bob"))
    await api.react({ ...inv1, emoji: "🎉" }, as("cy"))
    await api.removeReactions(inv1, as("ada"))
    const [removed] = events("reaction.removed")
    const [changed] = events("subject.changed")
    if (!removed || !changed) {
      throw new Error("No event was delivered.")
    }
    expect(removed.data).toMatchObject({ reason: "moderated", bulk: true })
    expect(await api.toClientEvent({ event: removed, viewer: identity.actor("bob") })).toBeNull()
    expect(changed.data).toEqual(inv1)
    expect(await api.toClientEvent({ event: changed, viewer: identity.actor("bob") })).toEqual({
      id: changed.id,
      type: "subject.changed",
      ...inv1
    })
    expect(await api.toClientEvent({ event: changed, viewer: identity.actor("gus") })).toBeNull()
    invoices.set("inv-moving", { orgId: "acme" })
    try {
      const moving = { subjectType: "invoice", subjectId: "inv-moving" } as const
      await api.react({ ...moving, emoji: "👍" }, as("bob"))
      invoices.set("inv-moving", { orgId: "globex" })
      await api.moveSubject({ ...moving, toOrgId: "globex" })
      const moved = events("subject.moved")[0]
      expect(moved && (await api.toClientEvent({ event: moved, viewer: identity.actor("gus") }))).toMatchObject({
        type: "subject.changed",
        ...moving
      })
      expect(moved && (await api.toClientEvent({ event: moved, viewer: identity.actor("ada") }))).toBeNull()
    } finally {
      invoices.delete("inv-moving")
    }
  })

  it("remove a person's reactions in one organization", async () => {
    const { api, as } = setup()
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    await api.react({ subjectType: "page", subjectId: "home", emoji: "👍" }, as("ada"))
    expect(await api.removeUser({ userId: "ada", orgId: "acme" })).toEqual({ removed: 1, done: true })
    expect(await api.removeUser({ userId: "ada", orgId: null })).toEqual({ removed: 1, done: true })
  })

  it("check who can react", async () => {
    const { api, as, post } = setup()
    expect((await post("react", { ...inv1, emoji: "👍" })).status).toBe(401)
    await expectCode(api.react({ ...inv1, emoji: "👍" }), "UNAUTHENTICATED")
    await expectCode(api.react({ ...inv1, emoji: "👍" }, as("gus")), "NOT_FOUND")
    await expectCode(
      api.react({ subjectType: "invoice", subjectId: "inv-locked", emoji: "👍" }, as("ada")),
      "FORBIDDEN"
    )
    // Taking back one's own reaction needs only to see the record.
    expect(await api.unreact({ subjectType: "invoice", subjectId: "inv-locked", emoji: "👍" }, as("ada"))).toEqual({
      reaction: null,
      removed: false
    })
    await expectCode(api.unreact({ ...inv1, emoji: "👍" }, as("gus")), "NOT_FOUND")
    await expectCode(
      api.react({ subjectType: "ticket" as "page", subjectId: "t", emoji: "👍" }, as("ada")),
      "INVALID_INPUT"
    )
    expect((await post("react", { ...inv1, emoji: "👍" }, "bob")).status).toBe(200)
  })
})

describe("listReactions", () => {
  it("show nothing on records the caller can't see, and public records to everyone", async () => {
    const { api, as, post } = setup()
    const page = { subjectType: "page", subjectId: "home" } as const
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    await api.react({ ...page, emoji: "👍" }, as("ada"))
    expect(await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1"] }, as("gus"))).toEqual({
      "inv-1": []
    })
    const response = await post("listReactions", { subjectType: "invoice", subjectIds: ["inv-1"] })
    expect(await response.json()).toEqual({ "inv-1": [] })
    const pages = await post("listReactions", { subjectType: "page", subjectIds: ["home", "home"] })
    expect(await pages.json()).toEqual({ home: [{ emoji: "👍", count: 1, reacted: false }] })
    expect(await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1"] })).toEqual({
      "inv-1": [{ emoji: "👍", count: 1, reacted: false }]
    })
  })

  it("take at most 50 records", async () => {
    const { post } = setup()
    const subjectIds = Array.from({ length: 51 }, (_, index) => `inv-${index}`)
    expect((await post("listReactions", { subjectType: "invoice", subjectIds }, "ada")).status).toBe(400)
  })
})

describe("listReactors", () => {
  it("page through who reacted, first reaction first, with names", async () => {
    const { api, as } = setup()
    await api.react({ ...inv1, emoji: "👍" }, { ...as("cy"), createdAt: at(3) })
    await api.react({ ...inv1, emoji: "👍" }, { ...as("ada"), createdAt: at(1) })
    await api.react({ ...inv1, emoji: "👍" }, { ...as("bob"), createdAt: at(2) })
    await api.react({ ...inv1, emoji: "🎉" }, { ...as("bob"), createdAt: at(4) })
    const first = await api.listReactors({ ...inv1, emoji: "👍", limit: 2 }, as("bob"))
    expect(first.userIds).toEqual(["ada", "bob"])
    expect(first.users.ada?.name).toBe("Ada Lovelace")
    expect(first.cursor).not.toBeNull()
    const second = await api.listReactors({ ...inv1, emoji: "👍", limit: 2, cursor: first.cursor ?? "" }, as("bob"))
    expect(second).toMatchObject({ userIds: ["cy"], cursor: null })
  })

  it("refuse records the caller can't see, and bad cursors", async () => {
    const { api, as, post } = setup()
    await expectCode(api.listReactors({ ...inv1, emoji: "👍" }, as("gus")), "NOT_FOUND")
    expect((await post("listReactors", { ...inv1, emoji: "👍" })).status).toBe(401)
    await expectCode(api.listReactors({ ...inv1, emoji: "👍", cursor: "nope" }, as("ada")), "INVALID_INPUT")
    await expectCode(api.listReactors({ ...inv1, emoji: "👍", cursor: btoa("[1,2]") }, as("ada")), "INVALID_INPUT")
    const page = await post("listReactors", { subjectType: "page", subjectId: "home", emoji: "👍" })
    expect(page.status).toBe(401)
    const signedIn = await post("listReactors", { subjectType: "page", subjectId: "home", emoji: "👍" }, "gus")
    expect(await signedIn.json()).toEqual({ userIds: [], cursor: null, users: {} })
    const open = setup({ reactorVisibility: "public" })
    const shown = await open.post("listReactors", { subjectType: "page", subjectId: "home", emoji: "👍" })
    expect(await shown.json()).toEqual({ userIds: [], cursor: null, users: {} })
  })

  it("keep who reacted private when reactions are anonymous, except from moderators", async () => {
    const { api, as, events, identity } = setup({
      reactorVisibility: "hidden",
      subjects: { invoice: { canModerate: ({ actor }) => actor.roles.includes("admin") }, page: {} }
    })
    await api.react({ ...inv1, emoji: "👍" }, as("bob"))
    await expectCode(api.listReactors({ ...inv1, emoji: "👍" }, as("cy")), "FORBIDDEN")
    expect((await api.listReactors({ ...inv1, emoji: "👍" }, as("ada"))).userIds).toEqual(["bob"])
    expect((await api.listReactors({ ...inv1, emoji: "👍" })).userIds).toEqual(["bob"])
    const [event] = events("reaction.added")
    if (!event) {
      throw new Error("No event was delivered.")
    }
    expect(await api.toClientEvent({ event, viewer: identity.actor("cy") })).toMatchObject({ userId: "", mine: false })
    expect(await api.toClientEvent({ event, viewer: identity.actor("bob") })).toMatchObject({
      userId: "bob",
      mine: true
    })
    expect(await api.toClientEvent({ event, viewer: identity.actor("ada") })).toMatchObject({ userId: "bob" })
  })
})

describe("upkeep", () => {
  it("hides reactions of a record that changed organization until they move with it", async () => {
    const { api, as, events, post } = setup()
    invoices.set("inv-moving", { orgId: "acme" })
    const moving = { subjectType: "invoice", subjectId: "inv-moving" } as const
    await api.react({ ...moving, emoji: "👍" }, as("ada"))
    invoices.set("inv-moving", { orgId: "globex" })
    const list = { subjectType: "invoice", subjectIds: ["inv-moving"] } as const
    expect(await api.listReactions(list, as("gus"))).toEqual({ "inv-moving": [] })
    expect((await post("moveSubject", { ...moving, toOrgId: "globex" }, "ada")).status).toBe(404)
    expect(await api.moveSubject({ ...moving, toOrgId: "globex" })).toEqual({ moved: 1, done: true })
    expect(events("subject.moved")[0]?.data).toEqual({ ...moving, toOrgId: "globex" })
    expect(await api.listReactions(list, as("gus"))).toEqual({
      "inv-moving": [{ emoji: "👍", count: 1, reacted: false }]
    })
    expect(await api.moveSubject({ ...moving, toOrgId: null })).toEqual({ moved: 1, done: true })
    invoices.delete("inv-moving")
  })

  it("lets people react to a moved record before its reactions move, and keeps one of each when they do", async () => {
    const { api, as, database, events, identity } = setup({ maxPerUser: 1 })
    invoices.set("inv-moving", { orgId: "acme" })
    const moving = { subjectType: "invoice", subjectId: "inv-moving" } as const
    try {
      // Gus, while in Acme, and Ada react before the record moves to Globex.
      await api.react({ ...moving, emoji: "🚀" }, { actor: { ...identity.actor("gus"), orgId: "acme" } })
      await api.react({ ...moving, emoji: "👍" }, as("ada"))
      invoices.set("inv-moving", { orgId: "globex" })
      // The reactions left under Acme neither count nor stand in the way.
      expect(await api.react({ ...moving, emoji: "🚀" }, as("gus"))).toMatchObject({ added: true, replaced: [] })
      expect(await api.moveSubject({ ...moving, toOrgId: "globex" })).toEqual({ moved: 1, done: true })
      // Gus's first reaction merges into the one he made since, and is reported gone.
      expect(events("reaction.removed").map((event) => event.data)).toEqual([
        expect.objectContaining({ userId: "gus", emoji: "🚀", orgId: "acme", reason: "merged" })
      ])
      const rows = database.sqlite.prepare(`SELECT "userId", emoji, "orgId" FROM ${reactionModel} ORDER BY "userId"`)
      expect(rows.all()).toEqual([
        { userId: "ada", emoji: "👍", orgId: "globex" },
        { userId: "gus", emoji: "🚀", orgId: "globex" }
      ])
    } finally {
      invoices.delete("inv-moving")
    }
  })

  it("remove a record's reactions, and a user's", async () => {
    const { api, as, events } = setup()
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    await api.react({ ...inv1, emoji: "🎉" }, as("bob"))
    await api.react({ subjectType: "invoice", subjectId: "inv-2", emoji: "👍" }, as("bob"))
    expect(await api.removeUser({ userId: "bob" })).toEqual({ removed: 2, done: true })
    expect(await api.removeSubject(inv1)).toEqual({ removed: 1, done: true })
    expect(events("user.removed")[0]?.data).toEqual({ userId: "bob", orgId: null })
    expect(events("subject.removed")[0]?.data).toEqual(inv1)
    expect(events("reaction.removed").map((event) => event.data)).toEqual([
      expect.objectContaining({ userId: "bob", emoji: "🎉", reason: "userRemoved" }),
      expect.objectContaining({ userId: "bob", subjectId: "inv-2", reason: "userRemoved" }),
      expect.objectContaining({ userId: "ada", emoji: "👍", reason: "subjectRemoved" })
    ])
    expect(await api.listReactions({ subjectType: "invoice", subjectIds: ["inv-1", "inv-2"] })).toEqual({
      "inv-1": [],
      "inv-2": []
    })
  })
})

describe("toClientEvent", () => {
  it("passes reaction events to viewers who can see the record, marking their own", async () => {
    const { api, as, events, identity } = setup()
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    const [event] = events("reaction.added")
    if (!event) {
      throw new Error("No event was delivered.")
    }
    expect(await api.toClientEvent({ event, viewer: identity.actor("ada") })).toEqual({
      id: event.id,
      type: "reaction.added",
      ...inv1,
      userId: "ada",
      emoji: "👍",
      count: 1,
      mine: true
    })
    // Many viewers at once, with one access check for all of them.
    expect(
      await api.toClientEvents({
        event,
        viewers: [identity.actor("bob"), identity.actor("gus"), null, identity.actor("ada")].map((actor) => ({ actor }))
      })
    ).toEqual([
      expect.objectContaining({ userId: "ada", mine: false }),
      null,
      null,
      expect.objectContaining({ mine: true })
    ])
    expect(await api.toClientEvents({ event, viewers: [] })).toEqual([])
    expect(await api.toClientEvents({ event: { ...event, type: "user.removed" }, viewers: [{ actor: null }] })).toEqual(
      [null]
    )
    expect(await api.toClientEvent({ event, viewer: identity.actor("bob") })).toMatchObject({ mine: false })
    expect(await api.toClientEvent({ event, viewer: identity.actor("gus") })).toBeNull()
    expect(await api.toClientEvent({ event, viewer: null })).toBeNull()
    expect(await api.toClientEvent({ event: { ...event, feature: "comments" }, viewer: null })).toBeNull()
    expect(await api.toClientEvent({ event: { ...event, type: "user.removed" }, viewer: null })).toBeNull()
    const elsewhere = { ...event, data: { ...(event.data as object), subjectType: "ticket" } }
    expect(await api.toClientEvent({ event: elsewhere, viewer: identity.actor("ada") })).toBeNull()
    const stale = { ...event, data: { ...(event.data as object), orgId: "old" } }
    expect(await api.toClientEvent({ event: stale, viewer: identity.actor("ada") })).toBeNull()

    await api.react({ subjectType: "page", subjectId: "home", emoji: "🎉" }, as("bob"))
    const onPage = events("reaction.added")[1]
    if (!onPage) {
      throw new Error("No event was delivered.")
    }
    // Signed-out visitors see that someone reacted, and who only when the app shows them.
    expect(await api.toClientEvent({ event: onPage, viewer: null })).toMatchObject({ userId: "", mine: false })
    const open = setup({ reactorVisibility: "public" })
    await open.api.react({ subjectType: "page", subjectId: "home", emoji: "🎉" }, open.as("bob"))
    const shown = open.events("reaction.added")[0]
    expect(shown && (await open.api.toClientEvent({ event: shown, viewer: null }))).toMatchObject({ userId: "bob" })
  })
})

describe("with comments", () => {
  // Comments' subject types and events, as @better-apps/comments declares them, without its tables.
  function withComments({ open = false } = {}) {
    const threads = new Map([["t-1", { orgId: "acme", comments: new Set(["c-1", "c-2"]) }]])
    // Runs once, right after the next organization lookup, such as to move a thread while a reaction is saved.
    // `failOnce` fails the next delivery of that reactions event once, after reactions handled it, as a crash would.
    const hooks: { afterOrg?: (() => void) | undefined; failOnce?: string | undefined } = {}
    const threadOf = (commentId: string) => [...threads].find(([, thread]) => thread.comments.has(commentId))
    // A comment in `vanishing` passes one access check, then is gone, as one deleted while a reaction is saved.
    const vanishing = new Set<string>()
    const subject = (find: (id: string) => { orgId: string } | undefined): SubjectDefinition => ({
      canView: ({ actor, subjectId }) =>
        vanishing.delete(subjectId) || (open ? find(subjectId) !== undefined : actor.orgId === find(subjectId)?.orgId),
      getOrgId: ({ subjectId }) => {
        const orgId = find(subjectId)?.orgId ?? null
        const after = hooks.afterOrg
        hooks.afterOrg = undefined
        after?.()
        return orgId
      }
    })
    const fake = defineFeature({
      id: "comments",
      subjects: {
        "comments.thread": subject((id) => threads.get(id)),
        "comments.comment": subject((id) => threadOf(id)?.[1])
      },
      events: {
        "comment.deleted": defineEvent(),
        "thread.deleted": defineEvent(),
        "thread.moved": defineEvent()
      },
      actions: {
        emit: defineAction({
          handler: async ({ input, emit }) => {
            const { type, data } = input as { type: string; data: unknown }
            emit(type, data)
          }
        })
      }
    })
    const feature = reactions({ subjects: { "comments.comment": {}, "comments.thread": {} } })
    const delivered: BetterAppsEvent[] = []
    const record: EventHandler = (event) => {
      if (hooks.failOnce === event.type) {
        hooks.failOnce = undefined
        throw new Error("Crashed")
      }
      delivered.push(event)
    }
    const feed = defineFeature({
      id: "feed",
      on: { reactions: Object.fromEntries(Object.keys(reactionEvents).map((type) => [type, record])) }
    })
    const { app, database, identity } = createTestApp({ subjects, features: [feature, fake, feed], users })
    const events = (type: string) => delivered.filter((event) => event.type === type)
    const as = (userId: "ada" | "bob" | "gus") => ({ actor: identity.actor(userId) })
    const count = () => database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${reactionModel}`).get()
    const inOrg = (orgId: string) =>
      database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${reactionModel} WHERE orgId = ?`).get(orgId)
    return {
      api: app.api.reactions,
      emit: app.api.comments.emit,
      deliver: () => app.deliverEvents(),
      as,
      threads,
      vanishing,
      hooks,
      count,
      inOrg,
      database,
      events
    }
  }
  const moved = (threadId: string, toOrgId: string, commentIds: string[], fromOrgId = "acme") => ({
    type: "thread.moved",
    data: { thread: { id: threadId, orgId: toOrgId }, fromOrgId, commentIds }
  })
  const comment = (id: string) => ({ subjectType: "comments.comment", subjectId: id }) as const

  it("subscribe only when comments' records have reactions", () => {
    expect(reactions({ subjects: { invoice: {} } }).on).toBeUndefined()
    expect(Object.keys(reactions({ subjects: { "comments.comment": {} } }).on?.comments ?? {})).toEqual([
      "comment.deleted",
      "thread.deleted",
      "thread.moved"
    ])
  })

  it("remove a deleted comment's reactions, and a deleted thread's", async () => {
    const { api, emit, as, count, threads, vanishing, events } = withComments()
    await api.react({ ...comment("c-1"), emoji: "👍" }, as("ada"))
    await api.react({ ...comment("c-2"), emoji: "👍" }, as("bob"))
    await api.react({ subjectType: "comments.thread", subjectId: "t-1", emoji: "👀" }, as("bob"))
    await emit({ type: "comment.deleted", data: { comment: { id: "c-1" } } })
    expect(count()).toEqual({ count: 2 })
    // A reaction that lands after its comment is gone is taken back.
    threads.set("t-1", { orgId: "acme", comments: new Set(["c-2"]) })
    vanishing.add("c-3")
    await expectCode(api.react({ ...comment("c-3"), emoji: "🎉" }, as("bob")), "NOT_FOUND")
    expect(count()).toEqual({ count: 2 })
    expect(events("reaction.removed").at(-1)?.data).toMatchObject({ subjectId: "c-3", reason: "withdrawn" })
    await emit({ type: "thread.deleted", data: { thread: { id: "t-1", orgId: "acme" }, commentIds: ["c-2"] } })
    expect(count()).toEqual({ count: 0 })
  })

  it("take back a reaction whose record moved while it was saved", async () => {
    const { api, as, threads, hooks, count, events } = withComments({ open: true })
    hooks.afterOrg = () => threads.set("t-1", { orgId: "globex", comments: new Set(["c-1", "c-2"]) })
    await expectCode(api.react({ ...comment("c-1"), emoji: "👍" }, as("ada")), "CONFLICT")
    expect(count()).toEqual({ count: 0 })
    expect(events("reaction.removed")[0]?.data).toMatchObject({ reason: "withdrawn", orgId: "acme" })
    expect(events("reaction.removed")[0]?.data).not.toHaveProperty("bulk")
  })

  it("move a thread's reactions, and its comments', with it", async () => {
    const { api, emit, deliver, as, threads, events } = withComments()
    await api.react({ ...comment("c-1"), emoji: "👍" }, as("ada"))
    threads.set("t-1", { orgId: "globex", comments: new Set(["c-1", "c-2"]) })
    const list = { subjectType: "comments.comment", subjectIds: ["c-1"] } as const
    expect(await api.listReactions(list, as("gus"))).toEqual({ "c-1": [] })
    await emit(moved("t-1", "globex", ["c-1", "c-2"]))
    expect(events("subject.moved").map((event) => event.data)).toEqual([
      { subjectType: "comments.comment", subjectId: "c-1", toOrgId: "globex" }
    ])
    expect(await api.listReactions(list, as("gus"))).toEqual({ "c-1": [{ emoji: "👍", count: 1, reacted: false }] })
    // `move.finished` is written with the delivery's removal, so it reaches subscribers in the next run.
    expect(events("move.finished")).toEqual([])
    await deliver()
    expect(events("move.finished").map((event) => event.data)).toEqual([
      {
        subjectType: "comments.thread",
        subjectId: "t-1",
        fromOrgId: "acme",
        toOrgId: "globex",
        moveEventId: expect.any(String)
      }
    ])
  })

  // A thread with more reactions on its comments than one delivery cleans up.
  async function busyThread(setup: ReturnType<typeof withComments>, reactionsPerUser: number) {
    const ids = Array.from({ length: reactionsPerUser }, (_, index) => `big-${index}`)
    setup.threads.set("t-big", { orgId: "acme", comments: new Set(ids) })
    for (const id of ids) {
      await setup.api.react({ ...comment(id), emoji: "👍" }, setup.as("ada"))
      await setup.api.react({ ...comment(id), emoji: "👍" }, setup.as("bob"))
    }
    return ids
  }

  it("clean up after a big deleted thread a page per delivery, finishing in later runs", async () => {
    const setup = withComments()
    const ids = await busyThread(setup, 60)
    await setup.emit({ type: "thread.deleted", data: { thread: { id: "t-big", orgId: "acme" }, commentIds: ids } })
    // A page of 100 goes now, and the rest waits for the next delivery run.
    expect(setup.count()).toEqual({ count: 20 })
    expect(setup.events("subject.changed").length).toBeGreaterThan(0)
    expect(await setup.deliver()).toMatchObject({ failed: 0 })
    expect(setup.count()).toEqual({ count: 0 })
    expect(setup.events("cleanup.continued")).toHaveLength(1)
  })

  it("read a bounded number of lists of ids per delivery, so a thread of many comments fits in a request", async () => {
    const setup = withComments()
    // 1,000 comments, only the last with a reaction, take twelve lists of 90 ids: ten now and two in the next run.
    const ids = Array.from({ length: 1000 }, (_, index) => `many-${index}`)
    setup.threads.set("t-many", { orgId: "acme", comments: new Set(ids) })
    await setup.api.react({ ...comment("many-999"), emoji: "👍" }, setup.as("ada"))
    await setup.emit({ type: "thread.deleted", data: { thread: { id: "t-many", orgId: "acme" }, commentIds: ids } })
    expect(setup.count()).toEqual({ count: 1 })
    await setup.deliver()
    expect(setup.count()).toEqual({ count: 0 })
  })

  it("never let an older move's later pages undo a newer move, nor report it finished", async () => {
    const setup = withComments()
    const ids = await busyThread(setup, 20)
    const { inOrg } = setup
    // The move to globex leaves its last page for later, and the thread moves on before that runs.
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids))
    expect(inOrg("globex")).toEqual({ count: 30 })
    setup.threads.set("t-big", { orgId: "initech", comments: new Set(ids) })
    await setup.deliver()
    // The older job's last page doesn't move what's left to globex, where the thread no longer is.
    expect(inOrg("globex")).toEqual({ count: 30 })
    expect(inOrg("acme")).toEqual({ count: 10 })
    await setup.deliver()
    expect(setup.events("move.finished")).toEqual([])
    // The newer move takes everything along, and is the only one reported finished.
    await setup.emit(moved("t-big", "initech", ids))
    await setup.deliver()
    await setup.deliver()
    await setup.deliver()
    expect(inOrg("initech")).toEqual({ count: 40 })
    expect(setup.events("move.finished").map((event) => event.data)).toMatchObject([{ toOrgId: "initech" }])
  })

  it("stop a move when its thread is deleted between pages, reporting no move.finished", async () => {
    const setup = withComments()
    const ids = await busyThread(setup, 20)
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids))
    expect(setup.inOrg("globex")).toEqual({ count: 30 })
    setup.threads.delete("t-big")
    await setup.deliver()
    await setup.deliver()
    // The thread's own deletion takes what's left.
    expect(setup.inOrg("acme")).toEqual({ count: 10 })
    expect(setup.events("move.finished")).toEqual([])
  })

  it("stop an older move that's still paging when its thread moves back, which takes every reaction back", async () => {
    const setup = withComments()
    const ids = await busyThread(setup, 20)
    await setup.api.react({ subjectType: "comments.thread", subjectId: "t-big", emoji: "👀" }, setup.as("ada"))
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids))
    // The first page takes the thread's reaction and 29 of its comments'.
    expect(setup.inOrg("globex")).toEqual({ count: 30 })
    setup.threads.set("t-big", { orgId: "acme", comments: new Set(ids) })
    await setup.emit(moved("t-big", "acme", ids, "globex"))
    await setup.deliver()
    await setup.deliver()
    await setup.deliver()
    expect(setup.inOrg("globex")).toEqual({ count: 0 })
    expect(setup.inOrg("acme")).toEqual({ count: 41 })
    expect(setup.events("move.finished").map((event) => event.data)).toMatchObject([
      { fromOrgId: "globex", toOrgId: "acme" }
    ])
  })

  it("keep moving a thread's comments when the job's first comment was deleted before its delivery", async () => {
    const setup = withComments()
    const ids = await busyThread(setup, 20)
    // The thread moves, and its first comment is deleted before the move is delivered, so comments no longer find it.
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids.slice(1)) })
    await setup.emit(moved("t-big", "globex", ids))
    await setup.deliver()
    expect(setup.inOrg("acme")).toEqual({ count: 0 })
    expect(setup.inOrg("globex")).toEqual({ count: 40 })
    // The deleted comment's own cleanup takes its reactions, wherever they are.
    await setup.emit({ type: "comment.deleted", data: { comment: { id: "big-0" } } })
    expect(setup.inOrg("globex")).toEqual({ count: 38 })
    await setup.deliver()
    expect(setup.events("move.finished")).toHaveLength(1)
  })

  it("keep moving a thread's comments when the next page's first comment was deleted between pages", async () => {
    const setup = withComments()
    const ids = await busyThread(setup, 20)
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids))
    expect(setup.inOrg("globex")).toEqual({ count: 30 })
    // The next page starts at the first comment again, which is deleted before that page runs.
    setup.threads.get("t-big")?.comments.delete("big-0")
    await setup.deliver()
    expect(setup.inOrg("acme")).toEqual({ count: 0 })
    expect(setup.inOrg("globex")).toEqual({ count: 40 })
    await setup.deliver()
    expect(setup.events("move.finished")).toHaveLength(1)
  })

  it("move a big thread's reactions a page per delivery, telling browsers with each page", async () => {
    const setup = withComments()
    const ids = await busyThread(setup, 20)
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids))
    const told = () =>
      new Set(setup.events("subject.moved").map((event) => (event.data as { subjectId: string }).subjectId)).size
    // A page of 30 moves now with its records' subject.moved, and the rest in the next run.
    expect(setup.inOrg("globex")).toEqual({ count: 30 })
    expect(told()).toBeGreaterThanOrEqual(15)
    await setup.deliver()
    expect(setup.inOrg("globex")).toEqual({ count: 40 })
    expect(told()).toBe(20)
    // The last page leaves `move.finished` for the next run, once.
    expect(setup.events("move.finished")).toEqual([])
    await setup.deliver()
    await setup.deliver()
    expect(setup.events("move.finished").map((event) => event.data)).toEqual([
      {
        subjectType: "comments.thread",
        subjectId: "t-big",
        fromOrgId: "acme",
        toOrgId: "globex",
        // The same on every page, from the event that reported the move.
        moveEventId: (setup.events("cleanup.continued")[0]?.data as { move?: { moveEventId: string } } | undefined)
          ?.move?.moveEventId
      }
    ])
  })

  it("report a move finished once when its last page's delivery is retried", async () => {
    const setup = withComments()
    const ids = await busyThread(setup, 20)
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids))
    // The last page moves, then its delivery fails before it's done, and is retried once its backoff passes.
    setup.hooks.failOnce = "cleanup.continued"
    expect(await setup.deliver()).toMatchObject({ failed: 1 })
    expect(setup.inOrg("globex")).toEqual({ count: 40 })
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      vi.setSystemTime(Date.now() + 60_000)
      expect(await setup.deliver()).toMatchObject({ delivered: 1, failed: 0 })
      await setup.deliver()
      vi.setSystemTime(Date.now() + 60 * 60_000)
      await setup.deliver()
    } finally {
      vi.useRealTimers()
    }
    expect(setup.events("move.finished")).toHaveLength(1)
  })
})
