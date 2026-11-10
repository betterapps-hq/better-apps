// Files on records: attaching, taking off, reordering and listing them, a person's own files, and deleting files.
import type { Actor, SubjectRef, WriteOperation } from "better-apps"
import {
  canPlaceIn,
  canSeeFiles,
  isTrusted,
  isUnkept,
  orgOf,
  orgsOf,
  ownsFile,
  requireActor,
  viewable,
  type Context
} from "./access.js"
import { freeSlots } from "./cleanup.js"
import { checkLimits, limits, settingsOf, type Config, type Settings } from "./config.js"
import { AttachmentsError } from "./errors.js"
import type { AttachInput, DetachInput, ListFilesInput, ListOwnFilesInput, ReorderInput } from "./options.js"
import { byPosition, eventFile, present, presentAttached, type AttachedFile, type FileInfo } from "./present.js"
import { deleteFiles, filesById, purge, removeLinks, retried } from "./removals.js"
import { attachmentModel, fileModel, type Attachment, type AttachmentFile } from "./schema.js"

const fileNotFound = () => new AttachmentsError("NOT_FOUND", "That file doesn't exist, or you can't see it.")

/** The signed-in user who may add files to a record, or the error that says why they can't. */
export async function requireUploader(settings: Settings, context: Context, ref: SubjectRef): Promise<Actor> {
  const actor = requireActor(context, "Sign in to add files.")
  if (!(await context.subjects.canView(actor, ref))) {
    throw new AttachmentsError("NOT_FOUND", "That record doesn't exist, or you can't see it.")
  }
  if (settings.rules.canUpload && !(await settings.rules.canUpload({ actor, ...ref }))) {
    throw new AttachmentsError("FORBIDDEN", "You can't add files here.")
  }
  return actor
}

/** A record's attachments in one organization. */
async function attachmentsOn(context: Pick<Context, "db">, ref: SubjectRef, orgId: string): Promise<Attachment[]> {
  return context.db.findMany<Attachment>({
    model: attachmentModel,
    where: [
      { field: "subjectType", value: ref.subjectType },
      { field: "subjectId", value: ref.subjectId },
      { field: "orgId", value: orgId }
    ]
  })
}

/** Options for `addLinks`. */
interface LinkOptions {
  /** The record's organization, as the caller read it and wrote it into the files in `before`. */
  orgId: string
  /** Writes that run first in the same batch, such as marking an upload ready. */
  before: readonly WriteOperation[]
  /** The files whose update in `before` must match, in the same order. */
  guarded: readonly string[]
  /** Why a guarded update matched nothing, as the `CONFLICT` error says it. */
  conflict: string
  /** Runs once the batch committed with every guarded update matching, such as to emit `file.uploaded`. */
  committed?: (() => void) | undefined
}

/**
 * Puts files on a record after its files, in the record's free places, so the database holds `maxFiles` even when two
 * uploads finish at once. A `guarded` file whose update matched nothing, because it expired, was deleted or was
 * attached elsewhere meanwhile, takes its attachment back off and leaves the file to whatever changed it. Then the
 * record is checked again, and files on a record that went away, or out of reach, meanwhile come back off as
 * `withdrawn`, as do files on a record that moved to another organization since the caller read `orgId`, so a file and
 * its attachment always agree on the organization.
 */
export async function addLinks(
  config: Config,
  context: Context,
  ref: SubjectRef,
  files: readonly AttachmentFile[],
  { orgId, before, guarded, conflict, committed }: LinkOptions
): Promise<AttachedFile[]> {
  const settings = settingsOf(config, ref.subjectType)
  const { actor } = context
  const added = await retried(async () => {
    const existing = await attachmentsOn(context, ref, orgId)
    const already = new Set(existing.map((row) => row.fileId))
    const adding = files.filter((file) => !already.has(file.id))
    if (existing.length + adding.length > settings.maxFiles) {
      throw new AttachmentsError("LIMIT_EXCEEDED", `A record here can have up to ${settings.maxFiles} files.`)
    }
    const slots = freeSlots(new Set(existing.map((row) => row.slot)), settings.maxFiles, adding.length)
    const first = Math.max(-1, ...existing.map((row) => row.position)) + 1
    const now = new Date()
    const links: Attachment[] = adding.map((file, index) => ({
      id: crypto.randomUUID(),
      fileId: file.id,
      orgId,
      subjectType: ref.subjectType,
      subjectId: ref.subjectId,
      position: first + index,
      slot: slots[index] as number,
      createdBy: actor?.userId ?? file.createdBy,
      createdAt: now
    }))
    for (const [index, link] of links.entries()) {
      context.emit("attachment.added", {
        subjectType: ref.subjectType,
        subjectId: ref.subjectId,
        orgId,
        attachment: link,
        file: eventFile(adding[index] as AttachmentFile)
      })
    }
    const results = await context.db.batch([
      ...before,
      ...links.map((data): WriteOperation => ({ type: "create", model: attachmentModel, data }))
    ])
    const failed = new Set(guarded.filter((_, index) => results[index] === null))
    return { links, failed }
  })
  const lost = added.links.filter((link) => added.failed.has(link.fileId))
  if (lost.length > 0) {
    await removeLinks(config, context, lost, "withdrawn", { keepFiles: true })
    throw new AttachmentsError("CONFLICT", conflict)
  }
  if (added.failed.size === 0) {
    committed?.()
  }
  const visible = isTrusted(context) || (actor !== null && (await context.subjects.canView(actor, ref)))
  if (!visible || (await orgOf(context.subjects, ref, actor)) !== orgId) {
    await removeLinks(config, context, added.links, "withdrawn")
    throw new AttachmentsError("NOT_FOUND", "That record doesn't exist, or you can't see it.")
  }
  const byId = new Map(files.map((file) => [file.id, file]))
  const now = Date.now()
  return Promise.all(
    added.links.map(async (link) => presentAttached(config, byId.get(link.fileId) as AttachmentFile, link, now))
  )
}

