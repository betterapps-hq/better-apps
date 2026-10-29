import { describe, expect, it } from "vitest"
import { expectCode, setup } from "../test/app.js"
import { mentionToken, ulid, type Comment, type CommentThread } from "./index.js"

const onInvoice = { subjectType: "invoice", subjectId: "inv-1" } as const

describe("createThread", () => {
  it("writes the thread and its first comment in one batch, with events", async () => {
    const { api, as, events, database } = setup()
    const { thread, comment, droppedMentions } = await api.createThread(
      { ...onInvoice, body: "  Is this total right?\r\n" },
      as("bob")
    )
    expect(thread).toMatchObject({
      orgId: "acme",
      subjectType: "invoice",
      subjectId: "inv-1",
      visibility: "default",
      anchorKind: null,
      anchor: null,
      status: "open",
      createdBy: "bob",
      commentCount: 1,
      metadata: null,
      priority: null
    })
    expect(thread.lastActivityAt).toEqual(thread.createdAt)
    expect(comment).toMatchObject({
      threadId: thread.id,
      orgId: "acme",
      authorType: "user",
      authorId: "bob",
      authorName: null,
      format: "text",
      body: "Is this total right?",
      bodyText: "Is this total right?",
      deletedAt: null
    })
    expect(droppedMentions).toEqual([])
    expect(events().map((event) => event.type)).toEqual(["thread.created", "comment.created"])
    expect(events("thread.created")[0]?.data).toEqual({
      subjectType: "invoice",
      subjectId: "inv-1",
      orgId: "acme",
      thread: expect.objectContaining({ id: thread.id }),
      comment: expect.objectContaining({ id: comment.id })
    })
    const rows = database.sqlite.prepare('SELECT "subjectId", "commentCount" FROM "commentThread"').all()
    expect(rows).toEqual([{ subjectId: "inv-1", commentCount: 1 }])
  })

  it("returns what the first attempt wrote when a retry repeats the ids", async () => {
    const { api, as, events } = setup()
    const ids = { id: ulid(), commentId: ulid() }
    const first = await api.createThread({ ...onInvoice, ...ids, body: "Hi" }, as("bob"))
    const again = await api.createThread({ ...onInvoice, ...ids, body: "Hi" }, as("bob"))
    expect(again.thread).toEqual(first.thread)
    expect(again.comment).toEqual(first.comment)
    expect(events("thread.created")).toHaveLength(1)

    await expectCode(api.createThread({ ...onInvoice, ...ids, body: "Changed" }, as("bob")), "CONFLICT")
    await expectCode(api.createThread({ ...onInvoice, ...ids, body: "Hi" }, as("ada")), "INVALID_INPUT")
    await expectCode(
      api.createThread({ subjectType: "invoice", subjectId: "inv-2", ...ids, body: "Hi" }, as("bob")),
      "INVALID_INPUT"
    )
    await expectCode(
      api.createThread({ ...onInvoice, id: ulid(), commentId: ids.commentId, body: "Hi" }, as("bob")),
      "INVALID_INPUT"
    )
  })

  it("refuses malformed ids, unknown subject types and visibilities, and empty bodies", async () => {
    const { post, api, as } = setup()
    const response = await post("createThread", { ...onInvoice, id: "not-a-ulid", body: "Hi" }, "bob")
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } })
    await expectCode(
      api.createThread({ subjectType: "order", subjectId: "o1", body: "Hi" } as never, as("bob")),
      "INVALID_INPUT"
    )
    await expectCode(api.createThread({ ...onInvoice, visibility: "secret" } as never, as("bob")), "INVALID_INPUT")
    await expectCode(api.createThread({ ...onInvoice, body: " " }, as("bob")), "INVALID_INPUT")
    await expectCode(
      api.createThread({ ...onInvoice, format: "markdown", body: "x" } as never, as("bob")),
      "INVALID_INPUT"
    )
  })

  it("checks anchors, metadata and additional fields", async () => {
    const { api, as, post } = setup()
    const anchored = await api.createThread(
      {
        ...onInvoice,
        body: "This line",
        anchor: { kind: "element", value: { selector: "[data-line='3']" }, version: "rev-7" },
        fields: { priority: "high" }
      },
      as("bob")
    )
    expect(anchored.thread).toMatchObject({
      anchorKind: "element",
      anchor: { selector: "[data-line='3']" },
      anchorVersion: "rev-7",
      priority: "high"
    })
    await expectCode(
      api.createThread(
        { ...onInvoice, body: "x", anchor: { kind: "element", value: { selector: ".total" } } },
        as("bob")
      ),
      "INVALID_INPUT"
    )
    await expectCode(
      api.createThread({ ...onInvoice, body: "x", anchor: { kind: "region", value: {} } } as never, as("bob")),
      "INVALID_INPUT"
    )
    await expectCode(
      api.createThread({ ...onInvoice, body: "x", fields: { priority: "urgent" } } as never, as("bob")),
      "INVALID_INPUT"
    )
    await expectCode(
      api.createThread({ ...onInvoice, body: "x", fields: { colour: "red" } } as never, as("bob")),
      "INVALID_INPUT"
    )
    const refused = await post("createThread", { ...onInvoice, body: "x", metadata: { a: 1 } }, "bob")
    expect(refused.status).toBe(403)
    const big = await api.createThread({ ...onInvoice, body: "x", metadata: { note: "from server" } }, as("bob"))
    expect(big.thread.metadata).toEqual({ note: "from server" })
    await expectCode(
      api.createThread({ ...onInvoice, body: "x", metadata: { note: "x".repeat(5000) } }, as("bob")),
      "LIMIT_EXCEEDED"
    )
    await expectCode(api.createThread({ ...onInvoice, body: "x".repeat(17 * 1024) }, as("bob")), "LIMIT_EXCEEDED")
  })

  it("lets server code write as an external or system author, at the original time, silently", async () => {
    const { api, events } = setup()
    const createdAt = new Date("2025-02-03T04:05:06.000Z")
    const { thread, comment } = await api.createThread(
      { ...onInvoice, body: "Paid by bank transfer", commentFields: { source: "email" } },
      { author: { type: "external", name: "Grace Hopper", id: "grace@example.test" }, createdAt, silent: true }
    )
    expect(thread).toMatchObject({ createdBy: "grace@example.test", createdAt, lastActivityAt: createdAt })
    expect(comment).toMatchObject({
      authorType: "external",
      authorId: "grace@example.test",
      authorName: "Grace Hopper",
      createdAt,
      source: "email"
    })
    expect(events("comment.created")[0]).toMatchObject({ silent: true, author: { type: "external" } })
    const bot = await api.createThread(
      { ...onInvoice, body: "Reminder sent" },
      { author: { type: "system", name: "Billing bot" } }
    )
    expect(bot.comment).toMatchObject({ authorType: "system", authorId: "", authorName: "Billing bot" })
  })
})

