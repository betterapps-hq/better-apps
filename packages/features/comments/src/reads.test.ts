import { mentionToken } from "@better-apps/mentions"
import type { BetterAppsEvent } from "better-apps"
import { describe, expect, it } from "vite-plus/test"
import { expectCode, invoices, setup } from "../test/app.js"
import type { Comment, CommentThread } from "./index.js"

const onInvoice = { subjectType: "invoice", subjectId: "inv-1" } as const
const seed = { author: { type: "system", name: "Seed" } } as const
const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes))

describe("listThreads", () => {
  it("lists by activity or creation, newest first, a page at a time without skipping ties", async () => {
    const { api, as } = setup()
    const ids: string[] = []
    for (const minute of [1, 2, 2, 2, 3]) {
      ids.push(
        (await api.createThread({ ...onInvoice, body: `At ${minute}` }, { ...as("bob"), createdAt: at(minute) })).thread
          .id
      )
    }
    await api.reply({ threadId: ids[0] as string, body: "Bump" }, { ...as("bob"), createdAt: at(9) })
    const first = await api.listThreads({ ...onInvoice, limit: 2 }, as("bob"))
    expect(first.threads.map((thread: CommentThread) => thread.id)).toEqual([ids[0], ids[4]])
    expect(first.users).toMatchObject({ bob: { name: "Bob Babbage" } })
    const pages = [first]
    while (pages.at(-1)?.cursor) {
      pages.push(
        await api.listThreads({ ...onInvoice, limit: 2, cursor: pages.at(-1)?.cursor ?? undefined }, as("bob"))
      )
    }
    const tied = [ids[1], ids[2], ids[3]].sort().reverse()
    expect(pages.flatMap((page) => page.threads.map((thread: CommentThread) => thread.id))).toEqual([
      ids[0],
      ids[4],
      ...tied
    ])
    const created = await api.listThreads({ ...onInvoice, order: "created", limit: 1 }, as("bob"))
    expect(created.threads[0]?.id).toBe(ids[4])
  })

  it("filters by status, anchor kind and indexed additional fields", async () => {
    const { api, as } = setup()
    const plain = await api.createThread({ ...onInvoice, body: "Plain", fields: { priority: "high" } }, as("bob"))
    const anchored = await api.createThread(
      { ...onInvoice, body: "Pinned", anchor: { kind: "element", value: { selector: "#total" } } },
      as("bob")
    )
    await api.resolveThread({ threadId: anchored.thread.id }, as("bob"))
    const ids = async (input: object) =>
      (await api.listThreads({ ...onInvoice, ...input }, as("bob"))).threads.map((thread: CommentThread) => thread.id)
    expect(await ids({ status: "open" })).toEqual([plain.thread.id])
    expect(await ids({ anchorKind: "element" })).toEqual([anchored.thread.id])
    expect(await ids({ anchorKind: null })).toEqual([plain.thread.id])
    expect(await ids({ where: { priority: "high" } })).toEqual([plain.thread.id])
    await expectCode(api.listThreads({ ...onInvoice, where: { label: "x" } }, as("bob")), "INVALID_INPUT")
    await expectCode(api.listThreads({ ...onInvoice, cursor: "nope" }, as("bob")), "INVALID_INPUT")
  })

  it("refuses other organizations and asks signed-out readers to sign in", async () => {
    const { api, as, post } = setup()
    await expectCode(api.listThreads(onInvoice, as("gus")), "NOT_FOUND")
    expect((await post("listThreads", onInvoice)).status).toBe(401)
    expect((await api.listThreads(onInvoice)).threads).toEqual([])
  })
})

