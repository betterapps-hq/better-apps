import type { StorageAdapter, StoredBody, StoredObject } from "@better-apps/attachments"
import { encodeRfc3986, presign } from "./sigv4.js"

export { presign, type Credentials, type PresignInput } from "./sigv4.js"

/** An R2 range as the binding reports it. */
export type R2RangeLike = { offset?: number | undefined; length?: number | undefined } | { suffix: number }

/** What the adapter reads of an R2 object. */
export interface R2ObjectLike {
  key: string
  size: number
  etag: string
  uploaded: Date
  httpMetadata?: { contentType?: string | undefined } | undefined
  range?: R2RangeLike | undefined
}

/** An R2 object with its body. */
export interface R2ObjectBodyLike extends R2ObjectLike {
  body: ReadableStream<Uint8Array>
}

/**
 * The parts of an R2 bucket binding the adapter uses, such as Void's `void/storage` or a Worker's `env.FILES`. Any
 * object with these methods works, so tests can pass their own.
 */
export interface R2BucketLike {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<R2ObjectLike | null>
  get(
    key: string,
    options?: { range?: R2RangeLike; onlyIf?: { etagMatches?: string } }
  ): Promise<R2ObjectBodyLike | R2ObjectLike | null>
  head(key: string): Promise<R2ObjectLike | null>
  delete(keys: string | string[]): Promise<void>
}

/** R2's S3 API, for signing direct uploads. Create an API token with object read and write on the bucket. */
export interface R2S3Options {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  /** The bucket's name, which the binding doesn't know. */
  bucketName: string
  /** The S3 endpoint, for a bucket in a jurisdiction such as `https://{accountId}.eu.r2.cloudflarestorage.com`. */
  endpoint?: string | undefined
}

/** Options for `r2Storage`. */
export interface R2StorageOptions {
  /** The bucket binding. */
  bucket: R2BucketLike
  /** Signs direct uploads to R2's S3 API. Without it, uploads go through the app's server. */
  s3?: R2S3Options | undefined
}

// R2 deletes up to 1000 keys a call.
const deleteBatch = 1000

/** Wraps a stream so R2 knows its length, on Workers, which have `FixedLengthStream`. Elsewhere it's passed as is. */
function withLength(body: ReadableStream<Uint8Array>, size: number): ReadableStream<Uint8Array> {
  const FixedLengthStream = (
    globalThis as { FixedLengthStream?: new (length: number) => TransformStream<Uint8Array, Uint8Array> }
  ).FixedLengthStream
  return FixedLengthStream ? body.pipeThrough(new FixedLengthStream(size)) : body
}

function toStored(object: R2ObjectLike): StoredObject {
  return {
    key: object.key,
    size: object.size,
    contentType: object.httpMetadata?.contentType ?? null,
    etag: object.etag,
    uploadedAt: object.uploaded
  }
}

/** The bytes a range covers, in offset and length, from what R2 reports. */
function rangeOf(range: R2RangeLike, size: number): { offset: number; length: number } {
  if ("suffix" in range) {
    const length = Math.min(range.suffix, size)
    return { offset: size - length, length }
  }
  const offset = range.offset ?? 0
  return { offset, length: range.length ?? size - offset }
}

/**
 * Stores attachments' files in an R2 bucket. With `s3`, it also signs uploads straight to R2, so their bytes skip the
 * app's server; the bucket then needs a CORS rule that allows `PUT` from the app's origin with `content-type`.
 */
export function r2Storage({ bucket, s3 }: R2StorageOptions): StorageAdapter {
  const storage: StorageAdapter = {
    id: "r2",
    async put(key, body, { size, contentType }) {
      const value = body instanceof ReadableStream ? withLength(body, size) : body
      const object = await bucket.put(key, value, { httpMetadata: { contentType } })
      if (!object) {
        throw new Error(`R2 didn't store "${key}".`)
      }
      return toStored(object)
    },
    async get(key, { range, etagMatches } = {}) {
      const object = await bucket.get(key, {
        ...(range ? { range } : {}),
        ...(etagMatches === undefined ? {} : { onlyIf: { etagMatches } })
      })
      if (!object) {
        return null
      }
      if (!("body" in object)) {
        return toStored(object)
      }
      const stored: StoredBody = { ...toStored(object), body: object.body }
      if (range && object.range) {
        stored.range = rangeOf(object.range, object.size)
      }
      return stored
    },
    async head(key) {
      const object = await bucket.head(key)
      return object ? toStored(object) : null
    },
    async delete(keys) {
      for (let start = 0; start < keys.length; start += deleteBatch) {
        await bucket.delete(keys.slice(start, start + deleteBatch))
      }
    }
  }
  if (s3) {
    const endpoint = (s3.endpoint ?? `https://${s3.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, "")
    storage.createUploadUrl = async (key, { contentType, size, expiresIn }) => {
      const headers = { "content-type": contentType, "content-length": String(size) }
      const path = [s3.bucketName, ...key.split("/")].map(encodeRfc3986).join("/")
      const url = await presign({
        method: "PUT",
        url: `${endpoint}/${path}`,
        headers,
        credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
        region: "auto",
        service: "s3",
        expiresIn
      })
      return { url, headers }
    }
  }
  return storage
}