/** Puts drafts and files kept on their own on a record. */
export async function attach(config: Config, context: Context): Promise<{ files: AttachedFile[] }> {
  const input = context.input as AttachInput
  const settings = settingsOf(config, input.subjectType)
  const ref: SubjectRef = { subjectType: input.subjectType, subjectId: input.subjectId }
  const actor = await requireUploader(settings, context, ref)
  const fileIds = [...new Set(input.fileIds)]
  const found = await filesById(context.db, fileIds)
  const files = fileIds.map((id) => found.get(id)).filter((file) => file?.status === "ready") as AttachmentFile[]
  if (files.length < fileIds.length) {
    throw fileNotFound()
  }
  const kept = files.filter((file) => file.owner !== null)
  const seen = await canSeeFiles(context, actor, kept)
  const orgId = await orgOf(context.subjects, ref, actor)
  const now = new Date()
  const drafts: string[] = []
  for (const file of files) {
    if (isUnkept(file)) {
      if (file.createdBy !== actor.userId) {
        throw fileNotFound()
      }
      if ((file.expiresAt as Date).getTime() <= now.getTime()) {
        throw new AttachmentsError("CONFLICT", "That upload expired. Upload the file again.")
      }
      // A draft holds only its uploader's own bytes, so it goes on a record in any organization and joins the record's.
      drafts.push(file.id)
    } else if (file.owner !== null) {
      if (!seen[kept.indexOf(file)]) {
        throw fileNotFound()
      }
      if (!canPlaceIn(actor, file, orgId)) {
        throw new AttachmentsError("INVALID_INPUT", "That file can't go on records in this organization.")
      }
    } else {
      const on = await attachmentsOn(context, ref, orgId)
      if (!on.some((row) => row.fileId === file.id)) {
        throw new AttachmentsError("INVALID_INPUT", "That file is on another record. Upload it again to add it here.")
      }
      continue
    }
    checkLimits(settings, file.contentType, file.size)
  }
  const before = drafts.map((id): WriteOperation => ({
    type: "update",
    model: fileModel,
    where: [
      { field: "id", value: id },
      { field: "status", value: "ready" },
      { field: "expiresAt", operator: "gt", value: now }
    ],
    update: { expiresAt: null, subjectType: input.subjectType, orgId }
  }))
  const attaching = files.map((file) => (drafts.includes(file.id) ? { ...file, expiresAt: null, orgId } : file))
  return {
    files: await addLinks(config, context, ref, attaching, {
      orgId,
      before,
      guarded: drafts,
      conflict: "That file was added somewhere else, or it expired. Upload it again."
    })
  }
}

