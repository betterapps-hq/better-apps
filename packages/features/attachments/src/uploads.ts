// Uploads: `createUpload` checks and writes a pending row and says where to send the bytes, the bytes go straight to
// storage or through the upload route, and `completeUpload` checks what arrived and marks the file ready.
import type { Actor, SubjectRef, WriteOperation } from "better-apps"
import { isTrusted, orgOf, requireActor, type Context } from "./access.js"
import { checkLimits, settingsOf, type Config, type Limits } from "./config.js"
import { AttachmentsError } from "./errors.js"
import { cleanContentType, cleanName } from "./files.js"
import type { CreateUploadInput } from "./options.js"
import { eventFile, present, type AttachedFile, type FileInfo } from "./present.js"
import { addLinks, requireUploader } from "./records.js"
import { deleteFiles } from "./removals.js"
import { fileModel, type AttachmentFile } from "./schema.js"
import { randomToken, sha256Hex } from "./tokens.js"

/** Where and how to send an upload's bytes. */
export interface UploadRequest {
  url: string
  method: "PUT"
  /**
   * Headers to send. Browsers set `content-length` from the body themselves, so clients skip it when the platform
   * refuses to set it.
   */
  headers: Record<string, string>
  expiresAt: Date
}

/** What `createUpload` returns: the pending file, and where to send its bytes. */
export interface CreateUploadResult {
  file: FileInfo
  upload: UploadRequest
}

/** What `completeUpload` returns: the ready file, and its place on the record when it was uploaded onto one. */
export interface CompleteUploadResult {
  file: FileInfo
  attachment: AttachedFile | null
}

/** Where an upload goes, checked: its limits, organization, owner, and the record it's aimed at. */
async function placeUpload(
  config: Config,
  context: Context,
  actor: Actor,
  input: CreateUploadInput
): Promise<{ limits: Limits; orgId: string; owner: string | null; subjectType: string | null; target: string | null }> {
  if (input.subjectType !== undefined) {
    const settings = settingsOf(config, input.subjectType)
    if (input.subjectId === undefined) {
      return { limits: settings, orgId: actor.orgId ?? "", owner: null, subjectType: input.subjectType, target: null }
    }
    const ref: SubjectRef = { subjectType: input.subjectType, subjectId: input.subjectId }
    await requireUploader(settings, context, ref)
    return {
      limits: settings,
      orgId: await orgOf(context.subjects, ref, actor),
      owner: null,
      subjectType: input.subjectType,
      target: input.subjectId
    }
  }
  const { standalone } = config
  if (!standalone) {
    throw new AttachmentsError(
      "INVALID_INPUT",
      "Choose a record for this file. Files on their own aren't allowed here."
    )
  }
  if (standalone.rules.canUpload && !(await standalone.rules.canUpload(actor))) {
    throw new AttachmentsError("FORBIDDEN", "You can't upload files here.")
  }
  const ownerKind = input.owner ?? (actor.orgId ? "org" : "user")
  if (ownerKind === "org" && !actor.orgId) {
    throw new AttachmentsError("INVALID_INPUT", "Only people in an organization can upload its files.")
  }
  return {
    limits: standalone,
    orgId: actor.orgId ?? "",
    owner: ownerKind === "org" ? `org:${actor.orgId}` : `user:${actor.userId}`,
    subjectType: null,
    target: null
  }
}

/** Checks an upload, writes its pending row, and returns where to send the bytes. */
export async function createUpload(config: Config, context: Context): Promise<CreateUploadResult> {
  const input = context.input as CreateUploadInput
  const actor = requireActor(context, "Sign in to upload files.")
  const contentType = cleanContentType(input.contentType)
  if (!contentType) {
    throw new AttachmentsError("INVALID_INPUT", `"${input.contentType}" isn't a media type.`)
  }
  const place = await placeUpload(config, context, actor, input)
  checkLimits(place.limits, contentType, input.size)
  const now = Date.now()
  // Drafts and unfinished uploads skip a record's checks until they're attached, so each person has only so many.
  const open = await context.db.count({
    model: fileModel,
    where: [
      { field: "createdBy", value: actor.userId },
      { field: "status", operator: "in", value: ["pending", "ready"] },
      { field: "expiresAt", operator: "gt", value: new Date(now) }
    ]
  })
  if (open >= config.maxDrafts) {
    throw new AttachmentsError(
      "LIMIT_EXCEEDED",
      `You can have up to ${config.maxDrafts} files uploading or waiting to be added. Add or remove some first.`
    )
  }
  const id = crypto.randomUUID()
  const storageKey = `attachments/${id}`
  const expiresAt = new Date(now + config.uploadTtlMs)
  const signed = await config.storage.createUploadUrl?.(storageKey, {
    contentType,
    size: input.size,
    expiresIn: Math.floor(config.uploadTtlMs / 1000)
  })
  const token = signed ? null : randomToken()
  const file = await context.db.create<AttachmentFile>({
    model: fileModel,
    data: {
      id,
      orgId: place.orgId,
      owner: place.owner,
      createdBy: actor.userId,
      name: cleanName(input.name),
      contentType,
      size: input.size,
      storageKey,
      status: "pending",
      subjectType: place.subjectType,
      target: place.target,
      uploadTokenHash: token ? await sha256Hex(token) : null,
      expiresAt,
      uploadClosesAt: expiresAt,
      etag: null,
      createdAt: context.now,
      uploadedAt: null
    }
  })
  const url = signed?.url ?? `${config.baseUrl}${config.path}/uploads/${encodeURIComponent(id)}?token=${token}`
  return {
    file: await present(config, file, now),
    upload: { url, method: "PUT", headers: signed?.headers ?? { "content-type": contentType }, expiresAt }
  }
}

