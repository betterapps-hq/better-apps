// @vitest-environment happy-dom
import type { BetterAppsEvent } from "better-apps"
import { createBetterAppsClient } from "better-apps/client"
import { describe, expect, expectTypeOf, it } from "vitest"
import { setup } from "../test/app.js"
import { browser } from "../test/browser.js"
import { countKey, createCommentsClient, listKey, mentionToken, type CommentsState } from "./client.js"
import type { CommentThread } from "./index.js"

const onInvoice = { subjectType: "invoice", subjectId: "inv-1" } as const
const seed = { author: { type: "system", name: "Seed" } } as const
const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes))
const ids = (state: CommentsState, key = listKey(onInvoice)) => state.lists[key]?.ids ?? []

describe("loading", () => {
  it("loads lists a page at a time, with dates and the users they name", async () => {
    const { api, as, comments } = browser()
    for (const minute of [1, 2, 3]) {
      await api.createThread({ ...onInvoice, body: `At ${minute}` }, { ...as("ada"), createdAt: at(minute) })
    }
    await comments.loadThreads(onInvoice, { order: "created" })
    const key = listKey(onInvoice, { order: "created" })
    let state = comments.store.getSnapshot()
    expect(state.lists[key]).toMatchObject({ state: "ready", ids: expect.any(Array), cursor: null })
    const [newest] = ids(state, key).map((id) => state.threads[id] as CommentThread)
    expect(newest?.createdAt).toEqual(at(3))
    expect(state.users.ada?.name).toBe("Ada Lovelace")

    await comments.loadThreads(onInvoice)
    const page = await api.listThreads({ ...onInvoice, limit: 2 }, as("bob"))
    expect(page.cursor).not.toBeNull()
    state = comments.store.getSnapshot()
    expect(ids(state)).toHaveLength(3)
    await comments.loadMoreThreads(onInvoice)
    expect(ids(comments.store.getSnapshot())).toHaveLength(3)
  })

  it("loads a thread's comments and pages through them", async () => {
    const { api, as, comments } = browser()
    const { thread } = await api.createThread({ ...onInvoice, body: "One" }, { ...as("bob"), createdAt: at(1) })
    for (let minute = 2; minute <= 52; minute += 1) {
      await api.reply({ threadId: thread.id, body: `#${minute}` }, { ...as("ada"), createdAt: at(minute) })
    }
    await comments.loadThread(thread.id)
    expect(comments.store.getSnapshot().threadComments[thread.id]).toMatchObject({
      state: "ready",
      cursor: expect.any(String)
    })
    await comments.loadMoreComments(thread.id)
    const loaded = comments.store.getSnapshot().threadComments[thread.id]
    expect(loaded?.ids).toHaveLength(52)
    expect(loaded?.cursor).toBeNull()
    await comments.loadMoreComments(thread.id)
    expect(comments.store.getSnapshot().comments[loaded?.ids[0] ?? ""]?.createdAt).toEqual(at(1))
  })

  it("records load errors on the list or thread, and rethrows them", async () => {
    const { comments } = browser("gus")
    await expect(comments.loadThreads(onInvoice)).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(comments.store.getSnapshot().lists[listKey(onInvoice)]).toMatchObject({
      state: "error",
      error: { code: "NOT_FOUND" }
    })
    await expect(comments.loadThread("missing")).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(comments.store.getSnapshot().threadComments.missing?.state).toBe("error")
    await comments.loadMoreThreads({ subjectType: "invoice", subjectId: "never-loaded" })
  })

  it("counts many subjects, 50 per call", async () => {
    const { api, as, comments, requests } = browser()
    await api.createThread({ ...onInvoice, body: "Hi" }, as("bob"))
    const subjectIds = ["inv-1", ...Array.from({ length: 59 }, (_, index) => `x-${index}`), "inv-1"]
    await comments.loadCounts("invoice", subjectIds)
    expect(requests.filter((action) => action === "countThreads")).toHaveLength(2)
    const { counts } = comments.store.getSnapshot()
    expect(counts[countKey("invoice", "inv-1")]).toEqual({ open: 1, total: 1, state: "ready" })
    expect(counts[countKey("invoice", "x-58")]).toEqual({ open: 0, total: 0, state: "ready" })
  })
})