/** Takes a file off a record: the person who put it there, a moderator, or trusted server code. */
export async function detach(config: Config, context: Context): Promise<{ removed: boolean }> {
  const input = context.input as DetachInput
  const settings = settingsOf(config, input.subjectType)
  const ref: SubjectRef = { subjectType: input.subjectType, subjectId: input.subjectId }
  const trusted = isTrusted(context)
  if (!trusted) {
    const actor = requireActor(context, "Sign in to remove files.")
    if (!(await context.subjects.canView(actor, ref))) {
      throw new AttachmentsError("NOT_FOUND", "That record doesn't exist, or you can't see it.")
    }
  }
  const { actor } = context
  const orgId = await orgOf(context.subjects, ref, actor)
  const find = async () =>
    context.db.findOne<Attachment>({
      model: attachmentModel,
      where: [
        { field: "subjectType", value: ref.subjectType },
        { field: "subjectId", value: ref.subjectId },
        { field: "orgId", value: orgId },
        { field: "fileId", value: input.fileId }
      ]
    })
  const link = await find()
  if (!link) {
    return { removed: false }
  }
  const own = actor !== null && link.createdBy === actor.userId
  const moderator =
    trusted ||
    (actor !== null &&
      settings.rules.canModerate !== undefined &&
      (await settings.rules.canModerate({ actor, ...ref })))
  if (!own && !moderator) {
    throw new AttachmentsError("FORBIDDEN", "You can't remove other people's files here.")
  }
  try {
    await removeLinks(config, context, [link], own ? "detached" : "moderated")
  } catch (error) {
    // Another removal, such as from another tab, got there first.
    if (!(await find())) {
      return { removed: false }
    }
    throw error
  }
  return { removed: true }
}

/** Puts a record's files in a new order. `fileIds` must list every file on it. */
export async function reorder(config: Config, context: Context): Promise<void> {
  const input = context.input as ReorderInput
  const settings = settingsOf(config, input.subjectType)
  const ref: SubjectRef = { subjectType: input.subjectType, subjectId: input.subjectId }
  const actor = await requireUploader(settings, context, ref)
  const orgId = await orgOf(context.subjects, ref, actor)
  const links = await attachmentsOn(context, ref, orgId)
  const byFile = new Map(links.map((link) => [link.fileId, link]))
  const fileIds = [...new Set(input.fileIds)]
  if (fileIds.length !== links.length || fileIds.some((id) => !byFile.has(id))) {
    throw new AttachmentsError("CONFLICT", "The files on this record changed. Load them again.")
  }
  if (fileIds.every((fileId, position) => byFile.get(fileId)?.position === position)) {
    return
  }
  // Every position is written, not just the ones that changed since this read, so when reorders from two tabs race,
  // the record ends in the order of whichever saves last rather than a mix of both.
  const updates = fileIds.map((fileId, position): WriteOperation => ({
    type: "update",
    model: attachmentModel,
    where: [{ field: "id", value: (byFile.get(fileId) as Attachment).id }],
    update: { position }
  }))
  context.emit("attachments.reordered", { ...ref, orgId, fileIds })
  await context.db.batch(updates)
}

/** Each record's files in order, keyed by id. Records the caller can't see come back with none. */
export async function listFiles(config: Config, context: Context): Promise<Record<string, AttachedFile[]>> {
  const input = context.input as ListFilesInput
  settingsOf(config, input.subjectType)
  const ids = [...new Set(input.subjectIds)]
  const result: Record<string, AttachedFile[]> = Object.fromEntries(ids.map((id) => [id, []]))
  const refs = ids.map((subjectId) => ({ subjectType: input.subjectType, subjectId }))
  const visible = await viewable(context, refs)
  const shown = refs.filter((_, index) => visible[index])
  if (shown.length === 0) {
    return result
  }
  const orgIds = await orgsOf(context.subjects, shown, context.actor)
  const orgOfRecord = new Map(shown.map((ref, index) => [ref.subjectId, orgIds[index]]))
  const links = (
    await context.db.findMany<Attachment>({
      model: attachmentModel,
      where: [
        { field: "subjectType", value: input.subjectType },
        { field: "subjectId", operator: "in", value: shown.map((ref) => ref.subjectId) }
      ]
    })
  ).filter((link) => orgOfRecord.get(link.subjectId) === link.orgId)
  const files = await filesById(
    context.db,
    links.map((link) => link.fileId)
  )
  const now = Date.now()
  for (const link of links.sort(byPosition)) {
    const file = files.get(link.fileId)
    if (file?.status === "ready") {
      ;(result[link.subjectId] as AttachedFile[]).push(await presentAttached(config, file, link, now))
    }
  }
  return result
}

/** One file, if the caller can see it. */
export async function getFile(config: Config, context: Context): Promise<FileInfo> {
  const { fileId } = context.input as { fileId: string }
  const file = await context.db.findOne<AttachmentFile>({ model: fileModel, where: [{ field: "id", value: fileId }] })
  if (!file || file.status === "deleted") {
    throw fileNotFound()
  }
  if (!isTrusted(context)) {
    const [allowed] = await canSeeFiles(context, context.actor, [file], context.request)
    if (!allowed) {
      throw context.actor ? fileNotFound() : new AttachmentsError("UNAUTHENTICATED", "Sign in to see this file.")
    }
  }
  return present(config, file)
}

