import { describe, expect, it } from "vite-plus/test"
import { allowsType, cleanContentType, cleanName, contentDisposition, isInline } from "./files.js"
import { parseRange } from "./routes.js"
import { memoryStorage } from "./storage.js"
import { createSigner } from "./tokens.js"

describe("cleanName", () => {
  it("keeps the last part of a path, without control characters", () => {
    expect(cleanName("C:\\Users\\ada\\report.pdf")).toBe("report.pdf")
    expect(cleanName("../../etc/passwd")).toBe("passwd")
    expect(cleanName(" a\u0000b\u007f.txt ")).toBe("ab.txt")
    expect(cleanName("..")).toBe("file")
    expect(cleanName("folder/")).toBe("file")
  })

  it("shortens long names and keeps their extension", () => {
    const long = `${"a".repeat(300)}.pdf`
    expect(cleanName(long)).toHaveLength(255)
    expect(cleanName(long).endsWith(".pdf")).toBe(true)
    expect(cleanName("b".repeat(300))).toHaveLength(255)
  })
})

describe("media types", () => {
  it("are lower case without parameters", () => {
    expect(cleanContentType("Text/HTML; charset=utf-8")).toBe("text/html")
    expect(cleanContentType("nonsense")).toBeNull()
    expect(cleanContentType("")).toBeNull()
  })

  it("match exactly, by kind, or any", () => {
    expect(allowsType(null, "image/png")).toBe(true)
    expect(allowsType(["image/*"], "image/png")).toBe(true)
    expect(allowsType(["application/pdf"], "image/png")).toBe(false)
    expect(allowsType(["*/*"], "font/woff2")).toBe(true)
  })

  it("decide which files show in place", () => {
    expect(["image/png", "video/mp4", "audio/mpeg", "application/pdf"].map(isInline)).toEqual([true, true, true, true])
    expect(["image/svg+xml", "text/html", "application/zip"].map(isInline)).toEqual([false, false, false])
  })
})

describe("contentDisposition", () => {
  it("sends the name encoded, with an ASCII fallback", () => {
    expect(contentDisposition('Résumé "final".pdf', false)).toBe(
      `attachment; filename="R_sum_ _final_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf`
    )
  })
})

describe("parseRange", () => {
  it("reads one range, and serves the whole file for several or none", () => {
    expect(parseRange(null, 10)).toBe("all")
    expect(parseRange("bytes=0-", 10)).toEqual({ offset: 0 })
    expect(parseRange("bytes=2-4", 10)).toEqual({ offset: 2, length: 3 })
    expect(parseRange("bytes=8-20", 10)).toEqual({ offset: 8, length: 2 })
    expect(parseRange("bytes=-20", 10)).toEqual({ suffix: 10 })
    expect(parseRange("bytes=5-2", 10)).toBe("all")
    expect(parseRange("bytes=0-1,3-4", 10)).toBe("all")
    expect(parseRange("bytes=-", 10)).toBe("all")
    expect(parseRange("bytes=10-", 10)).toBeNull()
    expect(parseRange("bytes=-0", 10)).toBeNull()
  })
})

describe("tokens", () => {
  it("sign download URLs for one file until they expire", async () => {
    const signer = createSigner("x".repeat(32))
    const signature = await signer.sign("f1", 2000)
    expect(await signer.verify("f1", 2000, signature, 1_000_000)).toBe(true)
    expect(await signer.verify("f2", 2000, signature, 1_000_000)).toBe(false)
    expect(await signer.verify("f1", 2000, signature, 3_000_000)).toBe(false)
    expect(await signer.verify("f1", Number.NaN, signature, 0)).toBe(false)
    expect(await signer.verify("f1", 2000, "not base64url!", 1_000_000)).toBe(false)
  })
})

describe("memoryStorage", () => {
  it("stores bytes, strings and streams, and refuses a body of the wrong length", async () => {
    const storage = memoryStorage()
    await storage.put("a", new TextEncoder().encode("abc"), { size: 3, contentType: "text/plain" })
    await storage.put("b", new TextEncoder().encode("abc").buffer, { size: 3, contentType: "text/plain" })
    await storage.put("c", new Response("abc").body as ReadableStream<Uint8Array>, {
      size: 3,
      contentType: "text/plain"
    })
    await expect(storage.put("d", "abcd", { size: 3, contentType: "text/plain" })).rejects.toThrow(/4 bytes/)
    expect([...storage.objects.keys()]).toEqual(["a", "b", "c"])
    expect(await storage.get("missing")).toBeNull()
    expect(await storage.head("missing")).toBeNull()
    const past = await storage.get("a", { range: { offset: 5 } })
    expect(past).toMatchObject({ range: { offset: 0, length: 0 } })
  })

  it("answers signed uploads only as signed", async () => {
    const storage = memoryStorage({ signedUploads: true })
    const signed = await storage.createUploadUrl?.("k", { contentType: "text/plain", size: 3, expiresIn: 60 })
    const url = signed?.url as string
    const put = (headers: Record<string, string>) =>
      storage.handle(new Request(url, { method: "PUT", headers, body: "abc" }))
    expect((await put({ "content-type": "image/png", "content-length": "3" })).status).toBe(403)
    expect((await storage.handle(new Request(url, { method: "DELETE" }))).status).toBe(403)
    expect((await put({ "content-type": "text/plain", "content-length": "3" })).status).toBe(200)
    expect(storage.objects.has("k")).toBe(true)
    expect((await storage.handle(new Request("https://storage.test/other", { method: "PUT" }))).status).toBe(403)
  })
})