describe("getThread", () => {
  it("returns comments oldest first, a page at a time, with the users they name", async () => {
    const { api, as } = setup()
    const { thread } = await api.createThread({ ...onInvoice, body: "One" }, { ...as("bob"), createdAt: at(1) })
    await api.reply({ threadId: thread.id, body: `Two ${mentionToken("sam")}` }, { ...as("ada"), createdAt: at(2) })
    await api.reply({ threadId: thread.id, body: "Three" }, { ...as("bob"), createdAt: at(3) })
    const first = await api.getThread({ threadId: thread.id, limit: 2 }, as("bob"))
    expect(first.comments.map((comment: Comment) => comment.body)).toEqual(["One", `Two ${mentionToken("sam")}`])
    expect(Object.keys(first.users).sort()).toEqual(["ada", "bob", "sam"])
    const second = await api.getThread({ threadId: thread.id, limit: 2, cursor: first.cursor ?? undefined }, as("bob"))
    expect(second.comments.map((comment: Comment) => comment.body)).toEqual(["Three"])
    expect(second.cursor).toBeNull()
    await expectCode(api.getThread({ threadId: "missing" }, as("bob")), "NOT_FOUND")
  })

  it("gives signed-out readers of public subjects text with names, and no user ids", async () => {
    const { api, as, post } = setup()
    const onPage = { subjectType: "page", subjectId: "/pricing" } as const
    const { thread } = await api.createThread({ ...onPage, body: `Typo here, ${mentionToken("ada")}` }, as("bob"))
    await api.createThread({ ...onPage, body: "Bot note" }, { author: { type: "system", name: "Checker" } })
    const response = await post("getThread", { threadId: thread.id })
    expect(response.status).toBe(200)
    const read = (await response.json()) as { thread: CommentThread; comments: Comment[]; users: object }
    expect(read.thread.createdBy).toBe("")
    expect(read.users).toEqual({})
    expect(read.comments[0]).toMatchObject({
      authorId: "",
      authorName: "Bob Babbage",
      body: null,
      bodyText: "Typo here, @Ada Lovelace"
    })
    const list = (await (await post("listThreads", onPage)).json()) as { threads: CommentThread[] }
    expect(list.threads.map((entry) => entry.createdBy)).toEqual(["", ""])
    expect((await post("createThread", { ...onPage, body: "Hi" })).status).toBe(401)
  })
})

describe("countThreads", () => {
  it("counts open and total threads per subject in the visibilities the caller can see", async () => {
    const { api, as, post } = setup()
    await api.createThread({ ...onInvoice, body: "a" }, as("bob"))
    const resolved = await api.createThread({ ...onInvoice, body: "b" }, as("bob"))
    await api.resolveThread({ threadId: resolved.thread.id }, as("bob"))
    await api.createThread({ ...onInvoice, visibility: "staff", body: "c" }, as("sam"))
    await api.createThread({ subjectType: "invoice", subjectId: "inv-2", body: "d" }, as("bob"))
    await api.createThread({ subjectType: "invoice", subjectId: "inv-globex", body: "e" }, as("gus"))
    const subjectIds = ["inv-1", "inv-2", "inv-locked", "inv-globex", "inv-1"]
    expect(await api.countThreads({ subjectType: "invoice", subjectIds }, as("bob"))).toEqual({
      "inv-1": { open: 1, total: 2 },
      "inv-2": { open: 1, total: 1 },
      "inv-locked": { open: 0, total: 0 }
    })
    expect(await api.countThreads({ subjectType: "invoice", subjectIds, status: "open" }, as("sam"))).toMatchObject({
      "inv-1": { open: 2, total: 2 }
    })
    expect(await api.countThreads({ subjectType: "invoice", subjectIds: ["inv-1", "inv-globex"] })).toEqual({
      "inv-1": { open: 2, total: 3 },
      "inv-globex": { open: 1, total: 1 }
    })
    expect(await api.countThreads({ subjectType: "invoice", subjectIds: ["inv-globex"] }, as("bob"))).toEqual({})
    expect((await post("countThreads", { subjectType: "invoice", subjectIds })).status).toBe(401)
    const page = await post("countThreads", { subjectType: "page", subjectIds: ["/home"] })
    expect(await page.json()).toEqual({ "/home": { open: 0, total: 0 } })
  })
})

describe("suggestMentions", () => {
  it("suggests users who can view the thread", async () => {
    const { api, as } = setup()
    const { thread } = await api.createThread({ ...onInvoice, body: "Hi" }, as("bob"))
    const names = (users: { id: string }[]) => users.map((user) => user.id).sort()
    expect(names(await api.suggestMentions({ threadId: thread.id, query: "" }, as("bob")))).toEqual([
      "ada",
      "bob",
      "sam"
    ])
    expect(names(await api.suggestMentions({ ...onInvoice, query: "ada" }, as("bob")))).toEqual(["ada"])
    const staff = await api.createThread({ ...onInvoice, visibility: "staff", body: "Hi" }, as("sam"))
    expect(names(await api.suggestMentions({ threadId: staff.thread.id, query: "" }, as("sam")))).toEqual([
      "ada",
      "sam"
    ])
    await expectCode(
      api.suggestMentions({ subjectType: "invoice", subjectId: "inv-locked", query: "" }, as("bob")),
      "FORBIDDEN"
    )
  })
})