describe("access", () => {
  it("hides other organizations' threads and refuses signed-out writes", async () => {
    const { api, as, post } = setup()
    const { thread } = await api.createThread({ ...onInvoice, body: "Hi" }, as("bob"))
    await expectCode(api.getThread({ threadId: thread.id }, as("gus")), "NOT_FOUND")
    await expectCode(api.reply({ threadId: thread.id, body: "Hi" }, as("gus")), "NOT_FOUND")
    await expectCode(api.createThread({ ...onInvoice, body: "Hi" }, as("gus")), "NOT_FOUND")
    const signedOut = await post("reply", { threadId: thread.id, body: "Hi" })
    expect(signedOut.status).toBe(401)
    expect(await signedOut.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } })
    const read = await post("getThread", { threadId: thread.id })
    expect(read.status).toBe(401)
  })

  it("lets viewers who can't comment read but not write, such as on a locked invoice", async () => {
    const { api, as } = setup()
    const { thread } = await api.createThread(
      { subjectType: "invoice", subjectId: "inv-locked", body: "Before the lock" },
      { author: { type: "system", name: "Seed" } }
    )
    expect((await api.getThread({ threadId: thread.id }, as("bob"))).comments).toHaveLength(1)
    await expectCode(api.reply({ threadId: thread.id, body: "Hi" }, as("bob")), "FORBIDDEN")
    await expectCode(
      api.createThread({ subjectType: "invoice", subjectId: "inv-locked", body: "Hi" }, as("bob")),
      "FORBIDDEN"
    )
    await expectCode(api.resolveThread({ threadId: thread.id }, as("bob")), "FORBIDDEN")
  })

  it("keeps staff threads from users who can't see them, everywhere", async () => {
    const { api, as } = setup()
    const staff = await api.createThread({ ...onInvoice, visibility: "staff", body: "Internal note" }, as("sam"))
    await api.createThread({ ...onInvoice, body: "Public note" }, as("bob"))
    await expectCode(api.getThread({ threadId: staff.thread.id }, as("bob")), "NOT_FOUND")
    await expectCode(api.createThread({ ...onInvoice, visibility: "staff", body: "x" }, as("bob")), "NOT_FOUND")
    expect((await api.listThreads(onInvoice, as("bob"))).threads).toHaveLength(1)
    expect((await api.listThreads(onInvoice, as("ada"))).threads).toHaveLength(2)
    expect(await api.countThreads({ subjectType: "invoice", subjectIds: ["inv-1"] }, as("bob"))).toEqual({
      "inv-1": { open: 1, total: 1 }
    })
  })

  it("needs getOrgId when the identity reports organizations", async () => {
    const { api, as } = setup({
      subjects: { invoice: { canView: () => true, canComment: () => true } }
    })
    await expect(api.createThread({ ...onInvoice, body: "Hi" }, as("bob"))).rejects.toThrow(
      'The "invoice" subject type needs getOrgId, because the identity adapter reports organizations.'
    )
  })
})

