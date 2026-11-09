import { createBetterAppsClient } from "better-apps/client"
import { describe, expect, it } from "vite-plus/test"
import { inv1 } from "../test/app.js"
import { browser, pick } from "../test/browser.js"
import { createAttachmentsClient, subjectKey } from "./client.js"

const key1 = subjectKey("invoice", "inv-1")
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

describe("attachments client", () => {
  it("is one per Better Apps client", () => {
    const { client, attachments } = browser()
    expect(createAttachmentsClient(client)).toBe(attachments)
  })

  it("loads records asked for in the same tick in one call, 20 a call", async () => {
    const { attachments, requests, upload } = browser()
    await upload("bob", inv1)
    await Promise.all([
      attachments.load("invoice", ["inv-1"]),
      attachments.load("invoice", ["inv-2", "inv-1"]),
      attachments.load(
        "invoice",
        Array.from({ length: 25 }, (_, index) => `x-${index}`)
      )
    ])
    expect(requests).toEqual(["listFiles", "listFiles"])
    const subject = attachments.store.getSnapshot().subjects[key1]
    expect(subject?.state).toBe("ready")
    expect(subject?.files[0]?.createdAt).toBeInstanceOf(Date)
    expect(subject?.files[0]?.attachedAt).toBeInstanceOf(Date)
  })

  it("marks a failed load", async () => {
    const { attachments } = browser()
    await expect(attachments.load("ticket" as "invoice", ["t-1"])).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(attachments.store.getSnapshot().subjects[subjectKey("ticket", "t-1")]?.state).toBe("error")
  })

  it("uploads onto a record with progress, and adds the file to the record", async () => {
    const { attachments, progress } = browser()
    await attachments.load("invoice", ["inv-1"])
    const file = await attachments.upload(pick("hello"), inv1)
    expect(file).toMatchObject({ name: "notes.txt", size: 5, status: "ready" })
    expect(progress).toEqual([2])
    const uploads = Object.values(attachments.store.getSnapshot().uploads)
    expect(uploads).toMatchObject([{ state: "done", loaded: 5, size: 5, file: { id: file.id } }])
    expect(attachments.store.getSnapshot().subjects[key1]?.files.map((entry) => entry.id)).toEqual([file.id])
  })

  it("uploads straight to storage when it signs uploads", async () => {
    const { attachments, storage } = browser("bob", {}, { signedUploads: true })
    const file = await attachments.upload(pick("direct"), inv1)
    expect(storage.objects.has(`attachments/${file.id}`)).toBe(true)
  })

  it("leaves sending the bytes to another engine, such as UploadCN's, between its two steps", async () => {
    const { attachments, send } = browser()
    await attachments.load("invoice", ["inv-1"])
    const prepared = await attachments.prepareUpload(pick("engine"), inv1)
    expect(prepared.file).toMatchObject({ name: "notes.txt", status: "pending" })
    expect((await send(prepared.upload, "engine")).status).toBe(204)
    const file = await attachments.finishUpload(prepared)
    expect(file).toMatchObject({ id: prepared.file.id, status: "ready" })
    expect(attachments.store.getSnapshot().subjects[key1]?.files.map((entry) => entry.id)).toEqual([file.id])
    expect(attachments.store.getSnapshot().uploads).toEqual({})
  })

  it("refuses a file the loaded limits don't allow, without a call", async () => {
    const { attachments, requests } = browser()
    await attachments.loadSettings("invoice")
    await expect(attachments.upload(pick("x", "a.zip", "application/zip"), inv1)).rejects.toMatchObject({
      code: "INVALID_INPUT"
    })
    await expect(attachments.upload(pick("x".repeat(1001)), inv1)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE"
    })
    expect(requests).toEqual(["getSettings"])
    expect(Object.values(attachments.store.getSnapshot().uploads).map((upload) => upload.state)).toEqual([
      "error",
      "error"
    ])
  })

  it("reports a refused upload and a failed send", async () => {
    const { attachments } = browser()
    await expect(
      attachments.upload(pick("x"), { subjectType: "invoice", subjectId: "inv-locked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    const { app, identity } = browser()
    const fresh = createBetterAppsClient<typeof app>({
      baseURL: "https://app.test",
      fetch: async (url, init) => {
        const headers = new Headers(init.headers)
        headers.set("x-better-apps-test-user", "bob")
        return app.handler(new Request(url, { ...init, headers }))
      }
    })
    expect(identity.headers("bob")).toHaveProperty("x-better-apps-test-user")
    const broken = createAttachmentsClient(fresh, { transport: async () => ({ status: 500 }) })
    await expect(broken.upload(pick("x"), inv1)).rejects.toMatchObject({ code: "UPLOAD_FAILED" })
  })

  it("cancels an upload under way and deletes what the server knew of it", async () => {
    const { attachments, stallUploads, count, requests } = browser()
    stallUploads(true)
    const started = attachments.startUpload(pick("slow"), inv1)
    await tick(20)
    attachments.cancel(started.id)
    await expect(started.done).rejects.toMatchObject({ code: "ABORTED" })
    expect(attachments.store.getSnapshot().uploads[started.id]?.state).toBe("cancelled")
    await tick(20)
    expect(requests).toContain("deleteFile")
    expect(count("attachmentFile")).toBe(0)
    attachments.dismiss([started.id])
    expect(attachments.store.getSnapshot().uploads).toEqual({})
  })

  it("attaches drafts and loads the record again", async () => {
    const { attachments } = browser()
    const draft = await attachments.upload(pick("draft"), { subjectType: "invoice" })
    const attached = await attachments.attach({ subjectType: "invoice", subjectId: "inv-2" }, [draft.id])
    expect(attached.map((file) => file.id)).toEqual([draft.id])
    expect(
      attachments.store.getSnapshot().subjects[subjectKey("invoice", "inv-2")]?.files.map((file) => file.id)
    ).toEqual([draft.id])
  })

  it("takes a file off at once, and puts it back when the server refuses", async () => {
    const { attachments, upload, hold } = browser("cy")
    const { file } = await upload("bob", inv1)
    const mine = await attachments.upload(pick("mine"), inv1)
    await attachments.load("invoice", ["inv-1"])
    const release = hold("detach")
    const detaching = attachments.detach(inv1, mine.id)
    expect(attachments.store.getSnapshot().subjects[key1]?.files.map((entry) => entry.id)).toEqual([file.id])
    expect(attachments.store.getSnapshot().subjects[key1]?.pending).toEqual([mine.id])
    release()
    await detaching
    expect(attachments.store.getSnapshot().subjects[key1]?.pending).toEqual([])
    await expect(attachments.detach(inv1, file.id)).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(attachments.store.getSnapshot().subjects[key1]?.files.map((entry) => entry.id)).toEqual([file.id])
  })

  it("reorders at once, and goes back when the server refuses", async () => {
    const { attachments, upload } = browser()
    const first = (await upload("bob", inv1)).file.id
    const second = (await upload("bob", inv1)).file.id
    await attachments.load("invoice", ["inv-1"])
    await attachments.reorder(inv1, [second, first])
    expect(attachments.store.getSnapshot().subjects[key1]?.files.map((entry) => entry.id)).toEqual([second, first])
    await expect(attachments.reorder(inv1, [first])).rejects.toMatchObject({ code: "CONFLICT" })
    expect(attachments.store.getSnapshot().subjects[key1]?.files.map((entry) => entry.id)).toEqual([second, first])
  })

  it("loads a record again for a client event, and drops an answer that went out before it", async () => {
    const { attachments, upload, requests, hold } = browser()
    await attachments.load("invoice", ["inv-1"])
    const release = hold("listFiles")
    const loading = attachments.load("invoice", ["inv-1"])
    await tick()
    await upload("bob", inv1)
    attachments.applyEvent({ id: "e1", type: "subject.changed", ...inv1 })
    attachments.applyEvent(null)
    release()
    await loading
    await tick(20)
    expect(attachments.store.getSnapshot().subjects[key1]?.files).toHaveLength(1)
    expect(requests.filter((name) => name === "listFiles").length).toBeGreaterThanOrEqual(3)
  })

  it("carries loads from a server render, and resets", async () => {
    const server = browser()
    await server.upload("bob", inv1)
    await server.attachments.load("invoice", ["inv-1"])
    await server.attachments.loadSettings("invoice")
    // Through JSON, as a server render sends it.
    // oxlint-disable-next-line unicorn/prefer-structured-clone
    const snapshot = JSON.parse(JSON.stringify(server.attachments.dehydrate()))
    const { attachments } = browser()
    attachments.hydrate(snapshot)
    expect(attachments.store.getSnapshot().subjects[key1]?.files[0]?.createdAt).toBeInstanceOf(Date)
    expect(attachments.store.getSnapshot().settings.invoice?.maxFiles).toBe(3)
    let resets = 0
    const stop = attachments.onReset(() => {
      resets += 1
    })
    attachments.reset()
    stop()
    attachments.reset()
    expect(resets).toBe(1)
    expect(attachments.store.getSnapshot()).toEqual({ subjects: {}, uploads: {}, settings: {} })
  })

  it("deletes files", async () => {
    const { attachments, count } = browser()
    const file = await attachments.upload(pick("mine"), { owner: "user" })
    await attachments.deleteFile(file.id)
    expect(count("attachmentFile")).toBe(0)
  })
})