describe("canViewThread", () => {
  it("applies the one rule other features use for recipients", async () => {
    const { api, as, identity } = setup()
    const { thread } = await api.createThread({ ...onInvoice, visibility: "staff", body: "Hi" }, as("sam"))
    const page = await api.createThread({ subjectType: "page", subjectId: "/home", body: "Hi" }, as("bob"))
    expect(await api.canViewThread({ actor: identity.actor("ada"), threadId: thread.id })).toBe(true)
    expect(await api.canViewThread({ actor: identity.actor("bob"), thread })).toBe(false)
    expect(await api.canViewThread({ actor: identity.actor("gus"), threadId: thread.id })).toBe(false)
    expect(await api.canViewThread({ actor: null, threadId: thread.id })).toBe(false)
    expect(await api.canViewThread({ actor: null, threadId: page.thread.id })).toBe(true)
    expect(await api.canViewThread({ actor: null, threadId: "missing" })).toBe(false)
    expect(await api.canViewThread({ actor: null, thread: { ...thread, subjectType: "gone" } })).toBe(false)
  })
})

describe("toClientEvent", () => {
  it("passes events to viewers who can see the thread, without previous bodies", async () => {
    const { api, as, identity, events } = setup()
    const { thread, comment } = await api.createThread({ ...onInvoice, body: `Hi ${mentionToken("ada")}` }, as("bob"))
    await api.editComment({ commentId: comment.id, body: "Edited" }, as("bob"))
    const forViewer = async (event: BetterAppsEvent | undefined, viewer: "ada" | "bob" | "gus" | null) =>
      api.toClientEvent({ event: event as BetterAppsEvent, viewer: viewer ? identity.actor(viewer) : null })
    const edited = await forViewer(events("comment.edited")[0], "ada")
    expect(edited).toEqual({
      id: events("comment.edited")[0]?.id,
      type: "comment.edited",
      thread: expect.objectContaining({ id: thread.id }),
      comment: expect.objectContaining({ body: "Edited" })
    })
    expect(edited).not.toHaveProperty("previousBody")
    expect(await forViewer(events("comment.created")[0], "gus")).toBeNull()
    expect(await forViewer(events("comment.created")[0], null)).toBeNull()
    expect(await forViewer(events("comment.mentioned")[0], "ada")).toMatchObject({ type: "comment.mentioned" })
    expect(await forViewer(events("comment.mentioned")[0], "bob")).toBeNull()
    await api.resolveThread({ threadId: thread.id }, as("bob"))
    expect(await forViewer(events("thread.resolved")[0], "bob")).toEqual({
      id: events("thread.resolved")[0]?.id,
      type: "thread.resolved",
      thread: expect.objectContaining({ status: "resolved" })
    })
    await api.removeUser({ userId: "nobody" })
    expect(await forViewer(events("user.removed")[0], "ada")).toBeNull()
    const other = { ...(events("comment.created")[0] as BetterAppsEvent), feature: "reactions" }
    expect(await forViewer(other, "ada")).toBeNull()
    const unknown = events("comment.created")[0] as BetterAppsEvent<{ thread: CommentThread }>
    expect(
      await forViewer({ ...unknown, data: { ...unknown.data, thread: { ...thread, subjectType: "gone" } } }, "ada")
    ).toBeNull()
  })

  it("gives signed-out viewers of public subjects the public shape", async () => {
    const { api, as, events } = setup()
    await api.createThread({ subjectType: "page", subjectId: "/home", body: `Hi ${mentionToken("ada")}` }, as("bob"))
    const event = await api.toClientEvent({ event: events("comment.created")[0] as BetterAppsEvent, viewer: null })
    expect(event).toMatchObject({
      thread: { createdBy: "" },
      comment: { authorId: "", authorName: "Bob Babbage", body: null, bodyText: "Hi @Ada Lovelace" }
    })
  })
})

