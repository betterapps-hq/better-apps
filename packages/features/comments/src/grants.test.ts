import type { BetterAppsEvent } from "better-apps"
import { describe, expect, it } from "vite-plus/test"
import { expectCode, setup, sharing } from "../test/app.js"
import { commentSubjectTypes } from "./index.js"

// Gus's organization owns inv-globex; Bob, in another one, sees it only through a grant, such as a share link.
const shared = { subjectType: "invoice", subjectId: "inv-globex" } as const

async function seeded() {
  const app = setup()
  const { api, as } = app
  const open = await api.createThread({ ...shared, body: "Due Friday" }, as("gus"))
  const staff = await api.createThread({ ...shared, body: "Margin notes", visibility: "staff" }, as("gus"))
  return { ...app, open, staff }
}

describe("comments a request's grant reaches", () => {
  it("can be read, as a signed-out reader reads them, but only the default ones", async () => {
    const { api, as, identity, open, staff } = await seeded()
    const bob = { ...as("bob"), request: sharing("inv-globex") }
    const page = await api.listThreads(shared, bob)
    expect(page.threads.map((thread) => thread.id)).toEqual([open.thread.id])
    expect(page.threads[0]).toMatchObject({ createdBy: "", metadata: null })
    expect(page.users).toEqual({})

    const read = await api.getThread({ threadId: open.thread.id }, bob)
    expect(read.comments[0]).toMatchObject({
      authorId: "",
      authorName: "Gus Globex",
      body: null,
      bodyText: "Due Friday"
    })
    await expectCode(api.getThread({ threadId: staff.thread.id }, bob), "NOT_FOUND")
    expect(await api.countThreads({ ...shared, subjectIds: ["inv-globex"] }, bob)).toEqual({
      "inv-globex": { open: 1, total: 1 }
    })

    const visitor = { actor: null, request: sharing("inv-globex") }
    expect((await api.listThreads(shared, visitor)).threads).toHaveLength(1)
    // Without the grant, nothing changes.
    await expectCode(api.listThreads(shared, as("bob")), "NOT_FOUND")
    await expectCode(api.listThreads(shared, { ...as("bob"), request: sharing("inv-1") }), "NOT_FOUND")
    await expectCode(api.listThreads(shared, { actor: null, request: sharing() }), "UNAUTHENTICATED")
    // A reader the app's rules allow keeps what they see, staff threads and names included.
    const gus = await api.listThreads(shared, { actor: identity.actor("gus"), request: sharing("inv-globex") })
    expect(gus.threads).toHaveLength(2)
    expect(gus.threads[0]?.createdBy).toBe("gus")
  })

  it("can't be written to, whatever the grant", async () => {
    const { api, as, open, events } = await seeded()
    const bob = { ...as("bob"), request: sharing("inv-globex") }
    const before = events().length
    await expectCode(api.createThread({ ...shared, body: "Hi" }, bob), "NOT_FOUND")
    await expectCode(api.reply({ threadId: open.thread.id, body: "Hi" }, bob), "NOT_FOUND")
    await expectCode(api.resolveThread({ threadId: open.thread.id }, bob), "NOT_FOUND")
    await expectCode(api.deleteComment({ commentId: open.comment.id }, bob), "NOT_FOUND")
    await expectCode(api.suggestMentions({ threadId: open.thread.id, query: "a" }, bob), "NOT_FOUND")
    const visitor = { actor: null, request: sharing("inv-globex") }
    await expectCode(api.reply({ threadId: open.thread.id, body: "Hi" }, visitor), "UNAUTHENTICATED")
    expect(events()).toHaveLength(before)
  })

  it("let the request see the threads and comments themselves, such as for their reactions", async () => {
    const { app, open, staff } = await seeded()
    const request = sharing("inv-globex")
    const thread = (id: string) => ({ subjectType: commentSubjectTypes.thread, subjectId: id })
    const comment = { subjectType: commentSubjectTypes.comment, subjectId: open.comment.id }
    expect(await app.subjects.canView(null, thread(open.thread.id), { request })).toBe(true)
    expect(await app.subjects.canView(null, comment, { request })).toBe(true)
    expect(await app.subjects.canView(null, thread(staff.thread.id), { request })).toBe(false)
    expect(await app.subjects.canView(null, thread(open.thread.id))).toBe(false)
    expect(await app.subjects.canView(null, thread(open.thread.id), { request: sharing("inv-1") })).toBe(false)
  })

  it("reach a live viewer whose request carries the grant, as a signed-out reader sees them", async () => {
    const { api, identity, events } = await seeded()
    const created = events("comment.created")
    const event = created.find(
      (found) => (found.data as { thread: { visibility: string } }).thread.visibility === "default"
    )
    const viewer = identity.actor("bob")
    expect(await api.toClientEvent({ event: event as BetterAppsEvent, viewer })).toBeNull()
    expect(
      await api.toClientEvent({ event: event as BetterAppsEvent, viewer, request: sharing("inv-globex") })
    ).toMatchObject({ thread: { createdBy: "" }, comment: { authorId: "", body: null, bodyText: "Due Friday" } })
    const hidden = created.find((found) => found !== event) as BetterAppsEvent
    expect(await api.toClientEvent({ event: hidden, viewer, request: sharing("inv-globex") })).toBeNull()
  })
})