describe("reply", () => {
  it("adds a comment, counts it and moves the thread's activity forward", async () => {
    const { api, as, events } = setup()
    const { thread } = await api.createThread({ ...onInvoice, body: "First" }, as("bob"))
    const later = new Date(thread.createdAt.getTime() + 60_000)
    const { comment, thread: updated } = await api.reply(
      { threadId: thread.id, body: "Second" },
      { ...as("ada"), createdAt: later }
    )
    expect(comment).toMatchObject({ threadId: thread.id, authorId: "ada", body: "Second", createdAt: later })
    expect(updated).toMatchObject({ commentCount: 2, lastActivityAt: later })
    const earlier = new Date(thread.createdAt.getTime() - 60_000)
    const imported = await api.reply({ threadId: thread.id, body: "Imported" }, { ...as("ada"), createdAt: earlier })
    expect(imported.thread).toMatchObject({ commentCount: 3, lastActivityAt: later })
    expect(events("comment.created")).toHaveLength(3)
  })

  it("returns the first attempt's comment on a retry and refuses reused ids", async () => {
    const { api, as } = setup()
    const { thread } = await api.createThread({ ...onInvoice, body: "First" }, as("bob"))
    const id = ulid()
    const first = await api.reply({ id, threadId: thread.id, body: "Again" }, as("bob"))
    const again = await api.reply({ id, threadId: thread.id, body: "Again" }, as("bob"))
    expect(again.comment).toEqual(first.comment)
    expect(again.thread.commentCount).toBe(2)
    await expectCode(api.reply({ id, threadId: thread.id, body: "Different" }, as("bob")), "CONFLICT")
    await expectCode(api.reply({ id, threadId: thread.id, body: "Again" }, as("ada")), "INVALID_INPUT")
  })

  it("reopens a resolved thread, through the reopen hook", async () => {
    let allowReopen = true
    const { api, as, events } = setup({
      hooks: {
        before: {
          reopenThread: ({ input }) => {
            if (!allowReopen) {
              throw new Error("Closed for good")
            }
            return input
          }
        }
      }
    })
    const { thread } = await api.createThread({ ...onInvoice, body: "First" }, as("bob"))
    await api.resolveThread({ threadId: thread.id }, as("bob"))
    const { thread: reopened } = await api.reply({ threadId: thread.id, body: "Not done" }, as("ada"))
    expect(reopened).toMatchObject({ status: "open", resolvedAt: null, resolvedBy: null })
    expect(events("thread.reopened")).toHaveLength(1)
    await api.resolveThread({ threadId: thread.id }, as("bob"))
    allowReopen = false
    await expectCode(api.reply({ threadId: thread.id, body: "Again" }, as("ada")), "REJECTED_BY_HOOK")
    expect((await api.getThread({ threadId: thread.id }, as("bob"))).thread.status).toBe("resolved")
  })
})