/** The caller's own upload, or `NOT_FOUND`. Trusted server code can finish anyone's. */
async function ownUpload(context: Context, fileId: string): Promise<AttachmentFile> {
  const file = await context.db.findOne<AttachmentFile>({ model: fileModel, where: [{ field: "id", value: fileId }] })
  const mine = file !== null && (isTrusted(context) || file.createdBy === context.actor?.userId)
  if (!file || !mine || file.status === "deleted") {
    throw new AttachmentsError("NOT_FOUND", "That upload doesn't exist, or it expired.")
  }
  return file
}

/**
 * Checks what storage holds against the pending row and marks the file ready. A file aimed at a record is attached in
 * the same batch. Finishing a file that's already ready returns it again.
 */
export async function completeUpload(config: Config, context: Context): Promise<CompleteUploadResult> {
  const { fileId } = context.input as { fileId: string }
  if (!isTrusted(context)) {
    requireActor(context, "Sign in to upload files.")
  }
  const file = await ownUpload(context, fileId)
  if (file.status === "ready") {
    return { file: await present(config, file), attachment: null }
  }
  const stored = await config.storage.head(file.storageKey)
  if (!stored) {
    throw new AttachmentsError("CONFLICT", "The file hasn't arrived yet. Send it, then finish the upload.")
  }
  const storedType = stored.contentType === null ? file.contentType : cleanContentType(stored.contentType)
  if (stored.size !== file.size || storedType !== file.contentType) {
    await config.storage.delete([file.storageKey])
    throw new AttachmentsError("INVALID_INPUT", "The file that arrived doesn't match the upload. Send it again.")
  }
  const keptByRecord = file.target !== null
  const expiresAt = file.owner === null && !keptByRecord ? new Date(Date.now() + config.draftTtlMs) : null
  const ready: AttachmentFile = {
    ...file,
    status: "ready",
    uploadTokenHash: null,
    expiresAt,
    target: null,
    etag: stored.etag,
    uploadedAt: new Date()
  }
  const markReady: WriteOperation = {
    type: "update",
    model: fileModel,
    where: [
      { field: "id", value: file.id },
      { field: "status", value: "pending" }
    ],
    update: {
      status: "ready",
      uploadTokenHash: null,
      expiresAt,
      target: null,
      etag: stored.etag,
      uploadedAt: ready.uploadedAt
    }
  }
  // Emitted once the update matched, and written after it, so an upload that expired or lost a race isn't reported.
  const announce = () => context.emit("file.uploaded", { file: eventFile(ready) })
  if (!keptByRecord) {
    const [updated] = await context.db.batch([markReady])
    if (!updated) {
      // Another call finished it meanwhile, or it was deleted or expired, which `ownUpload` reports.
      return { file: await present(config, await ownUpload(context, file.id)), attachment: null }
    }
    announce()
    return { file: await present(config, ready), attachment: null }
  }
  const ref: SubjectRef = { subjectType: file.subjectType as string, subjectId: file.target as string }
  try {
    const [attached] = await addLinks(config, context, ref, [ready], {
      before: [markReady],
      guarded: [file.id],
      conflict: "That upload expired. Upload the file again.",
      committed: announce
    })
    return { file: await present(config, ready), attachment: attached ?? null }
  } catch (error) {
    // A record that went away or filled up meanwhile leaves the upload with nowhere to go.
    if (error instanceof AttachmentsError && error.code !== "CONFLICT") {
      await deleteFiles(config, context, [file], "detached")
    }
    throw error
  }
}
