import { describe, expect, it } from "vite-plus/test"
import { invoices, setup } from "../test/app.js"
import { commentSubjectTypes } from "./index.js"

const onInvoice = { subjectType: "invoice", subjectId: "inv-1" } as const
const onPage = { subjectType: "page", subjectId: "home" } as const

describe("comment subject types", () => {
  it("lets whoever can see a thread see it and its comments", async () => {
    const { app, api, as, identity } = setup()
    const open = await api.createThread({ ...onInvoice, body: "Open" }, as("bob"))
    const staff = await api.createThread({ ...onInvoice, visibility: "staff", body: "Staff" }, as("ada"))
    const thread = (id: string) => ({ subjectType: commentSubjectTypes.thread, subjectId: id })
    const comment = (id: string) => ({ subjectType: commentSubjectTypes.comment, subjectId: id })
    const [bob, sam, gus] = [identity.actor("bob"), identity.actor("sam"), identity.actor("gus")]

    expect(await app.subjects.canView(bob, thread(open.thread.id))).toBe(true)
    expect(await app.subjects.canView(bob, comment(open.comment.id))).toBe(true)
    expect(await app.subjects.canView(gus, comment(open.comment.id))).toBe(false)
    expect(await app.subjects.canView(null, comment(open.comment.id))).toBe(false)
    expect(
      await app.subjects.canViewMany([
        { actor: bob, ...comment(staff.comment.id) },
        { actor: sam, ...comment(staff.comment.id) },
        { actor: bob, ...thread(staff.thread.id) },
        { actor: bob, ...comment("missing") }
      ])
    ).toEqual([false, true, false, false])
    expect(await app.subjects.getOrgId(comment(open.comment.id))).toBe("acme")
  })

  it("makes threads public when their subject is, unless their visibility is restricted", async () => {
    const { app, api, as } = setup({
      subjects: {
        invoice: { canComment: () => true },
        page: { canComment: () => true, visibility: { staff: () => true } }
      }
    })
    const open = await api.createThread({ ...onPage, body: "Hello" }, as("bob"))
    const staff = await api.createThread({ ...onPage, visibility: "staff", body: "Hello staff" }, as("bob"))
    const comment = (id: string) => ({ subjectType: commentSubjectTypes.comment, subjectId: id })
    expect(await app.subjects.isPublic(comment(open.comment.id))).toBe(true)
    expect(await app.subjects.canView(null, comment(open.comment.id))).toBe(true)
    expect(await app.subjects.isPublic(comment(staff.comment.id))).toBe(false)
    expect(await app.subjects.getOrgId(comment(open.comment.id))).toBeNull()
  })

  it("hides threads left behind when their subject moves to another organization", async () => {
    const { app, api, as, identity } = setup()
    const { thread } = await api.createThread({ subjectType: "invoice", subjectId: "inv-2", body: "Acme's" }, as("bob"))
    const ref = { subjectType: commentSubjectTypes.thread, subjectId: thread.id }
    invoices.set("inv-2", { orgId: "globex" })
    try {
      expect(await app.subjects.canView(identity.actor("gus"), ref)).toBe(false)
      expect(await app.subjects.canView(identity.actor("bob"), ref)).toBe(false)
    } finally {
      invoices.set("inv-2", { orgId: "acme" })
    }
  })
})
