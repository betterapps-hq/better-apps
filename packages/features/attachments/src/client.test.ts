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

  it("keeps a file off when a load that read it before it came off lands after", async () => {
    const { attachments, upload, hold, holdAnswer } = browser()
    const { file } = await upload("bob", inv1)
    await attachments.load("invoice", ["inv-1"])
    const detachHeld = hold("detach")
    const detaching = attachments.detach(inv1, file.id)
    await tick()
    // The load starts while the detach is under way and reads the file before it comes off; its answer arrives after.
    const answerHeld = holdAnswer("listFiles")
    const loading = attachments.load("invoice", ["inv-1"])
    await tick(10)
    detachHeld()
    await detaching
    answerHeld()
    await loading
    await tick(10)
    expect(attachments.store.getSnapshot().subjects[key1]?.files).toEqual([])
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

  it("keeps a new order while it's saved, when a load lands meanwhile", async () => {
    const { attachments, upload, hold } = browser()
    const first = (await upload("bob", inv1)).file.id
    const second = (await upload("bob", inv1)).file.id
    await attachments.load("invoice", ["inv-1"])
    const order = () => attachments.store.getSnapshot().subjects[key1]?.files.map((entry) => [entry.id, entry.position])

    // The load goes out before the reorder, so its answer is dropped and it loads again, before the reorder is saved.
    const listHeld = hold("listFiles")
    const loading = attachments.load("invoice", ["inv-1"])
    await tick()
    const reorderHeld = hold("reorder")
    const reordering = attachments.reorder(inv1, [second, first])
    listHeld()
    await loading
    expect(order()).toEqual([
      [second, 0],
      [first, 1]
    ])
    reorderHeld()
    await reordering
    await tick(10)
    expect(order()).toEqual([
      [second, 0],
      [first, 1]
    ])
  })

  it("sends a record's reorders one after another, so the last one asked for is the one kept", async () => {
    const { attachments, upload, requests, hold } = browser()
    const a = (await upload("bob", inv1)).file.id
    const b = (await upload("bob", inv1)).file.id
    const c = (await upload("bob", inv1)).file.id
    await attachments.load("invoice", ["inv-1"])
    const order = () => attachments.store.getSnapshot().subjects[key1]?.files.map((entry) => entry.id)
    const held = hold("reorder")
    const first = attachments.reorder(inv1, [b, a, c])
    const second = attachments.reorder(inv1, [b, c, a])
    await tick()
    expect(requests.filter((name) => name === "reorder")).toHaveLength(1)
    expect(order()).toEqual([b, c, a])
    held()
    await Promise.all([first, second])
    expect(requests.filter((name) => name === "reorder")).toHaveLength(2)
    await attachments.load("invoice", ["inv-1"])
    expect(order()).toEqual([b, c, a])
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

  it("drops answers meant for the person before a reset, and never sends their loads", async () => {
    const { attachments, upload, requests, hold, send } = browser("cy")
    const { file } = await upload("bob", inv1)
    await attachments.load("invoice", ["inv-1"])

    const detachHeld = hold("detach")
    const detaching = attachments.detach(inv1, file.id)
    const reorderHeld = hold("reorder")
    const reordering = attachments.reorder(inv1, [file.id])
    const prepared = await attachments.prepareUpload(pick("late"), inv1)
    await send(prepared.upload, "late")
    const completeHeld = hold("completeUpload")
    // Called without a signal, as an engine of its own might, so reset() doesn't cancel it.
    const finishing = attachments.finishUpload(prepared)
    await tick()
    const loading = attachments.load("invoice", ["inv-2"])

    attachments.reset()
    detachHeld()
    reorderHeld()
    completeHeld()
    await expect(detaching).rejects.toMatchObject({ code: "ABORTED" })
    await expect(reordering).rejects.toMatchObject({ code: "ABORTED" })
    await expect(loading).rejects.toMatchObject({ code: "ABORTED" })
    expect(await finishing).toMatchObject({ id: prepared.file.id, status: "ready" })
    await tick(10)
    expect(attachments.store.getSnapshot().subjects).toEqual({})
    expect(requests.filter((name) => name === "listFiles")).toHaveLength(1)
  })

  it("deletes files, and takes a file on its own off the records it's on", async () => {
    const { attachments, count } = browser()
    const file = await attachments.upload(pick("mine"), { owner: "user" })
    await attachments.attach(inv1, [file.id])
    expect(attachments.store.getSnapshot().subjects[key1]?.files.map((entry) => entry.id)).toEqual([file.id])
    await attachments.deleteFile(file.id)
    expect(count("attachmentFile")).toBe(0)
    expect(attachments.store.getSnapshot().subjects[key1]?.files).toEqual([])
  })

  it("puts files that finish together in the server's order, whichever answer lands first", async () => {
    const { attachments, holdAnswer, send } = browser()
    await attachments.load("invoice", ["inv-1"])
    const first = await attachments.prepareUpload(pick("a", "a.txt"), inv1)
    const second = await attachments.prepareUpload(pick("b", "b.txt"), inv1)
    await send(first.upload, "a")
    await send(second.upload, "b")
    // The first is saved first, but its answer arrives last.
    const firstHeld = holdAnswer("completeUpload")
    const finishingFirst = attachments.finishUpload(first)
    await tick(10)
    const secondHeld = holdAnswer("completeUpload")
    const finishingSecond = attachments.finishUpload(second)
    await tick(10)
    secondHeld()
    await finishingSecond
    firstHeld()
    await finishingFirst
    expect(attachments.store.getSnapshot().subjects[key1]?.files.map((entry) => [entry.id, entry.position])).toEqual([
      [first.file.id, 0],
      [second.file.id, 1]
    ])
  })

  it("keeps a reorder under way when an upload finishes meanwhile, with the new file after", async () => {
    const { attachments, upload, hold } = browser()
    const a = (await upload("bob", inv1)).file.id
    const b = (await upload("bob", inv1)).file.id
    await attachments.load("invoice", ["inv-1"])
    const ids = () => attachments.store.getSnapshot().subjects[key1]?.files.map((entry) => entry.id)
    const reorderHeld = hold("reorder")
    const reordering = attachments.reorder(inv1, [b, a])
    const c = await attachments.upload(pick("c", "c.txt"), inv1)
    expect(ids()).toEqual([b, a, c.id])
    reorderHeld()
    await expect(reordering).rejects.toMatchObject({ code: "CONFLICT" })
    // The server refused the order, since the record had three files by then, so its own order shows.
    expect(ids()).toEqual([a, b, c.id])
  })
})
