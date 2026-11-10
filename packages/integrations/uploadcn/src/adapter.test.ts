// @vitest-environment node
import { subjectKey, type FileInfo } from "@better-apps/attachments/client"
import { createUploader, UploadError, type UploadAdapterContext, type UploadItem, type Uploader } from "@uploadcn/core"
import { BetterAppsClientError } from "better-apps/client"
import { describe, expect, it } from "vite-plus/test"
import { inv1, pick, setup } from "../test/app.js"
import {
  attachmentsAdapter,
  uploadErrorOf,
  uploadLimits,
  type AttachmentsResumeState,
  type UploadTarget
} from "./index.js"

type Setup = ReturnType<typeof setup>

/** An UploadCN uploader over the adapter, retrying at once so tests don't wait. */
function uploaderFor(view: Setup, target: UploadTarget<"invoice" | "comment">, retries = 2) {
  return createUploader<FileInfo>({
    adapter: attachmentsAdapter(view.attachments, target, { transport: view.transport }),
    retry: { retries, baseDelay: 1, maxDelay: 1, jitter: false },
    network: false
  })
}

/** Resolves once every item settled: uploaded, failed, refused or cancelled. */
async function settled(uploader: Uploader<FileInfo>) {
  const done = new Set(["success", "error", "rejected", "cancelled"])
  for (let tries = 0; tries < 400; tries += 1) {
    const { items } = uploader.getState()
    if (items.length > 0 && items.every((item) => done.has(item.status))) {
      return items
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Uploads didn't settle: ${uploader.getState().items.map((item) => item.status)}`)
}

/** Resolves once a check passes. */
async function until(check: () => boolean) {
  for (let tries = 0; tries < 400 && !check(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(check()).toBe(true)
}

const count = (calls: readonly string[], action: string) => calls.filter((call) => call === action).length

describe("attachmentsAdapter", () => {
  it("uploads a file on its own, with progress, and gives its FileInfo as the result", async () => {
    const view = setup()
    const uploader = uploaderFor(view, { owner: "user" })
    const progress: number[] = []
    uploader.on("progress", ({ item }) => progress.push(item.progress.loaded))
    await uploader.add([pick("hello")])
    const [item] = await settled(uploader)
    expect(item?.status).toBe("success")
    expect(item?.result).toMatchObject({ name: "notes.txt", status: "ready", owner: "user:bob" })
    expect(progress).toContain(5)
    expect(await view.app.api.attachments.getFile({ fileId: item?.result?.id as string })).toMatchObject({
      status: "ready"
    })
  })

  it("uploads onto a record, where the file joins the record's list", async () => {
    const view = setup({ signedUploads: true })
    await view.attachments.load("invoice", ["inv-1"])
    const uploader = uploaderFor(view, inv1)
    await uploader.add([pick("one", "one.txt"), pick("two", "two.txt"), pick("three", "three.txt")])
    const items = await settled(uploader)
    expect(items.map((item) => item.status)).toEqual(["success", "success", "success"])
    expect(view.sends.every((url) => url.startsWith("https://storage.test/"))).toBe(true)
    const listed = view.attachments.store.getSnapshot().subjects[subjectKey("invoice", "inv-1")]?.files
    expect(listed?.map((file) => file.name).sort()).toEqual(["one.txt", "three.txt", "two.txt"])
  })

  it("retries a failed send to the same address, and finishes once", async () => {
    const view = setup()
    view.failSends(503)
    const uploader = uploaderFor(view, inv1)
    await uploader.add([pick("hello")])
    const [item] = await settled(uploader)
    expect(item?.status).toBe("success")
    expect([count(view.calls, "createUpload"), view.sends.length, count(view.calls, "completeUpload")]).toEqual([
      1, 2, 1
    ])
  })

  it("asks for a new address when a send is refused, such as one that expired", async () => {
    const view = setup()
    view.failSends(403)
    const uploader = uploaderFor(view, inv1)
    await uploader.add([pick("hello")])
    const [item] = await settled(uploader)
    expect(item?.status).toBe("success")
    expect([count(view.calls, "createUpload"), view.sends.length]).toEqual([2, 2])
    expect(view.liveFiles()).toBe(1)
  })

  it("finishes again without sending the bytes again when finishing failed", async () => {
    const view = setup()
    view.failCalls("completeUpload", 503)
    const uploader = uploaderFor(view, inv1)
    await uploader.add([pick("hello")])
    const [item] = await settled(uploader)
    expect(item?.status).toBe("success")
    expect([view.sends.length, count(view.calls, "completeUpload")]).toEqual([1, 2])
  })

  it("can be tried again by hand once automatic retries run out", async () => {
    const view = setup()
    view.failSends(503, 503)
    const uploader = uploaderFor(view, inv1, 1)
    await uploader.add([pick("hello")])
    const [failed] = await settled(uploader)
    expect(failed?.status).toBe("error")
    expect(failed?.error).toMatchObject({ code: "http", status: 503, retryable: true })
    uploader.retry(failed?.id)
    await until(() => uploader.getItem(failed?.id as string)?.status === "success")
    expect(count(view.calls, "createUpload")).toBe(1)
  })

  it("refuses what attachments doesn't allow with attachments' message, and never retries it", async () => {
    const view = setup()
    const uploader = uploaderFor(view, inv1)
    await uploader.add([pick("%PDF", "contract.pdf", "application/pdf")])
    const [item] = await settled(uploader)
    expect(item?.status).toBe("rejected")
    expect(item?.error).toMatchObject({
      code: "rejected",
      retryable: false,
      message: "Files of type application/pdf aren't allowed here.",
      details: { code: "INVALID_INPUT" }
    })
    expect(count(view.calls, "createUpload")).toBe(1)
  })

  it("leaves a full record to be tried again by hand, with attachments' message", async () => {
    const view = setup({ extra: { subjects: { invoice: { maxFiles: 1 } } } })
    const first = uploaderFor(view, inv1)
    await first.add([pick("one", "one.txt")])
    await settled(first)
    const second = uploaderFor(view, inv1)
    await second.add([pick("two", "two.txt")])
    const [item] = await settled(second)
    expect(item?.status).toBe("error")
    expect(item?.error).toMatchObject({ code: "http", retryable: false, details: { code: "LIMIT_EXCEEDED" } })
    expect(item?.error?.message).toMatch(/up to 1/)
  })

  it("deletes a cancelled upload the server knew of", async () => {
    const view = setup()
    view.stallSends(true)
    const uploader = uploaderFor(view, inv1)
    const [item] = await uploader.add([pick("hello")])
    await until(() => view.sends.length === 1)
    expect(view.liveFiles()).toBe(1)
    uploader.cancel(item?.id)
    expect(uploader.getItem(item?.id as string)?.status).toBe("cancelled")
    await until(() => view.liveFiles() === 0)
    expect(view.storage.objects.size).toBe(0)
  })

  it("takes a cancelled upload off its record when its bytes got there first", async () => {
    const view = setup()
    await view.attachments.load("invoice", ["inv-1"])
    const release = view.holdAnswer("completeUpload")
    const uploader = uploaderFor(view, inv1)
    const [item] = await uploader.add([pick("hello")])
    await until(() => count(view.calls, "completeUpload") === 1)
    uploader.cancel(item?.id)
    await until(() => count(view.calls, "deleteFile") === 1)
    release()
    await until(() => view.liveFiles() === 0)
    expect(await view.app.api.attachments.listFiles({ subjectType: "invoice", subjectIds: ["inv-1"] })).toEqual({
      "inv-1": []
    })
  })

  it("deletes a refused upload's pending file once it's removed from the queue", async () => {
    const view = setup()
    view.failCalls("completeUpload", 403, { code: "FORBIDDEN" })
    const uploader = uploaderFor(view, inv1)
    const [item] = await uploader.add([pick("hello")])
    const [refused] = await settled(uploader)
    expect(refused?.status).toBe("rejected")
    expect(view.liveFiles()).toBe(1)
    uploader.remove(item?.id)
    await until(() => view.liveFiles() === 0)
    expect(view.storage.objects.size).toBe(0)
  })

  it("asks for a new address when the kept one expires before another attempt", async () => {
    const view = setup()
    const adapter = attachmentsAdapter(view.attachments, inv1, { transport: view.transport })
    const expired: AttachmentsResumeState = {
      fileId: "gone",
      url: "https://app.test/expired",
      headers: {},
      expiresAt: Date.now() - 1,
      target: inv1,
      sent: false
    }
    const file = pick("hello")
    const saved: unknown[] = []
    const context = {
      item: { id: "item", name: file.name } as UploadItem,
      file,
      signal: new AbortController().signal,
      attempt: 2,
      resumeState: expired,
      onProgress: () => undefined,
      onChunkProgress: () => undefined,
      saveResumeState: (state: unknown) => saved.push(state)
    } satisfies UploadAdapterContext
    const result = await adapter.upload(context)
    expect(result.status).toBe("ready")
    expect(saved.slice(0, 2)).toMatchObject([null, { fileId: result.id, sent: false }])
    expect(view.sends).not.toContain("https://app.test/expired")
    await until(() => count(view.calls, "deleteFile") === 1)
  })

  it("only takes the app's subject types", () => {
    const view = setup()
    // @ts-expect-error Tickets aren't one of the app's subject types.
    expect(attachmentsAdapter(view.attachments, { subjectType: "ticket", subjectId: "t-1" }).name).toBe(
      "better-apps-attachments"
    )
  })
})

describe("uploadErrorOf", () => {
  const error = (code: string, status: number) => new BetterAppsClientError(code, `${code} happened.`, { status })

  it("keeps attachments' message, retrying what may pass later", () => {
    expect(uploadErrorOf(error("NETWORK_ERROR", 0))).toMatchObject({ code: "network", retryable: true })
    expect(uploadErrorOf(error("INTERNAL_ERROR", 503))).toMatchObject({ code: "http", status: 503, retryable: true })
    expect(uploadErrorOf(error("RATE_LIMITED", 429))).toMatchObject({ code: "http", retryable: true })
    expect(uploadErrorOf(error("CONFLICT", 409))).toMatchObject({ code: "http", retryable: true })
    expect(uploadErrorOf(error("FORBIDDEN", 403))).toMatchObject({
      code: "rejected",
      retryable: false,
      message: "FORBIDDEN happened."
    })
    expect(uploadErrorOf(error("ABORTED", 0))).toMatchObject({ code: "aborted" })
  })

  it("passes UploadCN's own errors through, and wraps anything else", () => {
    const own = new UploadError("Offline.", { code: "offline" })
    expect(uploadErrorOf(own)).toBe(own)
    expect(uploadErrorOf(new Error("Odd."))).toBeInstanceOf(UploadError)
  })
})

describe("uploadLimits", () => {
  const settings = { contentTypes: ["image/*"], maxSize: 1000, maxFiles: 3 }

  it("checks the types, the size and the places left on a record", () => {
    expect(uploadLimits(null)).toEqual({})
    expect(uploadLimits(settings)).toEqual({ accept: ["image/*"], maxSize: 1000 })
    expect(uploadLimits(settings, { existing: 2 })).toEqual({ accept: ["image/*"], maxSize: 1000, maxFiles: 1 })
    expect(uploadLimits(settings, { existing: 5 })).toMatchObject({ maxFiles: 0 })
    expect(uploadLimits({ contentTypes: null, maxSize: 10, maxFiles: null }, { existing: 1 })).toEqual({ maxSize: 10 })
  })
})
