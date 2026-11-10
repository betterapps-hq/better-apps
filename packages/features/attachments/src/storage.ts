/** What storage knows about a stored object. */
export interface StoredObject {
  key: string
  /** Bytes. */
  size: number
  /** The media type it was stored with, or `null` when storage has none. */
  contentType: string | null
  /** An opaque version of its bytes, for `ETag` and `If-None-Match`. */
  etag: string
  uploadedAt: Date
}

/** A stored object with its bytes, or the part a range asked for. */
export interface StoredBody extends StoredObject {
  body: ReadableStream<Uint8Array>
  /** The bytes `body` holds, when a range asked for part of the object. */
  range?: { offset: number; length: number } | undefined
}

/** Which bytes of an object to read: from an offset, for a length or to the end, or the last `suffix` bytes. */
export type StorageRange = { offset: number; length?: number | undefined } | { suffix: number }

/** Options for `get`. */
export interface StorageGetOptions {
  range?: StorageRange | undefined
  /** Returns the object without its body unless its etag is this one, so bytes replaced since are never served. */
  etagMatches?: string | undefined
}

/** A signed request that sends an object's bytes straight to storage, without the app's server. */
export interface SignedUpload {
  /** An absolute URL that takes a `PUT`. */
  url: string
  /** Headers the request must send exactly, such as the signed `content-type`. */
  headers: Record<string, string>
}

/**
 * Where attachments keeps files' bytes, such as an R2 bucket. Keys are made by the feature; adapters store them as
 * given.
 */
export interface StorageAdapter {
  /** The adapter's name, such as `r2`. */
  id: string
  /** Stores an object, replacing one with the same key. A stream must hold exactly `size` bytes. */
  put(
    key: string,
    body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | string,
    options: { size: number; contentType: string }
  ): Promise<StoredObject>
  /**
   * Reads an object, or `null` when there's none. When `etagMatches` isn't the object's etag, it returns the object
   * without a body.
   */
  get(key: string, options?: StorageGetOptions): Promise<StoredBody | StoredObject | null>
  /** What storage knows about an object, without its bytes, or `null` when there's none. */
  head(key: string): Promise<StoredObject | null>
  /** Deletes objects. Keys with no object are skipped. */
  delete(keys: readonly string[]): Promise<void>
  /**
   * Signs a `PUT` straight to storage for one object of exactly this type and size. Adapters that can't sign leave it
   * out, and uploads go through the app's server instead.
   */
  createUploadUrl?(
    key: string,
    options: { contentType: string; size: number; expiresIn: number }
  ): Promise<SignedUpload>
}

/** Whether a stored object came with its body. */
export function hasBody(object: StoredBody | StoredObject): object is StoredBody {
  return "body" in object
}

/** Options for `memoryStorage`. */
export interface MemoryStorageOptions {
  /**
   * Signs uploads to `https://storage.test/{key}`, so tests cover direct uploads. Send them with `memory.handle(request)`.
   * Without it, uploads go through the app's server.
   */
  signedUploads?: boolean | undefined
}

/** In-memory storage, as `memoryStorage()` returns it: the adapter, and what tests need to look inside. */
export interface MemoryStorage extends StorageAdapter {
  /** The stored objects' bytes and types, keyed by key. */
  readonly objects: ReadonlyMap<string, { bytes: Uint8Array; contentType: string; uploadedAt: Date }>
  /** Answers a signed upload's `PUT`, the way storage would. */
  handle(request: Request): Promise<Response>
}

async function readAll(
  body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | string
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof body === "string") {
    return new TextEncoder().encode(body)
  }
  if (body instanceof Uint8Array) {
    return body.slice()
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body.slice(0))
  }
  return new Uint8Array(await new Response(body).arrayBuffer())
}

async function etagOf(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** The bytes a range covers, clamped to the object, or `null` when it starts past the end. */
function slice(bytes: Uint8Array, range: StorageRange | undefined): { offset: number; length: number } | null {
  if (!range) {
    return { offset: 0, length: bytes.length }
  }
  if ("suffix" in range) {
    const length = Math.min(range.suffix, bytes.length)
    return { offset: bytes.length - length, length }
  }
  if (range.offset >= bytes.length) {
    return null
  }
  const length = Math.min(range.length ?? bytes.length - range.offset, bytes.length - range.offset)
  return { offset: range.offset, length }
}

/**
 * Storage that keeps objects in memory, for tests and demos. Objects last as long as the adapter, so a server restart
 * loses them.
 */
export function memoryStorage(options: MemoryStorageOptions = {}): MemoryStorage {
  const objects = new Map<
    string,
    { bytes: Uint8Array<ArrayBuffer>; contentType: string; uploadedAt: Date; etag: string }
  >()
  const signed = new Map<string, { contentType: string; size: number; until: number }>()
  const info = (key: string, object: { bytes: Uint8Array; contentType: string; uploadedAt: Date; etag: string }) => ({
    key,
    size: object.bytes.length,
    contentType: object.contentType,
    etag: object.etag,
    uploadedAt: object.uploadedAt
  })
  const put: StorageAdapter["put"] = async (key, body, { size, contentType }) => {
    const bytes = await readAll(body)
    if (bytes.length !== size) {
      throw new Error(`The body holds ${bytes.length} bytes, not the ${size} it was declared with.`)
    }
    const object = { bytes, contentType, uploadedAt: new Date(), etag: await etagOf(bytes) }
    objects.set(key, object)
    return info(key, object)
  }
  const storage: MemoryStorage = {
    id: "memory",
    objects,
    put,
    async get(key, { range, etagMatches } = {}) {
      const object = objects.get(key)
      if (!object) {
        return null
      }
      if (etagMatches !== undefined && etagMatches !== object.etag) {
        return info(key, object)
      }
      const part = slice(object.bytes, range)
      if (!part) {
        return { ...info(key, object), body: new Response(new Uint8Array()).body!, range: { offset: 0, length: 0 } }
      }
      const bytes = object.bytes.slice(part.offset, part.offset + part.length)
      return {
        ...info(key, object),
        body: new Response(bytes).body as ReadableStream<Uint8Array>,
        ...(range ? { range: part } : {})
      }
    },
    async head(key) {
      const object = objects.get(key)
      return object ? info(key, object) : null
    },
    async delete(keys) {
      for (const key of keys) {
        objects.delete(key)
      }
    },
    async handle(request) {
      const key = decodeURIComponent(new URL(request.url).pathname.slice(1))
      const grant = signed.get(key)
      const contentType = request.headers.get("content-type")
      const size = Number(request.headers.get("content-length"))
      if (request.method !== "PUT" || !grant || grant.until < Date.now()) {
        return new Response("Forbidden", { status: 403 })
      }
      if (contentType !== grant.contentType || size !== grant.size) {
        return new Response("The signed headers don't match.", { status: 403 })
      }
      try {
        await put(key, request.body ?? new Uint8Array(), { size, contentType })
      } catch {
        return new Response("The body doesn't match its length.", { status: 400 })
      }
      return new Response(null, { status: 200 })
    }
  }
  if (options.signedUploads) {
    storage.createUploadUrl = async (key, { contentType, size, expiresIn }) => {
      signed.set(key, { contentType, size, until: Date.now() + expiresIn * 1000 })
      return {
        url: `https://storage.test/${encodeURIComponent(key)}`,
        headers: { "content-type": contentType, "content-length": String(size) }
      }
    }
  }
  return storage
}
