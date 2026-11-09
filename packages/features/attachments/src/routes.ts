// The routes that move bytes: `PUT {path}/uploads/:fileId` takes an upload through the server, and
// `GET {path}/files/:fileId/:name` serves a download, checked against the file's records each time.
import { defineRoute, type RouteContext, type RouteDefinition } from "better-apps"
import { canSeeFiles } from "./access.js"
import type { Config } from "./config.js"
import { AttachmentsError } from "./errors.js"
import { cleanContentType, contentDisposition, isInline, previewTypes } from "./files.js"
import { fileModel, type AttachmentFile } from "./schema.js"
import { hasBody, type StorageRange, type StoredBody, type StoredObject } from "./storage.js"
import { sha256Hex } from "./tokens.js"

const gone = () => new AttachmentsError("NOT_FOUND", "That upload doesn't exist, or it expired.")

/** Takes an upload's bytes, checked against its token, its expiry, and the type and size it was declared with. */
async function upload(config: Config, { request, url, params, db, now }: RouteContext): Promise<Response> {
  const token = url.searchParams.get("token") ?? ""
  const file = await db.findOne<AttachmentFile>({ model: fileModel, where: [{ field: "id", value: params.fileId }] })
  if (
    !file ||
    file.status !== "pending" ||
    !file.uploadTokenHash ||
    // The stored hash is compared to a hash of the token, so timing reveals nothing about the token.
    (await sha256Hex(token)) !== file.uploadTokenHash ||
    (file.expiresAt?.getTime() ?? 0) <= now.getTime()
  ) {
    throw gone()
  }
  if (cleanContentType(request.headers.get("content-type") ?? "") !== file.contentType) {
    throw new AttachmentsError("INVALID_INPUT", `Send the file as ${file.contentType}, as the upload said.`)
  }
  // Storage takes exactly `size` bytes, so a body without a length, such as a chunked one, still can't differ.
  const length = request.headers.get("content-length")
  if (length !== null && length !== String(file.size)) {
    throw new AttachmentsError("INVALID_INPUT", `Send exactly ${file.size} bytes, as the upload said.`)
  }
  await config.storage.put(file.storageKey, request.body ?? new Uint8Array(), {
    size: file.size,
    contentType: file.contentType
  })
  return new Response(null, { status: 204 })
}

/** The one byte range a `Range` header asks for, `"all"` for none or several, or `null` when it's past the end. */
export function parseRange(header: string | null, size: number): StorageRange | "all" | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (match[1] === "" && match[2] === "")) {
    return "all"
  }
  const [, from = "", to = ""] = match
  if (from === "") {
    const suffix = Number(to)
    return suffix === 0 ? null : { suffix: Math.min(suffix, size) }
  }
  const offset = Number(from)
  if (offset >= size) {
    return null
  }
  if (to === "") {
    return { offset }
  }
  const end = Number(to)
  return end < offset ? "all" : { offset, length: Math.min(end, size - 1) - offset + 1 }
}

