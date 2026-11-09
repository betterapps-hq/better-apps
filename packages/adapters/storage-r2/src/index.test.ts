import { describe, expect, it } from "vite-plus/test"
import { presign, r2Storage, type R2BucketLike, type R2ObjectLike, type R2RangeLike } from "./index.js"

describe("presign", () => {
  it("matches AWS's published example of a presigned URL", async () => {
    // From "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)" in the Amazon S3 docs.
    const url = await presign({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      credentials: {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      },
      region: "us-east-1",
      service: "s3",
      expiresIn: 86400,
      now: new Date("2013-05-24T00:00:00Z")
    })
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
    )
  })

  it("lasts from a second to a week", async () => {
    const input = {
      method: "PUT",
      url: "https://a.test/b",
      credentials: { accessKeyId: "a", secretAccessKey: "b" },
      region: "auto",
      service: "s3"
    }
    await expect(presign({ ...input, expiresIn: 0 })).rejects.toThrow(/a week/)
    await expect(presign({ ...input, expiresIn: 604_801 })).rejects.toThrow(/a week/)
  })
})

/** An R2 bucket in memory, with the binding's ranges and conditions. */
function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string | undefined; uploaded: Date }>()
  const deleted: string[][] = []
  const info = (key: string, range?: R2RangeLike): R2ObjectLike => {
    const object = objects.get(key) as { bytes: Uint8Array; contentType?: string; uploaded: Date }
    return {
      key,
      size: object.bytes.length,
      etag: `etag-${object.bytes.length}`,
      uploaded: object.uploaded,
      httpMetadata: { contentType: object.contentType },
      ...(range ? { range } : {})
    }
  }
  const bucket: R2BucketLike = {
    async put(key, value, options) {
      const bytes = new Uint8Array(await new Response(value as ConstructorParameters<typeof Response>[0]).arrayBuffer())
      objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType, uploaded: new Date(0) })
      return info(key)
    },
    async get(key, options) {
      if (!objects.has(key)) {
        return null
      }
      const object = info(key, options?.range)
      if (options?.onlyIf?.etagDoesNotMatch === object.etag) {
        return object
      }
      const { bytes } = objects.get(key) as { bytes: Uint8Array }
      const range = options?.range
      let part = bytes
      if (range && "suffix" in range) {
        part = bytes.slice(bytes.length - range.suffix)
      } else if (range) {
        part = bytes.slice(
          range.offset ?? 0,
          range.length === undefined ? undefined : (range.offset ?? 0) + range.length
        )
      }
      return { ...object, body: new Response(part).body as ReadableStream<Uint8Array> }
    },
    async head(key) {
      return objects.has(key) ? info(key) : null
    },
    async delete(keys) {
      const list = Array.isArray(keys) ? keys : [keys]
      deleted.push(list)
      for (const key of list) {
        objects.delete(key)
      }
    }
  }
  return { bucket, objects, deleted }
}

describe("r2Storage", () => {
  it("stores, reads, ranges and deletes objects through the binding", async () => {
    const { bucket } = fakeBucket()
    const storage = r2Storage({ bucket })
    expect(storage.createUploadUrl).toBeUndefined()
    const stored = await storage.put("attachments/a", new Response("0123456789").body as ReadableStream<Uint8Array>, {
      size: 10,
      contentType: "text/plain"
    })
    expect(stored).toMatchObject({ key: "attachments/a", size: 10, contentType: "text/plain", etag: "etag-10" })
    expect(await storage.head("attachments/a")).toMatchObject({ size: 10 })
    const whole = await storage.get("attachments/a")
    expect(await new Response((whole as { body: ReadableStream }).body).text()).toBe("0123456789")
    const part = await storage.get("attachments/a", { range: { offset: 2, length: 3 } })
    expect(part).toMatchObject({ range: { offset: 2, length: 3 } })
    expect(await new Response((part as { body: ReadableStream }).body).text()).toBe("234")
    expect(await storage.get("attachments/a", { range: { suffix: 4 } })).toMatchObject({
      range: { offset: 6, length: 4 }
    })
    expect(await storage.get("attachments/a", { range: { offset: 7 } })).toMatchObject({
      range: { offset: 7, length: 3 }
    })
    expect("body" in ((await storage.get("attachments/a", { etagDoesNotMatch: "etag-10" })) as object)).toBe(false)
    await storage.delete(["attachments/a"])
    expect(await storage.get("attachments/a")).toBeNull()
    expect(await storage.head("attachments/a")).toBeNull()
  })

  it("deletes a thousand keys a call", async () => {
    const { bucket, deleted } = fakeBucket()
    await r2Storage({ bucket }).delete(Array.from({ length: 1500 }, (_, index) => `k${index}`))
    expect(deleted.map((keys) => keys.length)).toEqual([1000, 500])
  })

  it("fails when R2 doesn't store an object", async () => {
    const { bucket } = fakeBucket()
    const storage = r2Storage({ bucket: { ...bucket, put: async () => null } })
    await expect(storage.put("k", "x", { size: 1, contentType: "text/plain" })).rejects.toThrow(/didn't store/)
  })

  it("signs direct uploads for exactly the declared type and size with S3 credentials", async () => {
    const { bucket } = fakeBucket()
    const storage = r2Storage({
      bucket,
      s3: { accountId: "acct", accessKeyId: "key", secretAccessKey: "secret", bucketName: "files" }
    })
    const signed = await storage.createUploadUrl?.("attachments/a b", {
      contentType: "image/png",
      size: 42,
      expiresIn: 900
    })
    expect(signed?.headers).toEqual({ "content-type": "image/png", "content-length": "42" })
    const url = new URL(signed?.url as string)
    expect(url.origin).toBe("https://acct.r2.cloudflarestorage.com")
    expect(url.pathname).toBe("/files/attachments/a%20b")
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host")
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900")
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^key\/\d{8}\/auto\/s3\/aws4_request$/)
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/)
    const eu = r2Storage({
      bucket,
      s3: {
        accountId: "acct",
        accessKeyId: "key",
        secretAccessKey: "secret",
        bucketName: "files",
        endpoint: "https://acct.eu.r2.cloudflarestorage.com/"
      }
    })
    const euUrl = await eu.createUploadUrl?.("k", { contentType: "text/plain", size: 1, expiresIn: 60 })
    expect(euUrl?.url).toMatch(/^https:\/\/acct\.eu\.r2\.cloudflarestorage\.com\/files\/k\?/)
  })
})
