import {
  defineAction,
  defineFeature,
  type Actor,
  type BetterAppsEvent,
  type IdentityUser,
  type StandardSchemaV1
} from "better-apps"
import type { AnchorKind } from "./anchors.js"
import { commentEvents } from "./events.js"
import { textFormat, type BodyFormat } from "./formats.js"
import { inputs } from "./inputs.js"
import type {
  CommentTarget,
  CommentsOptions,
  CreateThreadInput,
  EditCommentInput,
  ReplyInput,
  ThreadTarget,
  TypesOf,
  UpdateAnchorInput,
  UpdateThreadInput
} from "./options.js"
import {
  canViewThread,
  countThreads,
  getThread,
  listThreads,
  suggestMentions,
  toClientEvent,
  type ClientEvent,
  type ThreadPage,
  type ThreadWithComments
} from "./reads.js"
import type { Config, Context } from "./runtime.js"
import { commentModel, commentsSchema, threadModel, type Comment, type CommentThread } from "./schema.js"
import { moveSubject, recountThreads, removeSubject, removeUser, type UpkeepStep } from "./upkeep.js"
import {
  createThread,
  deleteComment,
  deleteThread,
  editComment,
  reopenThread,
  reply,
  resolveThread,
  updateAnchor,
  updateThread
} from "./writes.js"

/** The input of `listThreads`. */
export interface ListThreadsInput<SubjectType extends string = string, AnchorKindName extends string = string> {
  subjectType: SubjectType
  subjectId: string
  status?: "open" | "resolved" | undefined
  /** `null` lists threads on the whole subject. */
  anchorKind?: AnchorKindName | null | undefined
  /** Equality filters on additional fields declared with `index: true`. */
  where?: Record<string, string | number | boolean | null> | undefined
  /** `activity`, the default, puts the most recently active first; `created` the newest. */
  order?: "activity" | "created" | undefined
  cursor?: string | undefined
  /** 20 by default, at most 50. */
  limit?: number | undefined
}

/** The input of `getThread`. */
export interface GetThreadInput {
  threadId: string
  cursor?: string | undefined
  /** 50 by default, at most 100. */
  limit?: number | undefined
}

/** The input of `countThreads`. */
export interface CountThreadsInput<SubjectType extends string = string> {
  subjectType: SubjectType
  /** Up to 50. */
  subjectIds: readonly string[]
  status?: "open" | "resolved" | undefined
}

/** Open and total threads on a subject, counting only visibilities the caller can see. */
export interface ThreadCounts {
  open: number
  total: number
}

/** The input of `suggestMentions`: a thread, or a subject for a thread not created yet. */
export type SuggestMentionsInput<SubjectType extends string = string> =
  | { threadId: string; query: string }
  | { subjectType: SubjectType; subjectId: string; query: string }

/** What `createThread` and `reply` return. */
export interface WriteResult<Thread, Message> {
  thread: Thread
  comment: Message
  /** Mentions that won't notify anyone because those users can't view the thread. Only moderators get the list. */
  droppedMentions: string[]
}

const reserved = new Set([
  ...Object.keys(commentsSchema()[threadModel]?.fields ?? {}),
  ...Object.keys(commentsSchema()[commentModel]?.fields ?? {}),
  "id"
])

function resolve(options: CommentsOptions): Config {
  if (Object.keys(options.subjects).length === 0) {
    throw new Error("Comments need at least one subject type.")
  }
  const formats = new Map<string, BodyFormat>([[textFormat.name, textFormat as BodyFormat]])
  for (const format of options.formats ?? []) {
    if (formats.has(format.name)) {
      throw new Error(`The "${format.name}" body format is registered twice.`)
    }
    formats.set(format.name, format)
  }
  const anchors = new Map<string, AnchorKind>()
  for (const anchor of options.anchors ?? []) {
    if (anchors.has(anchor.kind)) {
      throw new Error(`The "${anchor.kind}" anchor kind is registered twice.`)
    }
    anchors.set(anchor.kind, anchor)
  }
  const threadFields = options.additionalFields?.thread ?? {}
  const commentFields = options.additionalFields?.comment ?? {}
  for (const name of [...Object.keys(threadFields), ...Object.keys(commentFields)]) {
    if (reserved.has(name)) {
      throw new Error(`"${name}" is a comments field, so it can't be an additional field.`)
    }
  }
  return {
    subjects: options.subjects,
    anchors,
    formats,
    hooks: options.hooks?.before ?? {},
    threadFields,
    commentFields
  }
}

