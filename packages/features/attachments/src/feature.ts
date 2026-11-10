import {
  defineAction,
  defineFeature,
  type Actor,
  type BetterAppsEvent,
  type StandardSchemaV1,
  type SubjectContext,
  type SubjectDefinition
} from "better-apps"
import { z } from "zod"
import { canSeeFiles, orgOf, type Context } from "./access.js"
import {
  cleanUp,
  commentHandlers,
  moveSubject,
  removeSubject,
  moveUser,
  removeUser,
  sweep,
  type Cleanup,
  type SweepResult
} from "./cleanup.js"
import { limits, resolve, type Config } from "./config.js"
import { attachmentEvents } from "./events.js"
import type {
  AttachInput,
  AttachmentsOptions,
  AttachmentSubject,
  CreateUploadInput,
  DetachInput,
  ListFilesInput,
  ListOwnFilesInput,
  ReorderInput,
  TypesOf
} from "./options.js"
import type { AttachedFile, FileInfo } from "./present.js"
import {
  attach,
  deleteFile,
  detach,
  getFile,
  getSettings,
  listFiles,
  listOwnFiles,
  reorder,
  type AttachmentSettings
} from "./records.js"
import { filesById, type BulkStep } from "./removals.js"
import { attachmentRoutes } from "./routes.js"
import { attachmentsSchema } from "./schema.js"
import { completeUpload, createUpload, type CompleteUploadResult, type CreateUploadResult } from "./uploads.js"

/**
 * A change to a record's files a viewer's browser may see, from `toClientEvent`. Files change rarely, so every change
 * is one kind of event, and the browser loads the record's files again.
 */
export interface ClientAttachmentEvent {
  id: string
  type: "subject.changed"
  subjectType: string
  subjectId: string
}

/** The subject type attachments declares for files, so other features can attach to one, such as comments on it. */
export const fileSubjectType = "attachments.file"

const subjectType = z.string().min(1).max(255)
const subjectId = z.string().min(1).max(255)
const fileId = z.string().min(1).max(255)
const record = z.object({ subjectType, subjectId })
const inputs = {
  createUpload: z
    .object({
      name: z.string().min(1).max(limits.nameLength),
      contentType: z.string().min(1).max(255),
      size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      subjectType: subjectType.optional(),
      subjectId: subjectId.optional(),
      owner: z.enum(["user", "org"]).optional()
    })
    .refine((input) => input.subjectId === undefined || input.subjectType !== undefined, {
      message: "Name the subject type of the record.",
      path: ["subjectType"]
    })
    .refine((input) => input.owner === undefined || input.subjectType === undefined, {
      message: "Only files on their own have an owner.",
      path: ["owner"]
    }),
  file: z.object({ fileId }),
  attach: record.extend({ fileIds: z.array(fileId).min(1).max(limits.maxFilesLimit) }),
  detach: record.extend({ fileId }),
  reorder: record.extend({ fileIds: z.array(fileId).max(limits.maxFilesLimit) }),
  listFiles: z.object({ subjectType, subjectIds: z.array(subjectId).max(limits.subjectsPerList) }),
  listOwnFiles: z.object({
    owner: z.enum(["user", "org"]),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(limits.maxOwnFilesPerPage).optional()
  }),
  settings: z.object({ subjectType: subjectType.optional() }),
  record,
  moveSubject: record.extend({ toOrgId: z.string().max(255).nullable() }),
  removeUser: z.object({ userId: z.string().min(1).max(255) }),
  moveUser: z.object({ userId: z.string().min(1).max(255), toUserId: z.string().min(1).max(255) })
}

/** Which records an event changed, for browsers: added, removed, reordered or changed in bulk. */
const recordEvents = new Set([
  "attachment.added",
  "attachment.removed",
  "attachments.reordered",
  "subject.changed",
  "subject.moved"
])

/**
 * Turns a server event into what each viewer's browser may see: `null` for other events and for viewers who can't see
 * the record. Access is checked for all the viewers at once, with one `canViewMany` call.
 */
async function clientEvents(
  config: Config,
  context: Context,
  event: BetterAppsEvent,
  viewers: readonly (Actor | null)[]
): Promise<(ClientAttachmentEvent | null)[]> {
  const none = viewers.map(() => null)
  const data = event.data as {
    subjectType: string
    subjectId: string
    orgId?: string
    toOrgId?: string
    bulk?: boolean
  }
  if (
    event.feature !== "attachments" ||
    !recordEvents.has(event.type) ||
    data.bulk === true ||
    viewers.length === 0 ||
    !Object.hasOwn(config.subjects, data.subjectType) ||
    !context.subjects.has(data.subjectType)
  ) {
    return none
  }
  const ref = { subjectType: data.subjectType, subjectId: data.subjectId }
  // A moved record's event is for viewers in its new organization, and a change's for those in its own.
  const expected = event.type === "subject.moved" ? data.toOrgId : data.orgId
  if (expected !== undefined) {
    const orgId = await orgOf(context.subjects, ref, viewers.find((viewer) => viewer !== null) ?? null)
    if (orgId !== expected) {
      return none
    }
  }
  const visible = await context.subjects.canViewMany(viewers.map((actor) => ({ ...ref, actor })))
  return visible.map((shown) => (shown ? { id: event.id, type: "subject.changed" as const, ...ref } : null))
}

