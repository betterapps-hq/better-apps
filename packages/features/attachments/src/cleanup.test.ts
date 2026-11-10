import type { SQLInputValue } from "node:sqlite"
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
import { subjects, users } from "../test/app.js"
import { attachmentEvents, attachmentModel, attachments, fileModel, memoryStorage, moveModel } from "./index.js"

// Comments' subject types and events, as @better-apps/comments declares them, without its tables.
function withComments() {
  const threads = new Map([["t-1", { orgId: "acme", comments: new Set(["c-1", "c-2"]) }]])
  // `afterOrg` runs once, right after the next organization lookup, such as to move a thread while a page of a move
  // runs. `failOnce` fails the next delivery of that event to the feed once, as a crash would.
  const hooks: { afterOrg?: (() => void) | undefined; failOnce?: string | undefined } = {}
  const threadOf = (commentId: string) => [...threads].find(([, thread]) => thread.comments.has(commentId))
  const subject = (find: (id: string) => { orgId: string } | undefined): SubjectDefinition => ({
    canView: ({ actor, subjectId }) => actor.orgId === find(subjectId)?.orgId,
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
  const record: EventHandler = (event) => {
    if (hooks.failOnce === event.type) {
      hooks.failOnce = undefined
      throw new Error("Crashed")
    }
    delivered.push(event)
  }
  const feed = defineFeature({
    id: "feed",
    on: {
      attachments: Object.fromEntries(Object.keys(attachmentEvents).map((type) => [type, record])),
      comments: { "thread.moved": record }
    }
  })
  const { app, database, identity } = createTestApp({ subjects, features: [feature, fake, feed], users })
  const as = (userId: "bob") => ({ actor: identity.actor(userId) })
  // A deleted file's row waits until its upload address closed, so files count only while they aren't deleted.
  const count = (table: string) =>
    (
      database.sqlite
        .prepare(`SELECT COUNT(*) AS count FROM ${table}${table === fileModel ? " WHERE status <> 'deleted'" : ""}`)
        .get() as { count: number }
    ).count
  /** How many attachments, and how many files, are in an organization. */
  const inOrg = (orgId: string) =>
    [attachmentModel, fileModel].map(
      (table) =>
        (
          database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE orgId = ?`).get(orgId) as {
            count: number
          }
        ).count
    )
  // Where attachments expect the thread to be, from the move they follow, or deleted.
  const turn = (threadId: string) =>
    database.sqlite
      .prepare(`SELECT toOrgId, deleted FROM ${moveModel} WHERE id = ?`)
      .get(JSON.stringify(["comments.thread", threadId]))
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
    hooks,
    storage,
    database,
    count,
    inOrg,
    turn,
    events: (type: string) => delivered.filter((event) => event.type === type)
  }
}

const backdated = { createdAt: new Date(Date.now() - 60 * 24 * 60 * 60_000) }
const moved = (threadId: string, toOrgId: string, commentIds: string[], fromOrgId = "acme") => ({
  type: "thread.moved",
  data: { thread: { id: threadId, orgId: toOrgId }, fromOrgId, commentIds }
})

// Runs `land` once, after a move reads its thread's turn and before the batch that writes it, outside that batch.
function beforeTurnWrite(
  setup: ReturnType<typeof withComments>,
  land: (run: (sql: string, ...params: SQLInputValue[]) => void) => void
) {
  const { sqlite } = setup.database
  const prepare = sqlite.prepare.bind(sqlite)
  const exec = sqlite.exec.bind(sqlite)
  let read = false
  let landed = false
  Object.assign(sqlite, {
    prepare: (sql: string) => {
      read ||= sql.startsWith("select") && sql.includes(`from "${moveModel}"`)
      return prepare(sql)
    },
    exec: (sql: string) => {
      if (read && !landed && sql === "BEGIN") {
        landed = true
        land((query, ...params) => void prepare(query).run(...params))
      }
      return exec(sql)
    }
  })
  return () => landed
}

// Delivers again once a failed delivery's backoff has passed.
async function deliverLater(setup: ReturnType<typeof withComments>) {
  vi.useFakeTimers({ toFake: ["Date"] })
  try {
    vi.setSystemTime(Date.now() + 60_000)
    await setup.deliver()
    await setup.deliver()
  } finally {
    vi.useRealTimers()
  }
}

/** A thread in acme with 15 comments of two files each, 30 in all, so a move takes two pages: 20, then 10. */
async function busyThread(setup: ReturnType<typeof withComments>) {
  const ids = Array.from({ length: 15 }, (_, index) => `big-${index}`)
  setup.threads.set("t-big", { orgId: "acme", comments: new Set(ids) })
  for (const id of ids) {
    await setup.attach("comments.comment", id)
    await setup.attach("comments.comment", id)
  }
  return ids
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

  it("moves the files of a thread's comments that are left when its first comment was deleted", async () => {
    const { emit, attach, threads, api } = withComments()
    await attach("comments.comment", "c-1")
    await attach("comments.comment", "c-2")
    // c-1 is deleted, and its own cleanup hasn't run yet, when the thread moves.
    threads.set("t-1", { orgId: "globex", comments: new Set(["c-2"]) })
    await emit({
      type: "thread.moved",
      data: { thread: { id: "t-1", orgId: "globex" }, commentIds: ["c-1", "c-2"], fromOrgId: "acme" }
    })
    const listed = await api.listFiles({ subjectType: "comments.comment", subjectIds: ["c-2"] })
    expect(listed["c-2"]?.map((file) => file.orgId)).toEqual(["globex"])
  })

  it("keeps moving a thread's comments over several runs when the next one is deleted between them", async () => {
    const { emit, attach, threads, api, deliver, events } = withComments()
    const fillers = Array.from({ length: 1999 }, (_, index) => `n-${index}`)
    threads.set("t-1", { orgId: "acme", comments: new Set(["c-1", ...fillers, "c-2"]) })
    await attach("comments.comment", "c-1")
    await attach("comments.comment", "c-2")
    threads.set("t-1", { orgId: "globex", comments: new Set(["c-1", ...fillers, "c-2"]) })
    await emit({
      type: "thread.moved",
      data: { thread: { id: "t-1", orgId: "globex" }, commentIds: ["c-1", ...fillers, "c-2"], fromOrgId: "acme" }
    })
    // Each delivery of a move reads five lists of 90 ids, the first the thread's and four of its comments', so it stops
    // partway, and the comments where the next run starts are deleted before it.
    expect(events("cleanup.continued")).toHaveLength(0)
    const deleted = new Set(fillers.slice(300, 450))
    threads.set("t-1", {
      orgId: "globex",
      comments: new Set(["c-1", ...fillers.filter((id) => !deleted.has(id)), "c-2"])
    })
    for (let run = 0; run < 4; run += 1) {
      await deliver()
    }
    expect(events("cleanup.continued")).toHaveLength(4)
    const listed = await api.listFiles({ subjectType: "comments.comment", subjectIds: ["c-1", "c-2"] })
    expect([listed["c-1"]?.[0]?.orgId, listed["c-2"]?.[0]?.orgId]).toEqual(["globex", "globex"])
  })

  it("fails an older move's page when a newer move lands after its check, keeping the newer move's work", async () => {
    const setup = withComments()
    const ids = await busyThread(setup)
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids))
    expect(setup.inOrg("globex")).toEqual([20, 20])
    // Once the next page has passed its check and goes to read its attachments, the thread moves to initech, and the
    // newer move takes the turn and moves every file there, so only the page's batch can tell.
    const { sqlite } = setup.database
    const prepare = sqlite.prepare.bind(sqlite)
    let landed = false
    Object.assign(sqlite, {
      prepare: (sql: string) => {
        if (!landed && sql.includes('from "attachment"') && sql.includes("<>")) {
          landed = true
          setup.threads.set("t-big", { orgId: "initech", comments: new Set(ids) })
          prepare(`UPDATE ${moveModel} SET toOrgId = 'initech'`).run()
          prepare(`UPDATE ${attachmentModel} SET orgId = 'initech'`).run()
          prepare(`UPDATE ${fileModel} SET orgId = 'initech'`).run()
        }
        return prepare(sql)
      }
    })
    await setup.deliver()
    await setup.deliver()
    expect(landed).toBe(true)
    expect(setup.inOrg("initech")).toEqual([30, 30])
    expect(setup.events("subject.moved")).toHaveLength(10)
  })

  it("lets the move that committed last run, even when its event says it's older", async () => {
    const setup = withComments()
    const ids = await busyThread(setup)
    setup.threads.set("t-big", { orgId: "initech", comments: new Set(ids) })
    await setup.emit(moved("t-big", "initech", ids))
    expect(setup.inOrg("initech")).toEqual([20, 20])
    // A move dated two months back, such as an import's, commits after it and leaves the thread in globex.
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids, "initech"), backdated)
    await setup.deliver()
    await setup.deliver()
    expect(setup.inOrg("globex")).toEqual([30, 30])
  })

  it("keeps a move's turn while it runs, whenever its event was dated", async () => {
    const setup = withComments()
    const ids = await busyThread(setup)
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids), backdated)
    // Another thread's move clears turns no move has written for 30 days, which this one's isn't.
    setup.threads.set("t-1", { orgId: "globex", comments: new Set(["c-1", "c-2"]) })
    await setup.emit(moved("t-1", "globex", ["c-1", "c-2"]))
    expect(setup.turn("t-big")).toEqual({ toOrgId: "globex", deleted: 0 })
    await setup.deliver()
    await setup.deliver()
    expect(setup.inOrg("globex")).toEqual([30, 30])
  })

  it("runs both moves to an organization a thread moves away from and back to", async () => {
    const setup = withComments()
    const ids = await busyThread(setup)
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids))
    setup.threads.set("t-big", { orgId: "acme", comments: new Set(ids) })
    await setup.emit(moved("t-big", "acme", ids, "globex"))
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids))
    await setup.deliver()
    await setup.deliver()
    await setup.deliver()
    expect(setup.turn("t-big")).toEqual({ toOrgId: "globex", deleted: 0 })
    expect(setup.inOrg("globex")).toEqual([30, 30])
  })

  it("never lets an older move take over when its delivery is retried after a newer one", async () => {
    const setup = withComments()
    const ids = await busyThread(setup)
    // The move to globex moves its first page, then its delivery fails, and is retried once its backoff passes.
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    setup.hooks.failOnce = "thread.moved"
    await setup.emit(moved("t-big", "globex", ids))
    expect(setup.inOrg("globex")).toEqual([20, 20])
    setup.threads.set("t-big", { orgId: "initech", comments: new Set(ids) })
    await setup.emit(moved("t-big", "initech", ids, "globex"))
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      vi.setSystemTime(Date.now() + 60_000)
      await setup.deliver()
      await setup.deliver()
      await setup.deliver()
    } finally {
      vi.useRealTimers()
    }
    expect(setup.turn("t-big")).toEqual({ toOrgId: "initech", deleted: 0 })
    expect(setup.inOrg("initech")).toEqual([30, 30])
  })

  it("stops a move to no organization when its thread is deleted", async () => {
    const setup = withComments()
    const ids = await busyThread(setup)
    setup.threads.set("t-big", { orgId: "", comments: new Set(ids) })
    await setup.emit(moved("t-big", "", ids))
    expect(setup.inOrg("")).toEqual([20, 20])
    expect(setup.events("subject.moved")).toHaveLength(10)
    // The deletion's first delivery reads only the first of its thousand comments, so the move's next delivery comes
    // before its files go.
    const fillers = Array.from({ length: 1000 }, (_, index) => `gone-${index}`)
    setup.threads.delete("t-big")
    await setup.emit({
      type: "thread.deleted",
      data: { thread: { id: "t-big", orgId: "" }, commentIds: [...fillers, ...ids] }
    })
    await setup.deliver()
    await setup.deliver()
    expect([setup.count(attachmentModel), setup.count(fileModel)]).toEqual([0, 0])
    expect(setup.events("subject.moved")).toHaveLength(10)
    expect(setup.turn("t-big")).toEqual({ toOrgId: "", deleted: 1 })
  })

  it("stops an older move for good when one of its pages runs while its thread is elsewhere", async () => {
    const setup = withComments()
    const ids = await busyThread(setup)
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids))
    setup.threads.set("t-big", { orgId: "acme", comments: new Set(ids) })
    await setup.emit(moved("t-big", "acme", ids, "globex"))
    // The move to globex's next page runs while the thread is in acme, which stops it.
    await setup.deliver()
    expect(setup.inOrg("acme")).toEqual([30, 30])
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids))
    await setup.deliver()
    await setup.deliver()
    expect(setup.inOrg("globex")).toEqual([30, 30])
  })

  it("refuses a move whose thread is deleted between reading its turn and taking it", async () => {
    const setup = withComments()
    const ids = await busyThread(setup)
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    const landed = beforeTurnWrite(setup, (run) => {
      setup.threads.delete("t-big")
      run(
        `INSERT INTO ${moveModel} (id, toOrgId, deleted, claim, heldAt) VALUES (?, '', 1, 'deleted', ?)`,
        JSON.stringify(["comments.thread", "t-big"]),
        Date.now()
      )
    })
    await setup.emit(moved("t-big", "globex", ids))
    expect(landed()).toBe(true)
    await deliverLater(setup)
    expect(setup.inOrg("globex")).toEqual([0, 0])
    expect(setup.turn("t-big")).toEqual({ toOrgId: "", deleted: 1 })
  })

  it("refuses a move that read its thread's turn before a newer move claimed it", async () => {
    const setup = withComments()
    const ids = await busyThread(setup)
    setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
    await setup.emit(moved("t-big", "globex", ids))
    await setup.deliver()
    await setup.deliver()
    expect(setup.inOrg("globex")).toEqual([30, 30])
    // The thread moves to initech, and before that move takes its turn, it moves back to globex, whose move claims the
    // turn and finds nothing to move.
    setup.threads.set("t-big", { orgId: "initech", comments: new Set(ids) })
    const landed = beforeTurnWrite(setup, (run) => {
      setup.threads.set("t-big", { orgId: "globex", comments: new Set(ids) })
      run(`UPDATE ${moveModel} SET claim = 'newer'`)
    })
    await setup.emit(moved("t-big", "initech", ids, "globex"))
    expect(landed()).toBe(true)
    await deliverLater(setup)
    expect(setup.inOrg("initech")).toEqual([0, 0])
    expect(setup.inOrg("globex")).toEqual([30, 30])
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
