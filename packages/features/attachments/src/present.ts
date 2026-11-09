import type { Config } from "./config.js"
import type { EventFile } from "./events.js"
import { nameSegment } from "./files.js"
import type { Attachment, AttachmentFile, FileStatus } from "./schema.js"

/** A file as actions return it. */
export interface FileInfo {
  id: string
  name: string
  contentType: string
  /** Bytes. */
  size: number
  orgId: string
  /** `user:{userId}` or `org:{orgId}` for a file kept on its own, `null` for one a record keeps. */
  owner: string | null
  createdBy: string
  status: FileStatus
  createdAt: Date
  uploadedAt: Date | null
  /** When a draft or an unfinished upload is removed, or `null` once something keeps it. */
  expiresAt: Date | null
  /** Where to download it, signed when the app has a `secret`; `null` until its bytes are confirmed. */
  url: string | null
  /**
   * When a signed `url` stops working without the request's own sign-in, so it can be loaded again before then; `null`
   * for an unsigned one.
   */
  urlExpiresAt: Date | null
}

/** A file on a record, in the record's order. */
export interface AttachedFile extends FileInfo {
  attachmentId: string
  position: number
  /** Who put it on the record. */
  attachedBy: string
  attachedAt: Date
}

/** A file without its upload token hash, as events carry it. */
export function eventFile(file: AttachmentFile): EventFile {
  const { uploadTokenHash: _hash, ...rest } = file
  return rest
}

/** Where a file downloads from, signed until the next `downloadTtl` boundary, so a page that loads twice gets one URL. */
export async function downloadUrl(
  config: Config,
  file: AttachmentFile,
  now: number
): Promise<{ url: string; expiresAt: Date | null }> {
  const url = `${config.baseUrl}${config.path}/files/${encodeURIComponent(file.id)}/${nameSegment(file.name)}`
  if (!config.signer) {
    return { url, expiresAt: null }
  }
  const window = config.downloadTtlMs
  const expires = Math.ceil((now + window) / window) * (window / 1000)
  return {
    url: `${url}?expires=${expires}&token=${await config.signer.sign(file.id, expires)}`,
    expiresAt: new Date(expires * 1000)
  }
}

/** A file as actions return it. */
export async function present(config: Config, file: AttachmentFile, now = Date.now()): Promise<FileInfo> {
  const download = file.status === "ready" ? await downloadUrl(config, file, now) : null
  return {
    id: file.id,
    name: file.name,
    contentType: file.contentType,
    size: file.size,
    orgId: file.orgId,
    owner: file.owner,
    createdBy: file.createdBy,
    status: file.status,
    createdAt: file.createdAt,
    uploadedAt: file.uploadedAt,
    expiresAt: file.expiresAt,
    url: download?.url ?? null,
    urlExpiresAt: download?.expiresAt ?? null
  }
}

/** A file on a record as actions return it. */
export async function presentAttached(
  config: Config,
  file: AttachmentFile,
  attachment: Attachment,
  now = Date.now()
): Promise<AttachedFile> {
  return {
    ...(await present(config, file, now)),
    attachmentId: attachment.id,
    position: attachment.position,
    attachedBy: attachment.createdBy,
    attachedAt: attachment.createdAt
  }
}

/** A record's attachments in their order: by position, then when they were attached, then id. */
export function byPosition(a: Attachment, b: Attachment): number {
  if (a.position !== b.position) {
    return a.position - b.position
  }
  if (a.createdAt.getTime() !== b.createdAt.getTime()) {
    return a.createdAt.getTime() - b.createdAt.getTime()
  }
  return a.id < b.id ? -1 : 1
}
