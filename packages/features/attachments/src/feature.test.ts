import { describe, expect, it, vi } from "vite-plus/test"
import { inv1, invoices, secret, setup, vanishing } from "../test/app.js"
import { attachmentModel, attachments, fileModel, memoryStorage } from "./index.js"

/** A call from a signed-out visitor: a request with no sign-in, rather than trusted server code. */
const signedOut = () => ({ request: new Request("https://app.test") })

const text = (body: string) => ({ name: "notes.txt", contentType: "text/plain", bytes: body })

describe("uploads onto a record", () => {
  it("take the bytes through the server's route, then list and download the file", async () => {
    const { api, as, upload, request, events } = setup()
    const { file, attachment } = await upload("bob", inv1, text("hello"))
    expect(file).toMatchObject({ name: "notes.txt", contentType: "text/plain", size: 5, status: "ready", owner: null })
    expect(attachment).toMatchObject({ id: file.id, position: 0, attachedBy: "bob" })
    const listed = await api.listFiles({ subjectType: "invoice", subjectIds: ["inv-1", "inv-2"] }, as("cy"))
    expect(listed["inv-1"]?.map((entry) => entry.id)).toEqual([file.id])
    expect(listed["inv-2"]).toEqual([])
    const response = await request(file.url as string, {}, "cy")
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("hello")
    expect(response.headers.get("content-type")).toBe("text/plain")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-security-policy")).toBe("sandbox")
    expect(response.headers.get("cache-control")).toBe("private, no-cache")
    expect(response.headers.get("content-disposition")).toBe(`inline; filename="notes.txt"; filename*=UTF-8''notes.txt`)
    expect(events("file.uploaded")).toHaveLength(1)
    expect(events("attachment.added")[0]?.data).toMatchObject({
      subjectType: "invoice",
      subjectId: "inv-1",
      orgId: "acme"
    })
  })

  it("go straight to storage when it signs uploads", async () => {
    const { upload, storage } = setup({}, { signedUploads: true })
    const { file } = await upload("bob", inv1, text("direct"))
    expect(storage.objects.get(`attachments/${file.id}`)?.contentType).toBe("text/plain")
  })

  it("check the type, the size and how many files a record holds", async () => {
    const { api, as, upload } = setup()
    const create = (input: { contentType: string; size: number }) =>
      api.createUpload({ ...inv1, name: "x", ...input }, as("bob"))
    await expect(create({ contentType: "application/zip", size: 3 })).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(create({ contentType: "not a type", size: 3 })).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(create({ contentType: "image/png", size: 1001 })).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" })
    for (const index of [1, 2, 3]) {
      await upload("bob", inv1, text(`file ${index}`))
    }
    await expect(upload("bob", inv1, text("one too many"))).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
  })

  it("refuse people who can't see the record or can't add files to it", async () => {
    const { api, as } = setup()
    const input = { name: "x.txt", contentType: "text/plain", size: 1 }
    await expect(api.createUpload({ ...inv1, ...input }, signedOut())).rejects.toMatchObject({
      code: "UNAUTHENTICATED"
    })
    await expect(api.createUpload({ ...inv1, ...input }, as("gus"))).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      api.createUpload({ subjectType: "invoice", subjectId: "inv-locked", ...input }, as("bob"))
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("answer 413 over HTTP for a file that's too large", async () => {
    const { app, identity } = setup()
    const response = await app.handler(
      new Request("https://app.test/api/apps/attachments/createUpload", {
        method: "POST",
        headers: { "content-type": "application/json", ...identity.headers("bob") },
        body: JSON.stringify({ ...inv1, name: "big.png", contentType: "image/png", size: 5000 })
      })
    )
    expect(response.status).toBe(413)
  })
})

describe("the upload route", () => {
  it("refuses a wrong token, type or length, and an expired upload", async () => {
    const { api, as, send, request } = setup({ uploadTtl: 1 })
    const created = await api.createUpload({ ...inv1, name: "a.txt", contentType: "text/plain", size: 3 }, as("bob"))
    const wrongToken = created.upload.url.replace(/token=[^&]+/, "token=nope")
    expect((await send({ ...created.upload, url: wrongToken }, "abc")).status).toBe(404)
    expect((await send({ ...created.upload, headers: { "content-type": "image/png" } }, "abc")).status).toBe(400)
    expect((await send(created.upload, "abcd")).status).toBe(400)
    expect((await request(created.upload.url, { method: "GET" })).status).toBe(405)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect((await send(created.upload, "abc")).status).toBe(404)
  })

  it("counts a body without a length, refusing one longer or shorter than the upload said", async () => {
    const { api, as, request, storage } = setup()
    const created = await api.createUpload({ ...inv1, name: "a.txt", contentType: "text/plain", size: 3 }, as("bob"))
    const chunked = async (...chunks: string[]) =>
      request(created.upload.url, {
        method: "PUT",
        headers: created.upload.headers,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(new TextEncoder().encode(chunk))
            }
            controller.close()
          }
        }),
        duplex: "half"
      } as RequestInit)
    expect((await chunked("ab", "cd")).status).toBe(413)
    expect((await chunked("a", "b")).status).toBe(400)
    expect(storage.objects.size).toBe(0)
    expect((await chunked("a", "bc")).status).toBe(204)
    expect(await api.completeUpload({ fileId: created.file.id }, as("bob"))).toMatchObject({ file: { size: 3 } })
  })

  it("keeps finishing honest: nothing sent yet, or bytes that don't match", async () => {
    const { api, as, storage } = setup()
    const created = await api.createUpload({ ...inv1, name: "a.txt", contentType: "text/plain", size: 3 }, as("bob"))
    await expect(api.completeUpload({ fileId: created.file.id }, as("bob"))).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(api.completeUpload({ fileId: created.file.id }, as("cy"))).rejects.toMatchObject({ code: "NOT_FOUND" })
    await storage.put(`attachments/${created.file.id}`, "abcd", { size: 4, contentType: "text/plain" })
    await expect(api.completeUpload({ fileId: created.file.id }, as("bob"))).rejects.toMatchObject({
      code: "INVALID_INPUT"
    })
    expect(storage.objects.size).toBe(0)
  })

  it("checks again that the person can add files when the upload finishes", async () => {
    const { api, as, send, storage, count } = setup()
    invoices.set("inv-closing", { orgId: "acme" })
    try {
      const target = { subjectType: "invoice", subjectId: "inv-closing" } as const
      const created = await api.createUpload(
        { ...target, name: "a.txt", contentType: "text/plain", size: 3 },
        as("bob")
      )
      expect((await send(created.upload, "abc")).status).toBe(204)
      invoices.set("inv-closing", { orgId: "acme", locked: true })
      await expect(api.completeUpload({ fileId: created.file.id }, as("bob"))).rejects.toMatchObject({
        code: "FORBIDDEN"
      })
      expect([count(attachmentModel), count(fileModel), storage.objects.size]).toEqual([0, 0, 0])
    } finally {
      invoices.delete("inv-closing")
    }
  })

  it("finishes a file once, and again returns it as it is", async () => {
    const { api, as, upload } = setup()
    const { file } = await upload("bob", inv1)
    const again = await api.completeUpload({ fileId: file.id }, as("bob"))
    expect(again).toMatchObject({ file: { id: file.id, status: "ready" }, attachment: null })
  })

  it("finishes a file once when it's finished twice at the same time", async () => {
    const { api, as, send, events, count } = setup()
    for (const target of [inv1, { owner: "user" as const }]) {
      const created = await api.createUpload(
        { ...target, name: "a.txt", contentType: "text/plain", size: 3 },
        as("bob")
      )
      await send(created.upload, "abc")
      const finish = async () => api.completeUpload({ fileId: created.file.id }, as("bob"))
      const results = await Promise.all([finish(), finish()])
      expect(results.map((result) => result.file.status)).toEqual(["ready", "ready"])
    }
    expect(count(attachmentModel)).toBe(1)
    expect(events("attachment.added")).toHaveLength(1)
    expect(events("file.uploaded")).toHaveLength(2)
  })
})