const unchecked = <Input>(): StandardSchemaV1<Input, Input> => ({
  "~standard": { version: 1, vendor: "better-apps", validate: (value) => ({ value: value as Input }) }
})

/**
 * Comment threads on records the app owns, optionally pinned to a spot inside them. Register at least one subject
 * type; anchor kinds, body formats, before hooks and additional fields are optional.
 */
export function comments<const Options extends CommentsOptions>(options: Options) {
  type Types = TypesOf<Options>
  type Thread = CommentThread & Types["threadFields"]
  type Message = Comment & Types["commentFields"]
  type Kind = Types["anchor"]["kind"]
  const config = resolve(options)
  // `serverOnly` keeps its literal type, so the browser client leaves server-only actions out.
  const action = <Input, Output, ServerOnly extends boolean = false>(
    schema: StandardSchemaV1 | null,
    run: (config: Config, context: Context) => Promise<unknown>,
    serverOnly?: ServerOnly
  ) =>
    defineAction<StandardSchemaV1<Input, Input>, Output, ServerOnly>({
      input: (schema ?? unchecked<Input>()) as StandardSchemaV1<Input, Input>,
      serverOnly,
      handler: async (context) => (await run(config, context as Context)) as Output
    })
  const serverAction = <Input, Output>(
    schema: StandardSchemaV1 | null,
    run: (config: Config, context: Context) => Promise<unknown>
  ) => action<Input, Output, true>(schema, run, true)

  return defineFeature({
    id: "comments",
    schema: commentsSchema(options.additionalFields),
    events: commentEvents,
    options,
    actions: {
      listThreads: action<ListThreadsInput<Types["subjectType"], Kind>, ThreadPage<Thread>>(
        inputs.listThreads,
        listThreads
      ),
      getThread: action<GetThreadInput, ThreadWithComments<Thread, Message>>(inputs.getThread, getThread),
      countThreads: action<CountThreadsInput<Types["subjectType"]>, Record<string, ThreadCounts>>(
        inputs.countThreads,
        countThreads
      ),
      createThread: action<CreateThreadInput<Types>, WriteResult<Thread, Message>>(inputs.createThread, createThread),
      reply: action<ReplyInput<Types>, WriteResult<Thread, Message>>(inputs.reply, reply),
      editComment: action<EditCommentInput<Types>, { comment: Message; droppedMentions: string[] }>(
        inputs.editComment,
        editComment
      ),
      deleteComment: action<CommentTarget, { comment: Message; threadDeleted: boolean }>(
        inputs.deleteComment,
        deleteComment
      ),
      resolveThread: action<ThreadTarget, Thread>(inputs.thread, resolveThread),
      reopenThread: action<ThreadTarget, Thread>(inputs.thread, reopenThread),
      updateThread: action<UpdateThreadInput<Types>, Thread>(inputs.updateThread, updateThread),
      updateAnchor: action<UpdateAnchorInput<Types>, Thread>(inputs.updateAnchor, updateAnchor),
      deleteThread: action<ThreadTarget, { threadId: string }>(inputs.thread, deleteThread),
      suggestMentions: action<SuggestMentionsInput<Types["subjectType"]>, IdentityUser[]>(
        inputs.suggestMentions,
        suggestMentions
      ),
      removeSubject: serverAction<{ subjectType: Types["subjectType"]; subjectId: string }, UpkeepStep>(
        inputs.removeSubject,
        removeSubject
      ),
      moveSubject: serverAction<
        { subjectType: Types["subjectType"]; subjectId: string; toOrgId: string | null },
        UpkeepStep
      >(inputs.moveSubject, moveSubject),
      removeUser: serverAction<{ userId: string }, UpkeepStep>(inputs.removeUser, removeUser),
      recountThreads: serverAction<
        { threadIds: readonly string[] } | { subjectType: Types["subjectType"]; subjectId: string; cursor?: string },
        UpkeepStep & { cursor: string | null }
      >(inputs.recountThreads, recountThreads),
      canViewThread: serverAction<
        { actor: Actor | null; threadId: string } | { actor: Actor | null; thread: CommentThread },
        boolean
      >(null, canViewThread),
      toClientEvent: serverAction<{ event: BetterAppsEvent; viewer: Actor | null }, ClientEvent | null>(
        null,
        toClientEvent
      )
    }
  })
}

/** The comments feature as `comments()` returns it. */
export type CommentsFeature<Options extends CommentsOptions = CommentsOptions> = ReturnType<typeof comments<Options>>
