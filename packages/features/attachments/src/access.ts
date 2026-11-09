import type { ActionContext, Actor, DatabaseAdapter, SubjectRef, Subjects } from "better-apps"
import { AttachmentsError } from "./errors.js"
import { attachmentModel, type Attachment, type AttachmentFile } from "./schema.js"

export type Context = ActionContext<unknown>

/** What access checks read: the database and the app's subjects. */
export type Reader = { db: DatabaseAdapter; subjects: Subjects }

/** How many ids one `in` list holds, under D1's limit of 100 bound parameters. */
export const chunkSize = 90

/** Splits ids into lists of at most `chunkSize`. */
export function chunks<Item>(items: readonly Item[], size = chunkSize): Item[][] {
  const lists: Item[][] = []
  for (let start = 0; start < items.length; start += size) {
    lists.push(items.slice(start, start + size))
  }
  return lists
}

/**
 * Server code that passes neither an actor nor a request is trusted, so its reads and removals skip access checks. It
 * can't upload, since a file is always someone's.
 */
export function isTrusted(context: Context): boolean {
  return context.source === "api" && context.actor === null && context.request === null
}

/** The organization that owns a subject, or `""` when the app has none. */
export async function orgOf(subjects: Subjects, ref: SubjectRef, actor: Actor | null): Promise<string> {
  return (await subjects.getOrgId(ref, actor)) ?? ""
}

/** The organizations that own many subjects, in order, with one lookup per subject type. */
export async function orgsOf(subjects: Subjects, refs: readonly SubjectRef[], actor: Actor | null): Promise<string[]> {
  return (await subjects.getOrgIds(refs, actor)).map((orgId) => orgId ?? "")
}

/**
 * Which records someone can see: a signed-out visitor sees public ones, anyone else what `canView` allows. With the
 * request they made, access it carries, such as a share link, counts too, so reads pass it and writes don't.
 */
export async function canSeeRecords(
  subjects: Subjects,
  actor: Actor | null,
  refs: readonly SubjectRef[],
  request: Request | null = null
): Promise<boolean[]> {
  return subjects.canViewMany(refs.map(({ subjectType, subjectId }) => ({ subjectType, subjectId, actor, request })))
}

/** Which records a caller can see the files of: trusted server code sees all of them. */
export async function viewable(context: Context, refs: readonly SubjectRef[]): Promise<boolean[]> {
  if (isTrusted(context)) {
    return refs.map(() => true)
  }
  return canSeeRecords(context.subjects, context.actor, refs, context.request)
}

/** The signed-in user, or `UNAUTHENTICATED`. */
export function requireActor(context: Context, message: string): Actor {
  if (!context.actor) {
    throw new AttachmentsError("UNAUTHENTICATED", message)
  }
  return context.actor
}

/** Whether someone owns a file kept on its own: it's theirs, or their organization's. */
export function ownsFile(actor: Actor, file: AttachmentFile): boolean {
  return (
    file.owner === `user:${actor.userId}` ||
    (actor.orgId !== null && actor.orgId !== "" && file.owner === `org:${actor.orgId}`)
  )
}

/** Whether a file is a draft or an upload under way: nothing keeps it yet. */
export function isUnkept(file: AttachmentFile): boolean {
  return file.owner === null && file.expiresAt !== null
}

/** The attachments of some files, at most 90 files a query. */
export async function attachmentsOfFiles(db: DatabaseAdapter, fileIds: readonly string[]): Promise<Attachment[]> {
  const lists = await Promise.all(
    chunks([...new Set(fileIds)]).map(async (list) =>
      db.findMany<Attachment>({ model: attachmentModel, where: [{ field: "fileId", operator: "in", value: list }] })
    )
  )
  return lists.flat()
}

/**
 * Which files someone can see: a draft or an upload under way only its uploader, a file kept on its own its owner,
 * and any file whoever can see a record it's on, in the organization the record is in now. `null` is a signed-out
 * visitor, who sees files on public records. Pass the request for a read, so access it carries counts too. Files
 * being deleted are never seen.
 */
export async function canSeeFiles(
  reader: Reader,
  actor: Actor | null,
  files: readonly AttachmentFile[],
  request: Request | null = null
): Promise<boolean[]> {
  const allowed = files.map((file) => {
    if (file.status === "deleted") {
      return false
    }
    if (actor && file.createdBy === actor.userId && (file.status === "pending" || isUnkept(file))) {
      return true
    }
    return actor !== null && file.status === "ready" && file.owner !== null && ownsFile(actor, file)
  })
  const rest = files.filter((file, index) => !allowed[index] && file.status === "ready")
  if (rest.length === 0) {
    return allowed
  }
  const links = await attachmentsOfFiles(
    reader.db,
    rest.map((file) => file.id)
  )
  if (links.length === 0) {
    return allowed
  }
  const [orgIds, visible] = await Promise.all([
    orgsOf(reader.subjects, links, actor),
    canSeeRecords(reader.subjects, actor, links, request)
  ])
  const seen = new Set(
    links.filter((link, index) => visible[index] && orgIds[index] === link.orgId).map((link) => link.fileId)
  )
  return files.map((file, index) => allowed[index] === true || seen.has(file.id))
}