describe("downloads", () => {
  it("serve parts, answer 304 and 416, and leave HEAD without a body", async () => {
    const { upload, request } = setup()
    const { file } = await upload("bob", inv1, text("0123456789"))
    const url = file.url as string
    const part = await request(url, { headers: { range: "bytes=2-4" } }, "bob")
    expect(part.status).toBe(206)
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10")
    expect(await part.text()).toBe("234")
    expect(await (await request(url, { headers: { range: "bytes=-3" } }, "bob")).text()).toBe("789")
    expect(await (await request(url, { headers: { range: "bytes=7-" } }, "bob")).text()).toBe("789")
    const past = await request(url, { headers: { range: "bytes=20-" } }, "bob")
    expect(past.status).toBe(416)
    expect(past.headers.get("content-range")).toBe("bytes */10")
    expect(await (await request(url, { headers: { range: "bytes=1-2,4-5" } }, "bob")).text()).toBe("0123456789")
    const etag = (await request(url, {}, "bob")).headers.get("etag") as string
    expect((await request(url, { headers: { "if-none-match": etag } }, "bob")).status).toBe(304)
    const head = await request(url, { method: "HEAD" }, "bob")
    expect(head.status).toBe(200)
    expect(head.headers.get("content-length")).toBe("10")
  })

  it("answer 404 to people who can't see the record, and to signed-out visitors", async () => {
    const { upload, request } = setup()
    const { file } = await upload("bob", inv1)
    expect((await request(file.url as string, {}, "gus")).status).toBe(404)
    expect((await request(file.url as string)).status).toBe(404)
    expect((await request(file.url as string, {}, "ada")).status).toBe(200)
  })

  it("serve files on public records to anyone", async () => {
    const { upload, request } = setup()
    const { file } = await upload("solo", { subjectType: "page", subjectId: "home" }, text("public"))
    expect(await (await request(file.url as string)).text()).toBe("public")
  })

  it("count access the request carries, such as a share link, for reads but not for writes", async () => {
    const { upload, request, api, as } = setup()
    const { file } = await upload("bob", inv1)
    const shared = { headers: { "x-share": "inv-1" } }
    expect((await request(file.url as string)).status).toBe(404)
    expect((await request(file.url as string, shared, "gus")).status).toBe(200)
    expect(await (await request(file.url as string, shared)).text()).toBe("hello")
    const asGus = { ...as("gus"), request: new Request("https://app.test", shared) }
    expect(await api.getFile({ fileId: file.id }, asGus)).toMatchObject({ id: file.id })
    await expect(api.detach({ ...inv1, fileId: file.id }, asGus)).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("work without sign-in through a signed URL until it expires", async () => {
    const { upload, request } = setup({ secret, downloadTtl: 1 })
    const { file } = await upload("bob", inv1)
    const url = file.url as string
    expect(url).toMatch(/\?expires=\d+&token=/)
    const response = await request(url)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, max-age=1")
    expect((await request(url.replace(/token=.+$/, "token=forged"))).status).toBe(404)
    await new Promise((resolve) => setTimeout(resolve, 2100))
    expect((await request(url)).status).toBe(404)
  })

  it("download files that could run script, and any file asked for as a download", async () => {
    const { upload, request } = setup()
    const { file } = await upload("bob", inv1, { name: "logo.svg", contentType: "image/svg+xml", bytes: "<svg/>" })
    expect((await request(file.url as string, {}, "bob")).headers.get("content-disposition")).toMatch(/^attachment;/)
    const { file: pdf } = await upload("bob", inv1, { name: "a.pdf", contentType: "application/pdf", bytes: "%PDF" })
    const response = await request(`${pdf.url}?download=1`, {}, "bob")
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/)
    expect(response.headers.get("content-security-policy")).toBeNull()
  })

  it("serve only the bytes confirmed when the upload finished", async () => {
    const { upload, request, storage } = setup({
      previews: { transform: () => new Response("preview", { headers: { "content-type": "image/webp" } }) }
    })
    const { file } = await upload("bob", inv1, { name: "a.png", contentType: "image/png", bytes: "png" })
    // A signed upload address still open takes bytes again, and can't be revoked.
    await storage.put(`attachments/${file.id}`, "PNG", { size: 3, contentType: "image/png" })
    const url = file.url as string
    for (const [path, init] of [
      [url, {}],
      [url, { method: "HEAD" }],
      [url, { headers: { range: "bytes=0-1" } }],
      [`${url}?w=100`, {}],
      [`${url}?w=100`, { method: "HEAD" }]
    ] as const) {
      expect((await request(path, init, "bob")).status).toBe(409)
    }
  })

  it("answer 304 for a preview without reading storage, and HEAD without making one", async () => {
    let made = 0
    const { upload, request, storage } = setup({
      previews: {
        widths: [100],
        transform: () => {
          made += 1
          return new Response("preview", { headers: { "content-type": "image/webp" } })
        }
      }
    })
    const { file } = await upload("bob", inv1, { name: "a.png", contentType: "image/png", bytes: "png" })
    const url = `${file.url}?w=100`
    const head = await request(url, { method: "HEAD" }, "bob")
    expect([head.status, head.headers.get("content-type"), made]).toEqual([200, null, 0])
    const etag = (await request(url, {}, "bob")).headers.get("etag") as string
    await storage.delete([`attachments/${file.id}`])
    expect((await request(url, { headers: { "if-none-match": etag } }, "bob")).status).toBe(304)
    expect(made).toBe(1)
  })

  it("make previews at the next width up with the app's transform", async () => {
    const widths: number[] = []
    const { upload, request } = setup({
      previews: {
        widths: [100, 400],
        transform: async ({ width, object }) => {
          widths.push(width)
          return new Response(`${width}:${await new Response(object.body).text()}`, {
            headers: { "content-type": "image/webp" }
          })
        }
      }
    })
    const { file } = await upload("bob", inv1, { name: "a.png", contentType: "image/png", bytes: "png" })
    const response = await request(`${file.url}?w=150`, {}, "bob")
    expect(await response.text()).toBe("400:png")
    expect(response.headers.get("content-type")).toBe("image/webp")
    expect(response.headers.get("etag")).toMatch(/-w400"$/)
    expect(await (await request(`${file.url}?w=9000`, {}, "bob")).text()).toBe("400:png")
    expect(widths).toEqual([400, 400])
    expect(await (await request(file.url as string, {}, "bob")).text()).toBe("png")
  })
})

describe("drafts", () => {
  const draft = { subjectType: "invoice", name: "a.txt", contentType: "text/plain", size: 3 } as const

  it("upload before their record exists and attach to it once it does", async () => {
    const { api, as, upload, events } = setup()
    const { file } = await upload("bob", { subjectType: "invoice" })
    expect(file.expiresAt).not.toBeNull()
    expect((await api.listFiles({ subjectType: "invoice", subjectIds: ["inv-2"] }, as("bob")))["inv-2"]).toEqual([])
    await expect(
      api.attach({ subjectType: "invoice", subjectId: "inv-2", fileIds: [file.id] }, as("cy"))
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    const { files } = await api.attach({ subjectType: "invoice", subjectId: "inv-2", fileIds: [file.id] }, as("bob"))
    expect(files[0]).toMatchObject({ id: file.id, expiresAt: null })
    expect(events("attachment.added")).toHaveLength(1)
    const again = await api.attach({ subjectType: "invoice", subjectId: "inv-2", fileIds: [file.id] }, as("bob"))
    expect(again.files).toEqual([])
    await expect(api.attach({ ...inv1, fileIds: [file.id] }, as("bob"))).rejects.toMatchObject({
      code: "INVALID_INPUT"
    })
  })

  it("stay on the record that wins when two records race for one", async () => {
    const { api, as, upload, events, count } = setup()
    const { file } = await upload("bob", { subjectType: "invoice" })
    const results = await Promise.allSettled([
      api.attach({ ...inv1, fileIds: [file.id] }, as("bob")),
      api.attach({ subjectType: "invoice", subjectId: "inv-2", fileIds: [file.id] }, as("bob"))
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"])
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } })
    expect([count(fileModel), count(attachmentModel)]).toEqual([1, 1])
    expect(await api.getFile({ fileId: file.id }, as("bob"))).toMatchObject({ status: "ready", expiresAt: null })
    expect(events("file.deleted")).toEqual([])
  })

  it("are capped for each person, with uploads under way and deleted ones still open", async () => {
    const { api, as, upload } = setup({ maxDrafts: 2 })
    const kept = await upload("bob", { subjectType: "invoice" })
    const pending = await api.createUpload(draft, as("bob"))
    await expect(api.createUpload(draft, as("bob"))).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
    await api.createUpload(draft, as("cy"))
    // A deleted upload's address still takes bytes until it closes, so it counts until then.
    await api.deleteFile({ fileId: pending.file.id }, as("bob"))
    await expect(api.createUpload(draft, as("bob"))).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
    // Files a record keeps don't count once they're attached.
    await api.attach({ ...inv1, fileIds: [kept.file.id] }, as("bob"))
    await upload("bob", inv1)
    await api.createUpload(draft, as("bob"))
    await expect(api.createUpload(draft, as("bob"))).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      vi.setSystemTime(Date.now() + 16 * 60_000)
      await expect(api.createUpload(draft, as("bob"))).resolves.toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it("keep the cap when uploads start at the same time", async () => {
    // Holds each upload at `canUpload` until all six have started, so they race for the last places.
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let waiting = 0
    const canUpload = async () => {
      waiting += 1
      if (waiting === 6) {
        release?.()
      }
      await gate
      return true
    }
    const { api, as, count } = setup({ maxDrafts: 2, subjects: { invoice: { canUpload } } })
    const input = { ...inv1, name: "a.txt", contentType: "text/plain", size: 3 }
    const results = await Promise.allSettled(Array.from({ length: 6 }, async () => api.createUpload(input, as("bob"))))
    const started = results.filter((result) => result.status === "fulfilled").length
    expect(started).toBeLessThanOrEqual(2)
    expect(count(fileModel)).toBe(started)
    for (const result of results.filter((each) => each.status === "rejected")) {
      expect(result).toMatchObject({ reason: { code: "LIMIT_EXCEEDED" } })
    }
  })

  it("are seen only by their uploader until they're attached", async () => {
    const { api, as, upload } = setup()
    const { file } = await upload("bob", { subjectType: "invoice" })
    expect((await api.getFile({ fileId: file.id }, as("bob"))).id).toBe(file.id)
    await expect(api.getFile({ fileId: file.id }, as("cy"))).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("expire, and the sweep removes them with uploads that never finished", async () => {
    const { api, as, upload, storage, count, events } = setup({ draftTtl: 1, uploadTtl: 1 })
    const { file } = await upload("bob", { subjectType: "invoice" })
    await api.createUpload({ ...inv1, name: "a.txt", contentType: "text/plain", size: 3 }, as("bob"))
    const kept = await upload("bob", inv1)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await expect(api.attach({ ...inv1, fileIds: [file.id] }, as("bob"))).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await api.sweep()).toEqual({ removed: 2, done: true })
    expect(count(fileModel)).toBe(1)
    expect([...storage.objects.keys()]).toEqual([`attachments/${kept.file.id}`])
    expect(events("file.deleted").map((event) => (event.data as { reason: string }).reason)).toEqual(["expired"])
    expect(await api.sweep()).toEqual({ removed: 0, done: true })
  })

  it("can be cancelled by their uploader", async () => {
    const { api, as, upload, storage } = setup()
    const { file } = await upload("bob", { subjectType: "invoice" })
    await expect(api.deleteFile({ fileId: file.id }, as("cy"))).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(await api.deleteFile({ fileId: file.id }, as("bob"))).toEqual({ deleted: true })
    expect(storage.objects.size).toBe(0)
    expect(await api.deleteFile({ fileId: file.id }, as("bob"))).toEqual({ deleted: false })
  })
})

describe("deleted files", () => {
  it("keep their row until their upload address closed, then the sweep deletes late bytes too", async () => {
    const { api, as, send, storage, database } = setup({}, { signedUploads: true })
    const rows = () =>
      (database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${fileModel}`).get() as { count: number }).count
    const created = await api.createUpload({ ...inv1, name: "a.txt", contentType: "text/plain", size: 3 }, as("bob"))
    expect(await api.deleteFile({ fileId: created.file.id }, as("bob"))).toEqual({ deleted: true })
    // The signed address can't be revoked, so bytes still arrive.
    expect((await send(created.upload, "abc")).status).toBe(200)
    await expect(api.completeUpload({ fileId: created.file.id }, as("bob"))).rejects.toMatchObject({
      code: "NOT_FOUND"
    })
    expect(await api.sweep()).toEqual({ removed: 0, done: true })
    expect([rows(), storage.objects.size]).toEqual([1, 1])
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      vi.setSystemTime(Date.now() + 2 * 60 * 60_000)
      expect(await api.sweep()).toEqual({ removed: 1, done: true })
    } finally {
      vi.useRealTimers()
    }
    expect([rows(), storage.objects.size]).toEqual([0, 0])
  })
})

describe("taking files off and reordering", () => {
  it("lets the person who attached a file take it off, and deletes a file its record kept", async () => {
    const { api, as, upload, storage, count, events } = setup()
    const { file } = await upload("bob", inv1)
    await expect(api.detach({ ...inv1, fileId: file.id }, as("cy"))).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(await api.detach({ ...inv1, fileId: file.id }, as("bob"))).toEqual({ removed: true })
    expect(await api.detach({ ...inv1, fileId: file.id }, as("bob"))).toEqual({ removed: false })
    expect(storage.objects.size).toBe(0)
    expect(count(fileModel)).toBe(0)
    expect(events("attachment.removed")[0]?.data).toMatchObject({ reason: "detached" })
    expect(events("file.deleted")[0]?.data).toMatchObject({ reason: "detached" })
  })

  it("lets moderators and trusted server code take anyone's off", async () => {
    const { api, as, upload, events } = setup()
    const first = await upload("bob", inv1)
    const second = await upload("bob", inv1)
    expect(await api.detach({ ...inv1, fileId: first.file.id }, as("ada"))).toEqual({ removed: true })
    expect(await api.detach({ ...inv1, fileId: second.file.id })).toEqual({ removed: true })
    expect(events("attachment.removed").map((event) => (event.data as { reason: string }).reason)).toEqual([
      "moderated",
      "moderated"
    ])
  })

  it("reorders a record's files", async () => {
    const { api, as, upload, events } = setup()
    const ids = []
    for (const body of ["a", "b", "c"]) {
      ids.push((await upload("bob", inv1, text(body))).file.id)
    }
    const order = [ids[2], ids[0], ids[1]] as string[]
    await api.reorder({ ...inv1, fileIds: order }, as("cy"))
    const listed = await api.listFiles({ subjectType: "invoice", subjectIds: ["inv-1"] }, as("bob"))
    expect(listed["inv-1"]?.map((file) => file.id)).toEqual(order)
    expect(events("attachments.reordered")).toHaveLength(1)
    await api.reorder({ ...inv1, fileIds: order }, as("cy"))
    expect(events("attachments.reordered")).toHaveLength(1)
    await expect(api.reorder({ ...inv1, fileIds: order.slice(1) }, as("cy"))).rejects.toMatchObject({
      code: "CONFLICT"
    })
  })

  it("fills the place a removed file left", async () => {
    const { api, as, upload } = setup()
    const files = []
    for (const body of ["a", "b", "c"]) {
      files.push((await upload("bob", inv1, text(body))).file)
    }
    await api.detach({ ...inv1, fileId: files[0]?.id as string }, as("bob"))
    const { attachment } = await upload("bob", inv1, text("d"))
    expect(attachment?.position).toBe(3)
  })
})

describe("files on their own", () => {
  it("belong to the organization by default, or to their uploader", async () => {
    const { api, as, upload } = setup()
    const org = await upload("bob", {})
    const mine = await upload("bob", { owner: "user" })
    const solo = await upload("solo", {})
    expect([org.file.owner, mine.file.owner, solo.file.owner]).toEqual(["org:acme", "user:bob", "user:solo"])
    await expect(upload("solo", { owner: "org" })).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect((await api.getFile({ fileId: org.file.id }, as("cy"))).id).toBe(org.file.id)
    await expect(api.getFile({ fileId: mine.file.id }, as("cy"))).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(api.getFile({ fileId: mine.file.id }, signedOut())).rejects.toMatchObject({ code: "UNAUTHENTICATED" })
    const page = await api.listOwnFiles({ owner: "org", limit: 1 }, as("cy"))
    expect(page.files.map((file) => file.id)).toEqual([org.file.id])
    expect(page.cursor).toBeNull()
    const own = await api.listOwnFiles({ owner: "user" }, as("bob"))
    expect(own.files.map((file) => file.id)).toEqual([mine.file.id])
  })

  it("go with their owner to another organization, but not with anyone else", async () => {
    const { api, as, identity, upload } = setup()
    const mine = await upload("bob", { owner: "user" })
    const ours = await upload("bob", {})
    const globex = { subjectType: "invoice", subjectId: "inv-globex" } as const
    // Gus sees Bob's file on a public page, but it isn't his to take to his organization.
    await api.attach({ subjectType: "page", subjectId: "about", fileIds: [mine.file.id] }, as("bob"))
    await expect(api.attach({ ...globex, fileIds: [mine.file.id] }, as("gus"))).rejects.toMatchObject({
      code: "INVALID_INPUT"
    })
    const elsewhere = { actor: { ...identity.actor("bob"), orgId: "globex" } }
    const { files } = await api.attach({ ...globex, fileIds: [mine.file.id] }, elsewhere)
    expect(files.map((file) => file.id)).toEqual([mine.file.id])
    await expect(api.attach({ ...globex, fileIds: [ours.file.id] }, elsewhere)).rejects.toMatchObject({
      code: "NOT_FOUND"
    })
  })

  it("page newest first", async () => {
    const { api, as, upload } = setup()
    const ids = []
    for (const body of ["a", "b", "c"]) {
      ids.push((await upload("bob", { owner: "user" }, text(body))).file.id)
    }
    const first = await api.listOwnFiles({ owner: "user", limit: 2 }, as("bob"))
    const second = await api.listOwnFiles({ owner: "user", limit: 2, cursor: first.cursor as string }, as("bob"))
    expect([...first.files, ...second.files].map((file) => file.id).sort()).toEqual([...ids].sort())
    expect(second.cursor).toBeNull()
    await expect(api.listOwnFiles({ owner: "user", cursor: "nope" }, as("bob"))).rejects.toMatchObject({
      code: "INVALID_INPUT"
    })
  })

  it("go on several records and stay when taken off", async () => {
    const { api, as, upload, storage } = setup()
    const { file } = await upload("bob", {}, { name: "logo.png", contentType: "image/png", bytes: "logo" })
    await api.attach({ ...inv1, fileIds: [file.id] }, as("cy"))
    await api.attach({ subjectType: "invoice", subjectId: "inv-2", fileIds: [file.id] }, as("cy"))
    expect(await api.detach({ ...inv1, fileId: file.id }, as("cy"))).toEqual({ removed: true })
    expect(storage.objects.size).toBe(1)
    await expect(
      api.attach({ subjectType: "invoice", subjectId: "inv-globex", fileIds: [file.id] }, as("gus"))
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(api.deleteFile({ fileId: file.id }, as("cy"))).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(await api.deleteFile({ fileId: file.id }, as("ada"))).toEqual({ deleted: true })
    expect((await api.listFiles({ subjectType: "invoice", subjectIds: ["inv-2"] }, as("cy")))["inv-2"]).toEqual([])
    expect(storage.objects.size).toBe(0)
  })

  it("need `standalone`, and a file on a record is removed from it rather than deleted", async () => {
    const { api, as, upload } = setup({ standalone: undefined })
    await expect(api.createUpload({ name: "a", contentType: "text/plain", size: 1 }, as("bob"))).rejects.toMatchObject({
      code: "INVALID_INPUT"
    })
    await expect(api.getSettings({}, as("bob"))).rejects.toMatchObject({ code: "INVALID_INPUT" })
    const { file } = await upload("bob", inv1)
    await expect(api.deleteFile({ fileId: file.id }, as("bob"))).rejects.toMatchObject({ code: "INVALID_INPUT" })
  })

  it("can be refused by `canUpload`", async () => {
    const { api, as } = setup({ standalone: { canUpload: (actor) => actor.roles.includes("admin") } })
    await expect(api.createUpload({ name: "a", contentType: "text/plain", size: 1 }, as("bob"))).rejects.toMatchObject({
      code: "FORBIDDEN"
    })
  })
})

describe("records that change", () => {
  it("lose their files a page at a time when removed", async () => {
    const { api, upload, storage, events } = setup()
    await upload("bob", inv1)
    await upload("bob", inv1)
    expect(await api.removeSubject(inv1)).toEqual({ removed: 2, done: true })
    expect(storage.objects.size).toBe(0)
    expect(events("subject.changed")).toHaveLength(1)
    expect(events("subject.removed")).toHaveLength(1)
  })

  it("take their files along when they move, once server code moves them", async () => {
    const { api, as, upload } = setup()
    const { file } = await upload("bob", inv1)
    invoices.set("inv-1", { orgId: "globex" })
    try {
      expect((await api.listFiles({ subjectType: "invoice", subjectIds: ["inv-1"] }, as("gus")))["inv-1"]).toEqual([])
      expect(await api.moveSubject({ ...inv1, toOrgId: "globex" })).toEqual({ moved: 1, done: true })
      const listed = await api.listFiles({ subjectType: "invoice", subjectIds: ["inv-1"] }, as("gus"))
      expect(listed["inv-1"]?.map((entry) => [entry.id, entry.orgId])).toEqual([[file.id, "globex"]])
    } finally {
      invoices.set("inv-1", { orgId: "acme" })
    }
  })

  it("lose a person's own files and drafts when the person is removed", async () => {
    const { api, upload, storage, events } = setup()
    await upload("bob", { owner: "user" })
    await upload("bob", { subjectType: "invoice" })
    const onRecord = await upload("bob", inv1)
    expect(await api.removeUser({ userId: "bob" })).toEqual({ removed: 2, done: true })
    expect([...storage.objects.keys()]).toEqual([`attachments/${onRecord.file.id}`])
    expect(events("user.removed")).toHaveLength(1)
  })

  it("lose a person's unfinished uploads when the person is removed, an organization's too, a page a call", async () => {
    const { api, as, upload, count } = setup()
    const input = { name: "x.txt", contentType: "text/plain", size: 1 }
    for (let index = 0; index < 20; index += 1) {
      await api.createUpload({ owner: "org", ...input }, as("bob"))
    }
    await api.createUpload({ owner: "user", ...input }, as("bob"))
    const finished = await upload("bob", { owner: "org" })
    expect(await api.removeUser({ userId: "bob" })).toEqual({ removed: 20, done: false })
    expect(await api.removeUser({ userId: "bob" })).toEqual({ removed: 1, done: true })
    expect(count(fileModel)).toBe(1)
    expect((await api.getFile({ fileId: finished.file.id }, as("cy"))).id).toBe(finished.file.id)
  })

  it("take back an attachment whose record went away while it was saved", async () => {
    const { api, as, upload, count, events } = setup()
    const { file } = await upload("bob", { subjectType: "invoice" })
    vanishing.set("inv-2", 1)
    try {
      await expect(
        api.attach({ subjectType: "invoice", subjectId: "inv-2", fileIds: [file.id] }, as("bob"))
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    } finally {
      vanishing.clear()
    }
    expect([count(fileModel), count(attachmentModel)]).toEqual([0, 0])
    expect(events("attachment.removed")[0]?.data).toMatchObject({ reason: "withdrawn" })
  })
})

describe("client events", () => {
  it("tell viewers who can see the record that its files changed", async () => {
    const { api, as, upload, events, identity } = setup()
    await upload("bob", inv1)
    const [added] = events("attachment.added")
    const event = added as NonNullable<typeof added>
    expect(await api.toClientEvent({ event, viewer: identity.actor("cy") })).toEqual({
      id: event.id,
      type: "subject.changed",
      ...inv1
    })
    expect(await api.toClientEvents({ event, viewers: [identity.actor("gus"), null, identity.actor("ada")] })).toEqual([
      null,
      null,
      { id: event.id, type: "subject.changed", ...inv1 }
    ])
    expect(
      await api.toClientEvent({ event: events("file.uploaded")[0] as typeof event, viewer: as("cy").actor })
    ).toBeNull()
  })
})

describe("the file subject type", () => {
  it("lets other features attach to files people can see", async () => {
    const { app, identity, upload } = setup()
    const { file } = await upload("bob", inv1)
    const ref = { subjectType: "attachments.file", subjectId: file.id }
    expect(await app.subjects.canView(identity.actor("cy"), ref)).toBe(true)
    expect(await app.subjects.canView(identity.actor("gus"), ref)).toBe(false)
    expect(await app.subjects.isPublic(ref)).toBe(false)
    expect(await app.subjects.getOrgId(ref)).toBe("acme")
  })
})

describe("options", () => {
  const storage = memoryStorage()

  it("are checked when the feature is created", () => {
    expect(() => attachments({ storage })).toThrow(/at least one subject type/)
    expect(() => attachments({ storage, subjects: { invoice: { maxFiles: 31 } } })).toThrow(/maxFiles/)
    expect(() => attachments({ storage, subjects: { invoice: { contentTypes: ["pdf"] } } })).toThrow(/media type/)
    expect(() => attachments({ storage, subjects: { invoice: {} }, path: "/" })).toThrow(/path/)
    expect(() => attachments({ storage, subjects: { invoice: {} }, baseUrl: "https://a.test/x" })).toThrow(/origin/)
    expect(() => attachments({ storage, subjects: { invoice: {} }, secret: "short" })).toThrow(/32 characters/)
    expect(() => attachments({ storage, subjects: { invoice: {} }, uploadTtl: 0 })).toThrow(/uploadTtl/)
    expect(() => attachments({ storage, subjects: { invoice: {} }, maxSize: 0 })).toThrow(/maxSize/)
    expect(() => attachments({ storage, subjects: { invoice: {} }, maxDrafts: 0 })).toThrow(/maxDrafts/)
    expect(() =>
      attachments({ storage, subjects: { invoice: {} }, previews: { widths: [0], transform: () => new Response() } })
    ).toThrow(/widths/)
  })

  it("subscribe to comments only when comments' records have files", () => {
    expect(attachments({ storage, subjects: { invoice: {} } }).on).toBeUndefined()
    expect(Object.keys(attachments({ storage, subjects: { "comments.comment": {} } }).on?.comments ?? {})).toEqual([
      "comment.deleted",
      "thread.deleted",
      "thread.moved"
    ])
  })

  it("return absolute URLs with a base URL, and routes at the path", async () => {
    const feature = attachments({ storage, subjects: { invoice: {} }, path: "/files/", baseUrl: "https://cdn.test" })
    expect(feature.routes.upload.path).toBe("/files/uploads/:fileId")
    expect(feature.routes.download.path).toBe("/files/files/:fileId/:name")
    const { api, as } = setup({ baseUrl: "https://cdn.test" })
    const created = await api.createUpload(
      { ...inv1, name: "a b.txt", contentType: "Text/Plain; charset=utf-8", size: 1 },
      as("bob")
    )
    expect(created.upload.url).toMatch(/^https:\/\/cdn\.test\/api\/apps\/attachments\/uploads\//)
    expect(created.file.contentType).toBe("text/plain")
  })

  it("report the limits for a picker", async () => {
    const { api, as } = setup()
    expect(await api.getSettings({ subjectType: "invoice" }, as("bob"))).toEqual({
      contentTypes: ["image/*", "application/pdf", "text/plain"],
      maxSize: 1000,
      maxFiles: 3
    })
    expect(await api.getSettings({}, as("bob"))).toEqual({
      contentTypes: null,
      maxSize: 25 * 1024 * 1024,
      maxFiles: null
    })
    await expect(api.getSettings({ subjectType: "nope" as "invoice" }, as("bob"))).rejects.toMatchObject({
      code: "INVALID_INPUT"
    })
  })
})

describe("tables", () => {
  it("hold one row per file and per attachment", async () => {
    const { upload, count } = setup()
    await upload("bob", inv1)
    expect([count(fileModel), count(attachmentModel)]).toEqual([1, 1])
  })
})