describe("mentions", () => {
  it("notifies mentioned users who can view the thread, and tells only moderators who was dropped", async () => {
    const { api, as, events } = setup()
    const body = `${mentionToken("ada")} ${mentionToken("gus")} ${mentionToken("bob")} ${mentionToken("nobody")}`
    const byBob = await api.createThread({ ...onInvoice, body }, as("bob"))
    expect(events("comment.mentioned").map((event) => (event.data as { userId: string }).userId)).toEqual(["ada"])
    expect(byBob.droppedMentions).toEqual([])
    const byAda = await api.reply({ threadId: byBob.thread.id, body }, as("ada"))
    expect(byAda.droppedMentions).toEqual(["gus", "nobody"])
  })

  it("checks staff threads' visibility for mentions, and caps them at 20", async () => {
    const { api, as, events } = setup()
    await api.createThread(
      { ...onInvoice, visibility: "staff", body: `${mentionToken("bob")} ${mentionToken("ada")}` },
      as("sam")
    )
    expect(events("comment.mentioned").map((event) => (event.data as { userId: string }).userId)).toEqual(["ada"])
    const many = Array.from({ length: 21 }, (_, index) => mentionToken(`user-${index}`)).join(" ")
    await expectCode(api.createThread({ ...onInvoice, body: many }, as("bob")), "LIMIT_EXCEEDED")
  })

  it("uses canMention when the subject type has it", async () => {
    const { api, as, events } = setup({
      subjects: {
        invoice: {
          getOrgId: () => "acme",
          canView: () => true,
          canComment: () => true,
          canMention: ({ actor }) => actor.userId === "sam"
        }
      }
    })
    await api.createThread({ ...onInvoice, body: `${mentionToken("ada")} ${mentionToken("sam")}` }, as("bob"))
    expect(events("comment.mentioned").map((event) => (event.data as { userId: string }).userId)).toEqual(["sam"])
  })
})

describe("editComment", () => {
  it("replaces the body, keeps the previous one in the event and mentions only new people", async () => {
    const { api, as, events } = setup()
    const { comment } = await api.createThread({ ...onInvoice, body: `Hi ${mentionToken("ada")}` }, as("bob"))
    const { comment: edited } = await api.editComment(
      { commentId: comment.id, body: `Hi ${mentionToken("ada")} and ${mentionToken("sam")}` },
      as("bob")
    )
    expect(edited.editedAt).toBeInstanceOf(Date)
    expect(edited.bodyText).toBe("Hi @[user:ada] and @[user:sam]")
    expect(events("comment.edited")[0]?.data).toMatchObject({ previousFormat: "text", previousBody: "Hi @[user:ada]" })
    expect(events("comment.mentioned").map((event) => (event.data as { userId: string }).userId)).toEqual([
      "ada",
      "sam"
    ])
    const same = await api.editComment({ commentId: comment.id, body: edited.body as string }, as("bob"))
    expect(same.comment).toEqual(edited)
    expect(events("comment.edited")).toHaveLength(1)
  })

  it("is only for the comment's author, while they can still comment", async () => {
    const { api, as } = setup()
    const { comment } = await api.createThread({ ...onInvoice, body: "Mine" }, as("bob"))
    const refused = await expectCode(api.editComment({ commentId: comment.id, body: "Theirs" }, as("ada")), "FORBIDDEN")
    expect(refused.status).toBe(403)
    await expectCode(api.editComment({ commentId: "missing", body: "x" }, as("bob")), "NOT_FOUND")
    await api.deleteComment({ commentId: comment.id }, as("bob"))
    await expectCode(api.editComment({ commentId: comment.id, body: "x" }, as("bob")), "NOT_FOUND")
  })
})

describe("deleteComment", () => {
  it("clears the text, keeps the place and drops the count", async () => {
    const { api, as, events } = setup()
    const { thread, comment } = await api.createThread({ ...onInvoice, body: "First" }, as("bob"))
    await api.reply({ threadId: thread.id, body: "Second" }, as("ada"))
    const deleted = await api.deleteComment({ commentId: comment.id }, as("bob"))
    expect(deleted).toMatchObject({ threadDeleted: false, comment: { body: null, bodyText: "" } })
    const { thread: after, comments } = await api.getThread({ threadId: thread.id }, as("bob"))
    expect(after.commentCount).toBe(1)
    expect(comments.map((entry: Comment) => entry.bodyText)).toEqual(["", "Second"])
    expect(events("comment.deleted")[0]?.data).toMatchObject({ previousBody: "First", previousText: "First" })
    expect(await api.deleteComment({ commentId: comment.id }, as("bob"))).toMatchObject({ threadDeleted: false })
    expect(events("comment.deleted")).toHaveLength(1)
  })

  it("deletes the thread with its last comment", async () => {
    const { api, as, events, database } = setup()
    const { thread, comment } = await api.createThread({ ...onInvoice, body: "Only" }, as("bob"))
    expect(await api.deleteComment({ commentId: comment.id }, as("bob"))).toMatchObject({ threadDeleted: true })
    await expectCode(api.getThread({ threadId: thread.id }, as("bob")), "NOT_FOUND")
    expect(events("thread.deleted")).toHaveLength(1)
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM "comment"').get()).toEqual({ count: 0 })
  })

  it("lets moderators delete anyone's comment, and nobody else", async () => {
    const { api, as } = setup()
    const { thread, comment } = await api.createThread({ ...onInvoice, body: "Mine" }, as("bob"))
    await api.reply({ threadId: thread.id, body: "Keep the thread" }, as("bob"))
    await expectCode(api.deleteComment({ commentId: comment.id }, as("sam")), "FORBIDDEN")
    expect((await api.deleteComment({ commentId: comment.id }, as("ada"))).comment.deletedAt).toBeInstanceOf(Date)
  })
})