describe("optimistic writes", () => {
  it("shows a new thread at once under its final id, then the server's version", async () => {
    const { comments } = browser()
    await comments.loadThreads(onInvoice)
    await comments.loadCounts("invoice", ["inv-1"])
    const writing = comments.createThread({ ...onInvoice, body: `Check ${mentionToken("ada")}` })
    let state = comments.store.getSnapshot()
    const [id] = ids(state)
    expect(state.threads[id ?? ""]).toMatchObject({ createdBy: "", commentCount: 1 })
    expect(state.pending[id ?? ""]).toBe(true)
    expect(state.counts[countKey("invoice", "inv-1")]).toMatchObject({ open: 1, total: 1 })
    const { thread, comment } = await writing
    state = comments.store.getSnapshot()
    expect(thread.id).toBe(id)
    expect(state.threads[thread.id]).toMatchObject({ createdBy: "bob", orgId: "acme" })
    expect(state.comments[comment.id]).toMatchObject({ authorId: "bob", bodyText: `Check ${mentionToken("ada")}` })
    expect(state.pending).toEqual({})
  })

  it("rolls a refused write back and rethrows the server's error", async () => {
    const { comments } = browser()
    const subject = { subjectType: "invoice", subjectId: "inv-locked" } as const
    await comments.loadThreads(subject)
    const before = comments.store.getSnapshot()
    await expect(comments.createThread({ ...subject, body: "Hi" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    })
    expect(comments.store.getSnapshot()).toMatchObject({ threads: before.threads, lists: before.lists, pending: {} })
  })

  it("adds replies, reopening resolved threads and moving them up", async () => {
    const { api, as, comments } = browser()
    const old = await api.createThread({ ...onInvoice, body: "Old" }, { ...as("bob"), createdAt: at(1) })
    await api.createThread({ ...onInvoice, body: "New" }, { ...as("bob"), createdAt: at(2) })
    await api.resolveThread({ threadId: old.thread.id }, as("bob"))
    await comments.loadThreads(onInvoice)
    await comments.loadThreads(onInvoice, { status: "open" })
    await comments.loadThread(old.thread.id)
    await comments.loadCounts("invoice", ["inv-1"])
    expect(ids(comments.store.getSnapshot())[1]).toBe(old.thread.id)
    const { comment } = await comments.reply({ threadId: old.thread.id, body: "Not done" })
    const state = comments.store.getSnapshot()
    expect(ids(state)[0]).toBe(old.thread.id)
    expect(ids(state, listKey(onInvoice, { status: "open" }))).toContain(old.thread.id)
    expect(state.threads[old.thread.id]).toMatchObject({ status: "open", commentCount: 2 })
    expect(state.threadComments[old.thread.id]?.ids.at(-1)).toBe(comment.id)
    expect(state.counts[countKey("invoice", "inv-1")]).toMatchObject({ open: 2, total: 2 })
    await expect(comments.reply({ threadId: "unknown", body: "x" })).rejects.toThrow(
      "Load thread unknown before changing it."
    )
  })

  it("rolls back a refused reply", async () => {
    const { api, comments } = browser()
    const { thread } = await api.createThread({ subjectType: "invoice", subjectId: "inv-locked", body: "Locked" }, seed)
    await comments.loadThread(thread.id)
    await expect(comments.reply({ threadId: thread.id, body: "Hi" })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(comments.store.getSnapshot().threads[thread.id]?.commentCount).toBe(1)
    expect(comments.store.getSnapshot().threadComments[thread.id]?.ids).toHaveLength(1)
  })

  it("edits, deletes, resolves, reopens, updates, moves and deletes threads", async () => {
    const { comments } = browser("ada")
    await comments.loadThreads(onInvoice)
    await comments.loadThreads(onInvoice, { status: "open" })
    await comments.loadCounts("invoice", ["inv-1"])
    const { thread, comment } = await comments.createThread({
      ...onInvoice,
      body: "First",
      anchor: { kind: "element", value: { selector: "#a" } }
    })
    const second = await comments.reply({ threadId: thread.id, body: "Second" })
    expect((await comments.editComment({ commentId: comment.id, body: "Edited" })).comment.bodyText).toBe("Edited")
    expect(comments.store.getSnapshot().comments[comment.id]?.editedAt).toBeInstanceOf(Date)
    expect(await comments.deleteComment({ commentId: second.comment.id })).toMatchObject({ threadDeleted: false })
    expect(comments.store.getSnapshot().threads[thread.id]?.commentCount).toBe(1)
    await comments.resolveThread({ threadId: thread.id })
    let state = comments.store.getSnapshot()
    expect(state.threads[thread.id]?.status).toBe("resolved")
    expect(ids(state, listKey(onInvoice, { status: "open" }))).not.toContain(thread.id)
    expect(state.counts[countKey("invoice", "inv-1")]).toMatchObject({ open: 0, total: 1 })
    await comments.reopenThread({ threadId: thread.id })
    expect(comments.store.getSnapshot().counts[countKey("invoice", "inv-1")]).toMatchObject({ open: 1, total: 1 })
    expect(
      await comments.updateThread({ threadId: thread.id, fields: { priority: "high" }, visibility: "staff" })
    ).toMatchObject({
      priority: "high",
      visibility: "staff"
    })
    expect(await comments.updateAnchor({ threadId: thread.id, anchor: null })).toMatchObject({ anchorKind: null })
    await comments.updateAnchor({
      threadId: thread.id,
      anchor: { kind: "element", value: { selector: "#b" }, version: "v2" }
    })
    expect(await comments.deleteThread({ threadId: thread.id })).toEqual({ threadId: thread.id })
    state = comments.store.getSnapshot()
    expect(state.threads[thread.id]).toBeUndefined()
    expect(ids(state)).not.toContain(thread.id)
    expect(state.counts[countKey("invoice", "inv-1")]).toMatchObject({ open: 0, total: 0 })
  })

  it("drops a thread whose last comment is deleted", async () => {
    const { comments } = browser()
    await comments.loadThreads(onInvoice)
    const { thread, comment } = await comments.createThread({ ...onInvoice, body: "Only" })
    expect(await comments.deleteComment({ commentId: comment.id })).toMatchObject({ threadDeleted: true })
    expect(comments.store.getSnapshot().threads[thread.id]).toBeUndefined()
    expect(ids(comments.store.getSnapshot())).toEqual([])
  })

  it("suggests mentions", async () => {
    const { comments } = browser()
    expect((await comments.suggestMentions({ ...onInvoice, query: "ada" })).map((user) => user.id)).toEqual(["ada"])
  })
})

describe("applyEvent", () => {
  it("applies live updates once, without duplicating what the client already has", async () => {
    const { api, as, identity, events, comments } = browser()
    await comments.loadThreads(onInvoice)
    await comments.loadCounts("invoice", ["inv-1"])
    const forBob = async (event: BetterAppsEvent | undefined) => {
      const client = await api.toClientEvent({ event: event as BetterAppsEvent, viewer: identity.actor("bob") })
      const json = JSON.stringify(client)
      return JSON.parse(json) as NonNullable<typeof client>
    }
    const { thread } = await api.createThread({ ...onInvoice, body: "From elsewhere" }, as("ada"))
    const created = await forBob(events("thread.created")[0])
    comments.applyEvent(created)
    comments.applyEvent(created)
    let state = comments.store.getSnapshot()
    expect(ids(state)).toEqual([thread.id])
    expect(state.threads[thread.id]?.createdAt).toBeInstanceOf(Date)
    expect(state.counts[countKey("invoice", "inv-1")]).toMatchObject({ open: 1, total: 1 })

    await comments.loadThread(thread.id)
    const reply = await comments.reply({ threadId: thread.id, body: "Mine" })
    comments.applyEvent(await forBob(events("comment.created").at(-1)))
    expect(
      comments.store.getSnapshot().threadComments[thread.id]?.ids.filter((id) => id === reply.comment.id)
    ).toHaveLength(1)

    await api.resolveThread({ threadId: thread.id }, as("ada"))
    comments.applyEvent(await forBob(events("thread.resolved")[0]))
    state = comments.store.getSnapshot()
    expect(state.threads[thread.id]?.status).toBe("resolved")
    expect(state.counts[countKey("invoice", "inv-1")]).toMatchObject({ open: 0, total: 1 })

    await api.deleteThread({ threadId: thread.id }, as("ada"))
    comments.applyEvent(await forBob(events("thread.deleted")[0]))
    state = comments.store.getSnapshot()
    expect(state.threads[thread.id]).toBeUndefined()
    expect(state.counts[countKey("invoice", "inv-1")]).toMatchObject({ open: 0, total: 0 })
  })
})

describe("createCommentsClient", () => {
  it("keeps one store per Better Apps client", () => {
    const { client, comments } = browser()
    expect(createCommentsClient(client)).toBe(comments)
    expect(createCommentsClient(createBetterAppsClient())).not.toBe(comments)
  })
})

describe("reset", () => {
  it("empties the store, so the next person loads their own threads", async () => {
    const { api, as, comments } = browser()
    const { thread } = await api.createThread({ ...onInvoice, body: "Private to Bob's view" }, as("bob"))
    await comments.loadThreads(onInvoice)
    await comments.loadThread(thread.id)
    expect(comments.store.getSnapshot().threads[thread.id]).toBeDefined()
    comments.reset()
    const state = comments.store.getSnapshot()
    expect(state.threads).toEqual({})
    expect(state.lists).toEqual({})
    expect(state.users).toEqual({})
  })

  it("cancels requests made before it and ignores their answers", async () => {
    const { api, as, comments } = browser()
    const { thread } = await api.createThread({ ...onInvoice, body: "Before the switch" }, as("bob"))
    const calls = [
      comments.loadThreads(onInvoice),
      comments.loadCounts("invoice", ["inv-1"]),
      comments.loadThread(thread.id),
      comments.createThread({ ...onInvoice, body: "Written before the switch" }),
      comments.createThread({ subjectType: "invoice", subjectId: "inv-locked", body: "Refused" })
    ]
    comments.reset()
    for (const call of calls) {
      await expect(call).rejects.toMatchObject({ code: "ABORTED" })
    }
    expect(comments.store.getSnapshot()).toEqual({
      threads: {},
      comments: {},
      threadComments: {},
      lists: {},
      counts: {},
      users: {},
      pending: {}
    })
  })

  it("never sends a write waiting on its headers as the next person", async () => {
    const { app, identity, api, as } = setup()
    let signedIn = (_userId: "ada" | "bob") => undefined as void
    const sent: string[] = []
    const client = createBetterAppsClient<typeof app>({
      baseURL: "https://app.test",
      headers: () => new Promise((resolve) => (signedIn = (userId) => resolve(identity.headers(userId)))),
      fetch: (url, init) => {
        sent.push(url)
        return app.handler(new Request(url, init))
      }
    })
    const comments = createCommentsClient(client)
    const writing = comments.createThread({ ...onInvoice, body: "Bob's draft" })
    comments.reset()
    signedIn("ada")
    await expect(writing).rejects.toMatchObject({ code: "ABORTED" })
    expect(sent).toEqual([])
    expect((await api.listThreads(onInvoice, as("ada"))).threads).toEqual([])
  })

  it("tells listeners, and drops mention searches it overtakes", async () => {
    const { comments } = browser()
    const heard: string[] = []
    const stop = comments.onReset(() => heard.push("reset"))
    const searching = comments.suggestMentions({ ...onInvoice, query: "ada" })
    comments.reset()
    expect(await searching).toEqual([])
    expect((await comments.suggestMentions({ ...onInvoice, query: "ada" })).map((user) => user.id)).toEqual(["ada"])
    stop()
    comments.reset()
    expect(heard).toEqual(["reset"])
  })
})

describe("dehydrate and hydrate", () => {
  it("carry a server render's loads to the browser as JSON", async () => {
    const { api, as, comments } = browser()
    const { thread } = await api.createThread({ ...onInvoice, body: "Prefetched" }, as("bob"))
    await comments.loadThreads(onInvoice)
    await comments.loadThread(thread.id)
    const json = JSON.stringify(comments.dehydrate())
    const snapshot = JSON.parse(json) as ReturnType<typeof comments.dehydrate>
    const fresh = createCommentsClient(createBetterAppsClient())
    fresh.hydrate(snapshot)
    const state = fresh.store.getSnapshot()
    expect(state.threads[thread.id]?.lastActivityAt).toBeInstanceOf(Date)
    expect(state.lists[listKey(onInvoice)]?.state).toBe("ready")
    expect(state.threadComments[thread.id]?.ids).toHaveLength(1)
    expect(Object.values(state.comments)[0]?.createdAt).toBeInstanceOf(Date)
  })

  it("carry only loaded counts", () => {
    const { comments } = browser()
    const ready = countKey("invoice", "inv-1")
    comments.store.setState((state) => ({
      ...state,
      counts: {
        [ready]: { open: 1, total: 2, state: "ready" },
        [countKey("invoice", "inv-2")]: { open: 0, total: 0, state: "loading" },
        [countKey("invoice", "inv-3")]: { open: 0, total: 0, state: "error" }
      }
    }))
    const snapshot = comments.dehydrate()
    expect(Object.keys(snapshot.counts)).toEqual([ready])
    const failed = { [countKey("invoice", "inv-4")]: { open: 0, total: 0, state: "error" as const } }
    const fresh = createCommentsClient(createBetterAppsClient())
    fresh.hydrate({ ...snapshot, counts: { ...snapshot.counts, ...failed } })
    expect(Object.keys(fresh.store.getSnapshot().counts)).toEqual([ready])
  })
})

describe("the browser client's types", () => {
  it("come from the app, and leave server-only actions out", () => {
    const { client } = browser()
    expectTypeOf(client.comments).toHaveProperty("createThread")
    expectTypeOf(client.comments).not.toHaveProperty("removeSubject")
    expectTypeOf(client.comments).not.toHaveProperty("toClientEvent")
    type Input = Parameters<typeof client.comments.createThread>[0]
    expectTypeOf<Input["subjectType"]>().toEqualTypeOf<"invoice" | "page">()
  })
})