// A page cursor holds the last row's time and id, so files that share a time are never skipped or repeated.
function encodeCursor(file: AttachmentFile): string {
  return btoa(JSON.stringify([file.createdAt.toISOString(), file.id]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const [time, id] = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/"))) as unknown[]
    const createdAt = new Date(String(time))
    if (typeof time === "string" && typeof id === "string" && !Number.isNaN(createdAt.getTime())) {
      return { createdAt, id }
    }
  } catch {
    // Reported below.
  }
  throw new AttachmentsError("INVALID_INPUT", "That page cursor isn't valid.")
}

/** A page of the caller's own files, or their organization's, newest first. */
export async function listOwnFiles(
  config: Config,
  context: Context
): Promise<{ files: FileInfo[]; cursor: string | null }> {
  const input = context.input as ListOwnFilesInput
  const actor = requireActor(context, "Sign in to see your files.")
  if (input.owner === "org" && !actor.orgId) {
    throw new AttachmentsError("INVALID_INPUT", "You aren't in an organization.")
  }
  const owner = input.owner === "org" ? `org:${actor.orgId}` : `user:${actor.userId}`
  const limit = input.limit ?? limits.ownFilesPerPage
  const rows = await context.db.findMany<AttachmentFile>({
    model: fileModel,
    where: [
      { field: "owner", value: owner },
      { field: "status", value: "ready" }
    ],
    sortBy: [
      { field: "createdAt", direction: "desc" },
      { field: "id", direction: "desc" }
    ],
    after: input.cursor ? decodeCursor(input.cursor) : undefined,
    limit: limit + 1
  })
  const page = rows.slice(0, limit)
  const now = Date.now()
  return {
    files: await Promise.all(page.map(async (file) => present(config, file, now))),
    cursor: rows.length > limit ? encodeCursor(page.at(-1) as AttachmentFile) : null
  }
}

/** Deletes a file: the caller's own upload or draft, or a file kept on its own by its owner or a manager. */
export async function deleteFile(config: Config, context: Context): Promise<{ deleted: boolean }> {
  const { fileId } = context.input as { fileId: string }
  const file = await context.db.findOne<AttachmentFile>({ model: fileModel, where: [{ field: "id", value: fileId }] })
  if (!file || file.status === "deleted") {
    return { deleted: false }
  }
  if (!isTrusted(context)) {
    const actor = requireActor(context, "Sign in to delete files.")
    if (file.status === "pending" || isUnkept(file)) {
      if (file.createdBy !== actor.userId) {
        throw fileNotFound()
      }
    } else if (file.owner === null) {
      throw new AttachmentsError("INVALID_INPUT", "Remove this file from its record instead.")
    } else if (!ownsFile(actor, file)) {
      throw fileNotFound()
    } else if (file.owner.startsWith("org:")) {
      const canManage = config.standalone?.rules.canManage
      if (canManage && !(await canManage({ actor, orgId: file.orgId }))) {
        throw new AttachmentsError("FORBIDDEN", "You can't delete your organization's files.")
      }
    }
  }
  if (file.status === "pending") {
    // A finish under way could make the file ready and put it on its record between reading and deleting it, so it's
    // taken while it's still pending, which the finish then can't change. When the finish got there first, the file is
    // read again and deleted as it is now, which for a file on its record means taking it off first.
    const taken = await context.db.update<AttachmentFile>({
      model: fileModel,
      where: [
        { field: "id", value: fileId },
        { field: "status", value: "pending" }
      ],
      update: { status: "deleted", expiresAt: null }
    })
    if (!taken) {
      return deleteFile(config, context)
    }
    // An unfinished upload is on no record and was never reported, so only its bytes and row are left to go.
    await purge(config, context.db, [file])
    return { deleted: true }
  }
  return { deleted: await deleteFiles(config, context, [file], "deleted") }
}

/** What files a record of a subject type takes, or a file on its own without one. */
export interface AttachmentSettings {
  /** The media types allowed, or `null` for any. */
  contentTypes: string[] | null
  maxSize: number
  /** How many files one record holds, or `null` for files on their own. */
  maxFiles: number | null
}

/** The limits files are checked against, such as for a picker's `accept`. */
export async function getSettings(config: Config, context: Context): Promise<AttachmentSettings> {
  const { subjectType } = context.input as { subjectType?: string | undefined }
  if (subjectType === undefined) {
    if (!config.standalone) {
      throw new AttachmentsError("INVALID_INPUT", "Files on their own aren't allowed here.")
    }
    const { contentTypes, maxSize } = config.standalone
    return { contentTypes, maxSize, maxFiles: null }
  }
  const { contentTypes, maxSize, maxFiles } = settingsOf(config, subjectType)
  return { contentTypes, maxSize, maxFiles }
}
