import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import type { StorageAdapter, StoredObject } from "@better-apps/attachments"

/** What's kept beside each object's bytes. */
interface Meta {
  contentType: string
  etag: string
  uploadedAt: string
}

/**
 * Keeps attachments' bytes in a folder, for running the app on Node: each object is a file named by its key, with its
 * type and etag in a `.json` file beside it. A Worker would use `r2Storage` from `@better-apps/storage-r2` instead.
 */
export function folderStorage(folder: string): StorageAdapter {
  const root = resolve(folder)
  // Keys come from the feature, such as `attachments/{fileId}`. Any key that would leave the folder is refused.
  const pathOf = (key: string) => {
    const path = resolve(root, ...key.split("/"))
    if (!path.startsWith(`${root}${sep}`)) {
      throw new Error(`The storage key "${key}" leaves the folder.`)
    }
    return path
  }
  const head = async (key: string): Promise<StoredObject | null> => {
    const path = pathOf(key)
    try {
      const [meta, stats] = await Promise.all([readFile(`${path}.json`, "utf8"), stat(path)])
      const { contentType, etag, uploadedAt } = JSON.parse(meta) as Meta
      return { key, size: stats.size, contentType, etag, uploadedAt: new Date(uploadedAt) }
    } catch {
      return null
    }
  }

  return {
    id: "folder",
    async put(key, body, { size, contentType }) {
      const bytes =
        typeof body === "string" ? Buffer.from(body) : Buffer.from(await new Response(body as BodyInit).arrayBuffer())
      if (bytes.length !== size) {
        throw new Error(`The body holds ${bytes.length} bytes, not the ${size} it was declared with.`)
      }
      const path = pathOf(key)
      await mkdir(dirname(path), { recursive: true })
      const meta: Meta = {
        contentType,
        etag: createHash("sha256").update(bytes).digest("hex").slice(0, 32),
        uploadedAt: new Date().toISOString()
      }
      // Written beside the object, then moved into place, so a reader never sees half a file.
      await writeFile(`${path}.part`, bytes)
      await writeFile(`${path}.json`, JSON.stringify(meta))
      await rename(`${path}.part`, path)
      return { key, size, contentType, etag: meta.etag, uploadedAt: new Date(meta.uploadedAt) }
    },
    async get(key, { range, etagMatches } = {}) {
      const object = await head(key)
      if (!object || (etagMatches !== undefined && etagMatches !== object.etag)) {
        return object
      }
      let offset = 0
      let length = object.size
      if (range && "suffix" in range) {
        length = Math.min(range.suffix, object.size)
        offset = object.size - length
      } else if (range) {
        offset = Math.min(range.offset, object.size)
        length = Math.min(range.length ?? object.size - offset, object.size - offset)
      }
      const stream =
        length === 0 ? Readable.from([]) : createReadStream(pathOf(key), { start: offset, end: offset + length - 1 })
      return {
        ...object,
        body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
        ...(range ? { range: { offset, length } } : {})
      }
    },
    head,
    async delete(keys) {
      await Promise.all(
        keys.flatMap((key) => [rm(pathOf(key), { force: true }), rm(`${pathOf(key)}.json`, { force: true })])
      )
    }
  }
}