describe("upkeep", () => {
  it("removes a record's threads in steps, then reports the record removed", async () => {
    const { api, as, events, database } = setup()
    for (let index = 0; index < 51; index += 1) {
      await api.createThread({ subjectType: "invoice", subjectId: "inv-2", body: `#${index}` }, seed)
    }
    await api.createThread({ ...onInvoice, body: "Stays" }, as("bob"))
    expect(await api.removeSubject({ subjectType: "invoice", subjectId: "inv-2" })).toEqual({ done: false })
    expect(events("subject.removed")).toHaveLength(0)
    expect(await api.removeSubject({ subjectType: "invoice", subjectId: "inv-2" })).toEqual({ done: true })
    expect(events("subject.removed")[0]?.data).toEqual({ subjectType: "invoice", subjectId: "inv-2" })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM "commentThread"').get()).toEqual({ count: 1 })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM "comment"').get()).toEqual({ count: 1 })
    expect(await api.removeSubject({ subjectType: "invoice", subjectId: "inv-2" })).toEqual({ done: true })
  })

  it("moves a record's threads and comments to another organization", async () => {
    const { api, as, events, database } = setup()
    const { thread } = await api.createThread({ ...onInvoice, body: "Moving" }, as("bob"))
    expect(await api.moveSubject({ ...onInvoice, toOrgId: "globex" })).toEqual({ done: true })
    expect(events("subject.moved")[0]?.data).toEqual({ ...onInvoice, toOrgId: "globex" })
    const orgs = database.sqlite
      .prepare('SELECT "orgId" FROM "comment" UNION SELECT "orgId" FROM "commentThread"')
      .all()
    expect(orgs).toEqual([{ orgId: "globex" }])
    // Until the app moves its own record, the thread is out of everyone's sight.
    await expectCode(api.getThread({ threadId: thread.id }, as("bob")), "NOT_FOUND")
    invoices.set("inv-1", { orgId: "globex" })
    try {
      expect((await api.getThread({ threadId: thread.id }, as("gus"))).comments).toHaveLength(1)
    } finally {
      invoices.set("inv-1", { orgId: "acme" })
    }
    expect(await api.moveSubject({ ...onInvoice, toOrgId: null })).toEqual({ done: true })
  })

  it("clears a removed user's comments, keeping the threads' shape", async () => {
    const { api, as, events } = setup()
    const { thread } = await api.createThread({ ...onInvoice, body: "By Bob" }, as("bob"))
    await api.reply({ threadId: thread.id, body: "By Ada" }, as("ada"))
    expect(await api.removeUser({ userId: "bob" })).toEqual({ done: true })
    const { comments, thread: after } = await api.getThread({ threadId: thread.id }, as("ada"))
    expect(comments.map((comment: Comment) => [comment.body, comment.bodyText])).toEqual([
      [null, ""],
      ["By Ada", "By Ada"]
    ])
    expect(after.commentCount).toBe(2)
    expect(events("user.removed")[0]?.data).toEqual({ userId: "bob" })
  })

  it("recounts threads changed outside comments", async () => {
    const { api, as, database } = setup()
    const { thread } = await api.createThread({ ...onInvoice, body: "One" }, { ...as("bob"), createdAt: at(1) })
    const second = await api.reply({ threadId: thread.id, body: "Two" }, { ...as("bob"), createdAt: at(5) })
    await api.deleteComment({ commentId: second.comment.id }, as("bob"))
    database.sqlite.prepare('UPDATE "commentThread" SET "commentCount" = 9, "lastActivityAt" = 0').run()
    expect(await api.recountThreads({ threadIds: [thread.id] })).toEqual({ done: true, cursor: null })
    expect((await api.getThread({ threadId: thread.id }, as("bob"))).thread).toMatchObject({
      commentCount: 1,
      lastActivityAt: at(5)
    })
    database.sqlite.prepare('UPDATE "commentThread" SET "commentCount" = 9').run()
    expect(await api.recountThreads(onInvoice)).toEqual({ done: true, cursor: null })
    expect((await api.getThread({ threadId: thread.id }, as("bob"))).thread.commentCount).toBe(1)
    expect(await api.recountThreads({ subjectType: "invoice", subjectId: "inv-2" })).toEqual({
      done: true,
      cursor: null
    })
  })

  it("is only reachable from server code", async () => {
    const { post } = setup()
    expect((await post("removeSubject", onInvoice, "ada")).status).toBe(404)
    expect((await post("canViewThread", { actor: null, threadId: "x" }, "ada")).status).toBe(404)
  })
})