/** Who can see files, as a subject type: each check's actor sees what `canSeeFiles` allows. */
function fileSubject(): SubjectDefinition {
  const check = async (pairs: readonly { actor: Actor | null; subjectId: string }[], context: SubjectContext) => {
    const byId = await filesById(
      context.db,
      pairs.map((pair) => pair.subjectId)
    )
    return Promise.all(
      pairs.map(async ({ actor, subjectId: id }) => {
        const file = byId.get(id)
        return file !== undefined && (await canSeeFiles(context, actor, [file]))[0] === true
      })
    )
  }
  const orgIds = async (refs: readonly { subjectId: string }[], context: SubjectContext) => {
    const byId = await filesById(
      context.db,
      refs.map((ref) => ref.subjectId)
    )
    return refs.map((ref) => byId.get(ref.subjectId)?.orgId || null)
  }
  return {
    canView: async (args, context) => (await check([args], context))[0] === true,
    canViewMany: check,
    getOrgId: async (ref, context) => (await orgIds([ref], context))[0] ?? null,
    getOrgIds: orgIds,
    publicRead: async ({ subjectId: id }, context) =>
      (await check([{ actor: null, subjectId: id }], context))[0] === true
  }
}

/**
 * Files on records the app owns, or on their own. Set up the subject types files go on, such as an app's `invoice` or
 * comments' `comments.comment`, or `standalone` for files on their own; whoever can see a record sees its files.
 */
export function attachments<const Options extends AttachmentsOptions>(options: Options) {
  type Types = TypesOf<Options>
  const config = resolve(options)
  // `serverOnly` keeps its literal type, so the browser client leaves server-only actions out.
  const action = <Input, Output, ServerOnly extends boolean = false>(
    schema: StandardSchemaV1 | null,
    run: (config: Config, context: Context) => Promise<Output>,
    serverOnly?: ServerOnly
  ) =>
    defineAction<StandardSchemaV1<Input, Input>, Output, ServerOnly>({
      input: (schema ?? unchecked<Input>()) as StandardSchemaV1<Input, Input>,
      serverOnly,
      handler: async (context) => run(config, context as Context)
    })
  const serverAction = <Input, Output>(
    schema: StandardSchemaV1 | null,
    run: (config: Config, context: Context) => Promise<Output>
  ) => action<Input, Output, true>(schema, run, true)
  const comments = commentHandlers(config)

  return defineFeature({
    id: "attachments",
    schema: attachmentsSchema,
    events: attachmentEvents,
    subjects: { [fileSubjectType]: fileSubject() },
    usesSubjects: Object.keys(config.subjects),
    // Subscribing makes the app keep an outbox table, so attachments only subscribe when comments' records have files.
    on: comments
      ? {
          comments,
          attachments: { "cleanup.continued": (event, context) => cleanUp(config, context, event.data as Cleanup) }
        }
      : undefined,
    routes: attachmentRoutes(config),
    options,
    actions: {
      createUpload: action<CreateUploadInput<Types["subjectType"]>, CreateUploadResult>(
        inputs.createUpload,
        createUpload
      ),
      completeUpload: action<{ fileId: string }, CompleteUploadResult>(inputs.file, completeUpload),
      attach: action<AttachInput<Types["subjectType"]>, { files: AttachedFile[] }>(inputs.attach, attach),
      detach: action<DetachInput<Types["subjectType"]>, { removed: boolean }>(inputs.detach, detach),
      reorder: action<ReorderInput<Types["subjectType"]>, void>(inputs.reorder, reorder),
      deleteFile: action<{ fileId: string }, { deleted: boolean }>(inputs.file, deleteFile),
      listFiles: action<ListFilesInput<Types["subjectType"]>, Record<string, AttachedFile[]>>(
        inputs.listFiles,
        listFiles
      ),
      getFile: action<{ fileId: string }, FileInfo>(inputs.file, getFile),
      listOwnFiles: action<ListOwnFilesInput, { files: FileInfo[]; cursor: string | null }>(
        inputs.listOwnFiles,
        listOwnFiles
      ),
      getSettings: action<{ subjectType?: Types["subjectType"] | undefined }, AttachmentSettings>(
        inputs.settings,
        getSettings
      ),
      sweep: serverAction<void, SweepResult>(null, async (config, context) => sweep(config, context)),
      removeSubject: serverAction<AttachmentSubject<Types["subjectType"]>, { removed: number } & BulkStep>(
        inputs.record,
        removeSubject
      ),
      moveSubject: serverAction<
        AttachmentSubject<Types["subjectType"]> & { toOrgId: string | null },
        { moved: number } & BulkStep
      >(inputs.moveSubject, moveSubject),
      removeUser: serverAction<{ userId: string }, { removed: number } & BulkStep>(inputs.removeUser, removeUser),
      moveUser: serverAction<{ userId: string; toUserId: string }, { files: number; attachments: number }>(
        inputs.moveUser,
        moveUser
      ),
      toClientEvent: serverAction<{ event: BetterAppsEvent; viewer: Actor | null }, ClientAttachmentEvent | null>(
        null,
        async (config, context) => {
          const { event, viewer } = context.input as { event: BetterAppsEvent; viewer: Actor | null }
          const [shown] = await clientEvents(config, context, event, [viewer])
          return shown ?? null
        }
      ),
      toClientEvents: serverAction<
        { event: BetterAppsEvent; viewers: readonly (Actor | null)[] },
        (ClientAttachmentEvent | null)[]
      >(null, async (config, context) => {
        const { event, viewers } = context.input as { event: BetterAppsEvent; viewers: readonly (Actor | null)[] }
        return clientEvents(config, context, event, viewers)
      })
    }
  })
}

const unchecked = <Input>(): StandardSchemaV1<Input, Input> => ({
  "~standard": { version: 1, vendor: "better-apps", validate: (value) => ({ value: value as Input }) }
})

/** The attachments feature as `attachments()` returns it. */
export type AttachmentsFeature<Options extends AttachmentsOptions = AttachmentsOptions> = ReturnType<
  typeof attachments<Options>
>