describe("thread actions", () => {
  it("resolves and reopens once each, recording who resolved", async () => {
    const { api, as, events } = setup()
    const { thread } = await api.createThread({ ...onInvoice, body: "Fix" }, as("bob"))
    const resolved = await api.resolveThread({ threadId: thread.id }, as("ada"))
    expect(resolved).toMatchObject({ status: "resolved", resolvedBy: "ada" })
    expect(await api.resolveThread({ threadId: thread.id }, as("ada"))).toEqual(resolved)
    const reopened = await api.reopenThread({ threadId: thread.id }, as("bob"))
    expect(reopened).toMatchObject({ status: "open", resolvedAt: null, resolvedBy: null })
    expect(events().map((event) => event.type)).toEqual([
      "thread.created",
      "comment.created",
      "thread.resolved",
      "thread.reopened"
    ])
  })

  it("lets the creator or a moderator update a thread, and only moderators change its visibility", async () => {
    const { api, as, events, post } = setup()
    const { thread } = await api.createThread({ ...onInvoice, body: "Fix" }, as("bob"))
    const updated = await api.updateThread(
      { threadId: thread.id, fields: { priority: "high", label: "tax" } },
      as("bob")
    )
    expect(updated).toMatchObject({ priority: "high", label: "tax" })
    expect(events("thread.updated")[0]?.data).toMatchObject({ previous: { priority: null, label: null } })
    expect(await api.updateThread({ threadId: thread.id, fields: { priority: "high" } }, as("bob"))).toEqual(updated)
    await expectCode(api.updateThread({ threadId: thread.id, visibility: "staff" }, as("bob")), "FORBIDDEN")
    await expectCode(api.updateThread({ threadId: thread.id, fields: { label: "x" } }, as("sam")), "FORBIDDEN")
    expect((await post("updateThread", { threadId: thread.id, metadata: { a: 1 } }, "bob")).status).toBe(403)
    await expectCode(
      api.updateThread({ threadId: thread.id, visibility: "secret" } as never, as("ada")),
      "INVALID_INPUT"
    )
    expect(await api.updateThread({ threadId: thread.id, visibility: "staff" }, as("ada"))).toMatchObject({
      visibility: "staff"
    })
    expect(await api.updateThread({ threadId: thread.id, metadata: { reviewed: true } }, as("ada"))).toMatchObject({
      metadata: { reviewed: true }
    })
    expect(await api.updateThread({ threadId: thread.id, metadata: null }, as("ada"))).toMatchObject({ metadata: null })
    // Moved to staff, the thread is out of its creator's sight.
    await expectCode(api.getThread({ threadId: thread.id }, as("bob")), "NOT_FOUND")
  })

  it("lets clients write metadata a subject type's schema allows", async () => {
    const { post } = setup({
      subjects: {
        invoice: {
          getOrgId: () => "acme",
          canView: () => true,
          canComment: () => true,
          metadata: {
            "~standard": {
              version: 1,
              vendor: "test",
              validate: (value) =>
                typeof (value as { color?: unknown }).color === "string"
                  ? { value: value as Record<string, unknown> }
                  : { issues: [{ message: "Needs a color." }] }
            }
          }
        }
      }
    })
    const created = await post("createThread", { ...onInvoice, body: "x", metadata: { color: "red" } }, "bob")
    const { thread } = (await created.json()) as { thread: CommentThread }
    expect(thread.metadata).toEqual({ color: "red" })
    const refused = await post("updateThread", { threadId: thread.id, metadata: { size: 1 } }, "bob")
    expect(await refused.json()).toMatchObject({ error: { code: "INVALID_INPUT" } })
  })

  it("moves anchors for the creator or a moderator, reporting the previous one", async () => {
    const { api, as, events } = setup()
    const anchor = { kind: "element", value: { selector: "#total" }, version: "v1" } as const
    const { thread } = await api.createThread({ ...onInvoice, body: "Here", anchor }, as("bob"))
    await expectCode(api.updateAnchor({ threadId: thread.id, anchor: null }, as("sam")), "FORBIDDEN")
    const moved = await api.updateAnchor(
      { threadId: thread.id, anchor: { kind: "element", value: { selector: "#subtotal" }, version: "v2" } },
      as("bob")
    )
    expect(moved).toMatchObject({ anchor: { selector: "#subtotal" }, anchorVersion: "v2" })
    expect(events("thread.anchorUpdated")[0]?.data).toMatchObject({
      previousAnchor: { kind: "element", value: { selector: "#total" }, version: "v1" }
    })
    const whole = await api.updateAnchor({ threadId: thread.id, anchor: null }, as("ada"))
    expect(whole).toMatchObject({ anchorKind: null, anchor: null, anchorVersion: null })
    await api.updateAnchor({ threadId: thread.id, anchor }, as("ada"))
    expect(events("thread.anchorUpdated")[2]?.data).toMatchObject({ previousAnchor: null })
  })

  it("lets only moderators delete a thread, with all its comments", async () => {
    const { api, as, events, database } = setup()
    const { thread } = await api.createThread({ ...onInvoice, body: "One" }, as("bob"))
    await api.reply({ threadId: thread.id, body: "Two" }, as("bob"))
    await expectCode(api.deleteThread({ threadId: thread.id }, as("bob")), "FORBIDDEN")
    expect(await api.deleteThread({ threadId: thread.id }, as("ada"))).toEqual({ threadId: thread.id })
    expect(events("thread.deleted")).toHaveLength(1)
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM "comment"').get()).toEqual({ count: 0 })
  })
})

