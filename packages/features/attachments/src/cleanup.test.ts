import { createTestApp } from "@better-apps/testing"
import {
  defineAction,
  defineEvent,
  defineFeature,
  type BetterAppsEvent,
  type EventHandler,
  type SubjectDefinition
} from "better-apps"
import { describe, expect, it } from "vite-plus/test"
import { subjects, users } from "../test/app.js"
import { attachmentEvents, attachmentModel, attachments, fileModel, memoryStorage } from "./index.js"

// Comments' subject types and events, as @better-apps/comments declares them, without its tables.
function withComments() {
  const threads = new Map([["t-1", { orgId: "acme", comments: new Set(["c-1", "c-2"]) }]])
  const threadOf = (commentId: string) => [...threads].find(([, thread]) => thread.comments.has(commentId))
  const subject = (find: (id: string) => { orgId: string } | undefined): SubjectDefinition => ({
    canView: ({ actor, subjectId }) => actor.orgId === find(subjectId)?.orgId,
    getOrgId: ({ subjectId }) => find(subjectId)?.orgId ?? null
  })
  const fake = defineFeature({
    id: "comments",
    subjects: {
      "comments.thread": subject((id) => threads.get(id)),
      "comments.comment": subject((id) => threadOf(id)?.[1])
    },
    events: { "comment.deleted": defineEvent(), "thread.deleted": defineEvent(), "thread.moved": defineEvent() },
    actions: {
      emit: defineAction({
        handler: async ({ input, emit }) => {
          const { type, data } = input as { type: string; data: unknown }
          emit(type, data)
        }
      })
    }
  })
  const storage = memoryStorage()
  const feature = attachments({ storage, subjects: { "comments.comment": {}, "comments.thread": {} } })
  const delivered: BetterAppsEvent[] = []
  const record: EventHandler = (event) => void delivered.push(event)
  const feed = defineFeature({
    id: "feed",
    on: { attachments: Object.fromEntries(Object.keys(attachmentEvents).map((type) => [type, record])) }
  })
  const { app, database, identity } = createTestApp({ subjects, features: [feature, fake, feed], users })
  const as = (userId: "bob") => ({ actor: identity.actor(userId) })
  const count = (table: string) =>
    (database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
  /** Puts a file on a comment or thread, as a person posting it. */
  const attach = async (subjectType: "comments.comment" | "comments.thread", subjectId: string) => {
    const created = await app.api.attachments.createUpload(
      { subjectType, subjectId, name: "a.txt", contentType: "text/plain", size: 1 },
      as("bob")
    )
    await storage.put(`attachments/${created.file.id}`, "a", { size: 1, contentType: "text/plain" })
    return app.api.attachments.completeUpload({ fileId: created.file.id }, as("bob"))
  }
  return {
    api: app.api.attachments,
    emit: app.api.comments.emit,
    deliver: () => app.deliverEvents(),
    attach,
    threads,
    storage,
    count,
    events: (type: string) => delivered.filter((event) => event.type === type)
  }
}

describe("with comments", () => {
  it("removes a deleted comment's files", async () => {
    const { emit, attach, storage, count } = withComments()
    await attach("comments.comment", "c-1")
    await attach("comments.comment", "c-2")
    await emit({ type: "comment.deleted", data: { comment: { id: "c-1" } } })
    expect(count(attachmentModel)).toBe(1)
    expect(storage.objects.size).toBe(1)
  })

  it("removes a deleted thread's files, and its comments'", async () => {
    const { emit, attach, count, events } = withComments()
    await attach("comments.thread", "t-1")
    await attach("comments.comment", "c-1")
    await attach("comments.comment", "c-2")
    await emit({ type: "thread.deleted", data: { thread: { id: "t-1", orgId: "acme" }, commentIds: ["c-1", "c-2"] } })
    expect([count(attachmentModel), count(fileModel)]).toEqual([0, 0])
    expect(events("subject.changed")).toHaveLength(3)
  })

  it("moves a thread's files with it, and stops when it moved again", async () => {
    const { emit, attach, threads, api, events } = withComments()
    await attach("comments.comment", "c-1")
    threads.set("t-1", { orgId: "globex", comments: new Set(["c-1", "c-2"]) })
    await emit({
      type: "thread.moved",
      data: { thread: { id: "t-1", orgId: "acme" }, commentIds: ["c-1", "c-2"], fromOrgId: "globex" }
    })
    expect(events("subject.moved")).toHaveLength(0)
    await emit({
      type: "thread.moved",
      data: { thread: { id: "t-1", orgId: "globex" }, commentIds: ["c-1", "c-2"], fromOrgId: "acme" }
    })
    expect(events("subject.moved")).toHaveLength(1)
    const listed = await api.listFiles({ subjectType: "comments.comment", subjectIds: ["c-1"] })
    expect(listed["c-1"]?.map((file) => file.orgId)).toEqual(["globex"])
  })

  it("continues a long cleanup in the next delivery run", async () => {
    const { emit, deliver, count, events } = withComments()
    const commentIds = Array.from({ length: 2000 }, (_, index) => `gone-${index}`)
    await emit({ type: "thread.deleted", data: { thread: { id: "t-9", orgId: "acme" }, commentIds } })
    // Each delivery reads ten lists of 90 ids, so 2000 take three: the event's own, then two continued later.
    expect(events("cleanup.continued")).toHaveLength(0)
    await deliver()
    expect(events("cleanup.continued")).toHaveLength(1)
    await deliver()
    await deliver()
    expect(events("cleanup.continued")).toHaveLength(2)
    expect(count(attachmentModel)).toBe(0)
  })
})