/** An etag as `If-None-Match` sends it, without quotes or a weak marker. */
function bareEtag(header: string | null): string | undefined {
  const first = header?.split(",")[0]?.trim()
  return first ? first.replace(/^W\//, "").replace(/^"|"$/g, "") : undefined
}

/**
 * Whether the request may download the file: a valid signed URL, or someone who can see it, with access the request
 * carries, such as a share link, counted too.
 */
async function mayDownload(config: Config, context: RouteContext, file: AttachmentFile): Promise<boolean> {
  const query = context.url.searchParams
  const token = query.get("token")
  if (token !== null && config.signer) {
    return config.signer.verify(file.id, Number(query.get("expires")), token, context.now.getTime())
  }
  const [allowed] = await canSeeFiles(context, await context.getActor(), [file], context.request)
  return allowed === true
}

/** The headers every download carries, for caching and so a file can't act on the app's origin. */
function downloadHeaders(config: Config, file: AttachmentFile, object: StoredObject, url: URL): Headers {
  const query = url.searchParams
  const signed = query.has("token") && config.signer !== null
  const inline = isInline(file.contentType) && query.get("download") !== "1"
  const headers = new Headers({
    "content-type": file.contentType,
    "content-disposition": contentDisposition(file.name, inline),
    "x-content-type-options": "nosniff",
    // A signed URL works until it expires, so the browser keeps the file that long. Otherwise it asks again each time,
    // with the etag, so a file the person can no longer see, such as after signing out, isn't served from its cache.
    "cache-control": signed ? `private, max-age=${Math.floor(config.downloadTtlMs / 1000)}` : "private, no-cache",
    etag: `"${object.etag}"`,
    "last-modified": object.uploadedAt.toUTCString(),
    "accept-ranges": "bytes"
  })
  if (file.contentType !== "application/pdf") {
    headers.set("content-security-policy", "sandbox")
  }
  return headers
}

/** Snaps a width up to the next one previews are made at. */
function snapWidth(widths: readonly number[], asked: number): number {
  return widths.find((width) => width >= asked) ?? (widths.at(-1) as number)
}

/** Serves a file, part of it, a preview, or 304 when the browser has it. */
async function download(config: Config, context: RouteContext): Promise<Response> {
  const { request, url, params, db } = context
  const file = await db.findOne<AttachmentFile>({ model: fileModel, where: [{ field: "id", value: params.fileId }] })
  if (!file || file.status !== "ready" || !(await mayDownload(config, context, file))) {
    throw new AttachmentsError("NOT_FOUND", "That file doesn't exist, or you can't see it.")
  }
  const width = Number(url.searchParams.get("w"))
  if (config.previews && previewTypes.has(file.contentType) && Number.isInteger(width) && width > 0) {
    const object = await config.storage.get(file.storageKey)
    if (!object || !hasBody(object)) {
      throw new AttachmentsError("NOT_FOUND", "That file doesn't exist, or you can't see it.")
    }
    const preview = await config.previews.transform({
      file,
      object,
      width: snapWidth(config.previews.widths, width),
      request
    })
    const headers = downloadHeaders(config, file, object, url)
    headers.delete("accept-ranges")
    headers.set("etag", `"${object.etag}-w${snapWidth(config.previews.widths, width)}"`)
    for (const name of ["content-type", "content-length"]) {
      const value = preview.headers.get(name)
      if (value) {
        headers.set(name, value)
      } else {
        headers.delete(name)
      }
    }
    return new Response(preview.body, { status: preview.status, headers })
  }
  const range = parseRange(request.headers.get("range"), file.size)
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${file.size}`, "x-content-type-options": "nosniff" }
    })
  }
  const object =
    request.method === "HEAD"
      ? await config.storage.head(file.storageKey)
      : await config.storage.get(file.storageKey, {
          range: range === "all" ? undefined : range,
          etagDoesNotMatch: bareEtag(request.headers.get("if-none-match"))
        })
  if (!object) {
    throw new AttachmentsError("NOT_FOUND", "That file doesn't exist, or you can't see it.")
  }
  const headers = downloadHeaders(config, file, object, url)
  if (bareEtag(request.headers.get("if-none-match")) === object.etag) {
    return new Response(null, { status: 304, headers })
  }
  const part = hasBody(object) ? (object as StoredBody).range : undefined
  if (part && range !== "all") {
    headers.set("content-length", String(part.length))
    headers.set("content-range", `bytes ${part.offset}-${part.offset + part.length - 1}/${object.size}`)
    return new Response((object as StoredBody).body, { status: 206, headers })
  }
  headers.set("content-length", String(object.size))
  return new Response(hasBody(object) ? object.body : null, { status: 200, headers })
}

/** The upload and download routes, at the feature's `path`. Core answers `HEAD` with the download route. */
export function attachmentRoutes(config: Config): Record<"upload" | "download", RouteDefinition> {
  return {
    upload: defineRoute({
      path: `${config.path}/uploads/:fileId`,
      method: "PUT",
      handler: async (context) => upload(config, context)
    }),
    download: defineRoute({
      path: `${config.path}/files/:fileId/:name`,
      method: "GET",
      handler: async (context) => download(config, context)
    })
  }
}