describe("before hooks", () => {
  it("can change the input but not the subject, and re-checks access for a new visibility", async () => {
    const { api, as } = setup({
      hooks: {
        before: {
          createThread: ({ input }) => ({ ...input, subjectId: "inv-2", body: `${String(input.body)} (edited)` }),
          reply: ({ input }) => ({ ...input, visibility: "staff" }) as typeof input
        }
      }
    })
    const { thread, comment } = await api.createThread({ ...onInvoice, body: "Hi" }, as("bob"))
    expect(thread.subjectId).toBe("inv-1")
    expect(comment.body).toBe("Hi (edited)")
  })

  it("refuses with a hook's comments error code, or REJECTED_BY_HOOK for other errors", async () => {
    const { CommentsError } = await import("./index.js")
    const { post, api, as } = setup({
      hooks: {
        before: {
          createThread: ({ input }) => {
            if (input.body === "Spam") {
              throw new CommentsError("RATE_LIMITED", "Slow down.")
            }
            return input
          },
          resolveThread: ({ thread, actor, input }) => {
            if ((thread as CommentThread).createdBy !== actor?.userId) {
              throw new TypeError("Only the creator resolves.")
            }
            return input
          },
          updateThread: () => ({ threadId: 5 }) as never
        }
      }
    })
    const limited = await post("createThread", { ...onInvoice, body: "Spam" }, "bob")
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ error: { code: "RATE_LIMITED", message: "Slow down." } })
    const { thread } = await api.createThread(
      { ...onInvoice, body: "Hi" },
      { author: { type: "system", name: "Seed" } }
    )
    await expectCode(api.resolveThread({ threadId: thread.id }, as("bob")), "REJECTED_BY_HOOK")
    await expectCode(api.updateThread({ threadId: thread.id }, as("ada")), "INVALID_INPUT")
  })

  it("re-checks access when a hook moves a thread to another visibility", async () => {
    const { api, as } = setup({
      hooks: { before: { createThread: ({ input }) => ({ ...input, visibility: "staff" }) } }
    })
    await expectCode(api.createThread({ ...onInvoice, body: "Hi" }, as("bob")), "NOT_FOUND")
    expect((await api.createThread({ ...onInvoice, body: "Hi" }, as("sam"))).thread.visibility).toBe("staff")
  })
})
