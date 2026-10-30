import type { Author, WriteOperation } from "better-apps"
import { accessTo, isDeclaredVisibility, orgOf, requireView, subjectOf } from "./access.js"
import { checkAnchor, checkContent, checkFields, checkMetadata, stableJson, type CheckedContent } from "./content.js"
import { CommentsError } from "./errors.js"
import { inputs } from "./inputs.js"
import type {
  CommentRules,
  CommentTarget,
  CreateThreadInput,
  EditCommentInput,
  ReplyInput,
  ThreadTarget,
  UpdateAnchorInput,
  UpdateThreadInput
} from "./options.js"
import {
  authorIdOf,
  callerOf,
  checkMentions,
  forbid,
  loadThread,
  requireAuthor,
  runHook,
  threadAccess,
  wrote,
  type Config,
  type Context
} from "./runtime.js"
import { commentModel, threadModel, type Comment, type CommentThread } from "./schema.js"
import { ulid } from "./ulid.js"

const taken = () => new CommentsError("INVALID_INPUT", "That id can't be used.")

function sameContent(comment: Comment, content: CheckedContent): boolean {
  return comment.format === content.format && stableJson(comment.body) === stableJson(content.body)
}

function eventData(thread: CommentThread) {
  return { subjectType: thread.subjectType, subjectId: thread.subjectId, orgId: thread.orgId, thread }
}

function emitMentions(context: Context, thread: CommentThread, comment: Comment, userIds: readonly string[]): void {
  for (const userId of userIds) {
    context.emit("comment.mentioned", { ...eventData(thread), comment, userId })
  }
}

function requireFields(declared: Config["threadFields"], values: Record<string, unknown>): void {
  for (const [name, field] of Object.entries(declared)) {
    if (field.required !== false && field.defaultValue === undefined && values[name] === undefined) {
      throw new CommentsError("INVALID_INPUT", `The "${name}" field is required.`)
    }
  }
}

function commentRow(
  id: string,
  thread: CommentThread,
  author: Author,
  content: CheckedContent,
  createdAt: Date,
  fields: Record<string, unknown>
): Comment {
  return {
    id,
    threadId: thread.id,
    orgId: thread.orgId,
    authorType: author.type,
    authorId: authorIdOf(author),
    authorName: author.type === "user" ? null : author.name,
    format: content.format,
    body: content.body,
    bodyText: content.bodyText,
    createdAt,
    editedAt: null,
    deletedAt: null,
    metadata: null,
    ...fields
  }
}

/** Metadata from a write, checked: server code writes any, clients only what the subject type's schema allows. */
async function writableMetadata(context: Context, rules: CommentRules, metadata: Record<string, unknown> | null) {
  forbid(context.source === "api" || rules.metadata !== undefined, "Only server code can write this metadata.")
  return checkMetadata(context.source === "api" ? undefined : rules.metadata, metadata)
}

export async function createThread(config: Config, context: Context) {
  const author = requireAuthor(context)
  const caller = callerOf(context)
  const original = context.input as CreateThreadInput
  const { subjectType, subjectId } = original
  const rules = subjectOf(config.subjects, subjectType)
  const ref = { subjectType, subjectId }
  const orgId = await orgOf(context.subjects, caller, ref)
  const requireAccess = async (visibility: string) => {
    if (!isDeclaredVisibility(rules, visibility)) {
      throw new CommentsError("INVALID_INPUT", `The "${subjectType}" subject type has no "${visibility}" visibility.`)
    }
    const access = await accessTo(rules, context.subjects, caller, ref, visibility)
    requireView(access)
    forbid(access.comment, "You can't comment here.")
    return access
  }
  let access = await requireAccess(original.visibility ?? "default")
  const changed = await runHook(
    config.hooks.createThread,
    { actor: context.actor, author, thread: null, input: original },
    inputs.createThread
  )
  const input = { ...changed, subjectType, subjectId }
  const visibility = input.visibility ?? "default"
  if (visibility !== (original.visibility ?? "default")) {
    access = await requireAccess(visibility)
  }
  const fields = checkFields(config.threadFields, input.fields)
  requireFields(config.threadFields, fields)
  const commentFields = checkFields(config.commentFields, input.commentFields)
  requireFields(config.commentFields, commentFields)
  const metadata =
    input.metadata === null || input.metadata === undefined
      ? null
      : await writableMetadata(context, rules, input.metadata)
  const anchor = await checkAnchor(config.anchors, input.anchor)
  const content = await checkContent(config.formats, input.format, input.body)
  const authorId = authorIdOf(author)
  const id = input.id ?? ulid(context.now.getTime())
  const commentId = input.commentId ?? ulid(context.now.getTime())

  // A retry with the same ids returns what the first attempt wrote.
  const replay = async () => {
    const existing = await context.db.findOne<CommentThread>({
      model: threadModel,
      where: [{ field: "id", value: id }]
    })
    if (!existing) {
      return null
    }
    if (existing.createdBy !== authorId || existing.subjectType !== subjectType || existing.subjectId !== subjectId) {
      throw taken()
    }
    const [first] = await context.db.findMany<Comment>({
      model: commentModel,
      where: [{ field: "threadId", value: id }],
      sortBy: [
        { field: "createdAt", direction: "asc" },
        { field: "id", direction: "asc" }
      ],
      limit: 1
    })
    if (first && first.id === commentId && wrote(author, first) && sameContent(first, content)) {
      return { thread: existing, comment: first, droppedMentions: [] as string[] }
    }
    throw new CommentsError("CONFLICT", "You already used that id for a different thread.")
  }
  if (input.id !== undefined) {
    const replayed = await replay()
    if (replayed) {
      return replayed
    }
  }
  if (
    input.commentId !== undefined &&
    (await context.db.findOne({ model: commentModel, where: [{ field: "id", value: commentId }] }))
  ) {
    throw taken()
  }

  const now = context.now
  const thread: CommentThread = {
    id,
    orgId,
    subjectType,
    subjectId,
    visibility,
    ...anchor,
    status: "open",
    resolvedAt: null,
    resolvedBy: null,
    createdBy: authorId,
    createdAt: now,
    lastActivityAt: now,
    commentCount: 1,
    metadata,
    ...fields
  }
  const comment = commentRow(commentId, thread, author, content, now, commentFields)
  const mentions = await checkMentions(config, context, thread, content.mentions, authorId)
  context.emit("thread.created", { ...eventData(thread), comment })
  context.emit("comment.created", { ...eventData(thread), comment })
  emitMentions(context, thread, comment, mentions.allowed)
  try {
    const [createdThread, createdComment] = await context.db.batch([
      { type: "create", model: threadModel, data: thread },
      { type: "create", model: commentModel, data: comment }
    ])
    return {
      thread: createdThread as unknown as CommentThread,
      comment: createdComment as unknown as Comment,
      // The list reveals who can see the subject, so only moderators get it.
      droppedMentions: access.moderate ? mentions.dropped : []
    }
  } catch (error) {
    const replayed = input.id === undefined ? null : await replay()
    if (replayed) {
      return replayed
    }
    throw error
  }
}

export async function reply(config: Config, context: Context) {
  const author = requireAuthor(context)
  const original = context.input as ReplyInput
  const thread = await loadThread(context, original.threadId)
  const { access } = await threadAccess(config, context, thread)
  requireView(access)
  forbid(access.comment, "You can't reply here.")
  const hookArgs = { actor: context.actor, author, thread }
  const input = {
    ...(await runHook(config.hooks.reply, { ...hookArgs, input: original }, inputs.reply)),
    threadId: thread.id
  }
  const reopens = thread.status === "resolved"
  if (reopens) {
    await runHook(config.hooks.reopenThread, { ...hookArgs, input: { threadId: thread.id } }, inputs.thread)
  }
  const fields = checkFields(config.commentFields, input.fields)
  requireFields(config.commentFields, fields)
  const content = await checkContent(config.formats, input.format, input.body)
  const authorId = authorIdOf(author)
  const id = input.id ?? ulid(context.now.getTime())

  const replay = async () => {
    const existing = await context.db.findOne<Comment>({ model: commentModel, where: [{ field: "id", value: id }] })
    if (!existing) {
      return null
    }
    if (existing.threadId !== thread.id || !wrote(author, existing)) {
      throw taken()
    }
    if (!sameContent(existing, content)) {
      throw new CommentsError("CONFLICT", "You already used that id for a different comment.")
    }
    return { thread: await loadThread(context, thread.id), comment: existing, droppedMentions: [] as string[] }
  }
  if (input.id !== undefined) {
    const replayed = await replay()
    if (replayed) {
      return replayed
    }
  }

  const now = context.now
  const lastActivityAt = now > thread.lastActivityAt ? now : thread.lastActivityAt
  const reopened = reopens ? { status: "open" as const, resolvedAt: null, resolvedBy: null } : {}
  const updated: CommentThread = { ...thread, ...reopened, commentCount: thread.commentCount + 1, lastActivityAt }
  const comment = commentRow(id, thread, author, content, now, fields)
  const mentions = await checkMentions(config, context, thread, content.mentions, authorId)
  context.emit("comment.created", { ...eventData(updated), comment })
  emitMentions(context, updated, comment, mentions.allowed)
  if (reopens) {
    context.emit("thread.reopened", eventData(updated))
  }
  try {
    const [counted, created] = await context.db.batch([
      {
        type: "incrementOne",
        model: threadModel,
        where: [{ field: "id", value: thread.id }],
        increment: { commentCount: 1 },
        set: { lastActivityAt, ...reopened }
      },
      { type: "create", model: commentModel, data: comment }
    ])
    return {
      thread: (counted ?? updated) as unknown as CommentThread,
      comment: created as unknown as Comment,
      droppedMentions: access.moderate ? mentions.dropped : []
    }
  } catch (error) {
    const replayed = input.id === undefined ? null : await replay()
    if (replayed) {
      return replayed
    }
    throw error
  }
}

async function loadComment(context: Context, commentId: string): Promise<Comment> {
  const comment = await context.db.findOne<Comment>({ model: commentModel, where: [{ field: "id", value: commentId }] })
  if (!comment) {
    throw new CommentsError("NOT_FOUND", "That comment doesn't exist, or you can't see it.")
  }
  return comment
}

export async function editComment(config: Config, context: Context) {
  const author = requireAuthor(context)
  const original = context.input as EditCommentInput
  const comment = await loadComment(context, original.commentId)
  const thread = await loadThread(context, comment.threadId)
  const { caller, access } = await threadAccess(config, context, thread)
  requireView(access)
  forbid(caller.trusted || (wrote(author, comment) && access.comment), "Only the author can edit this comment.")
  if (comment.deletedAt || comment.body === null) {
    throw new CommentsError("INVALID_INPUT", "A deleted comment can't be edited.")
  }
  const input = {
    ...(await runHook(
      config.hooks.editComment,
      { actor: context.actor, author, thread, input: original },
      inputs.editComment
    )),
    commentId: comment.id
  }
  const content = await checkContent(config.formats, input.format, input.body)
  if (sameContent(comment, content)) {
    return { comment, droppedMentions: [] as string[] }
  }
  const previous = await checkContent(config.formats, comment.format, comment.body).catch(() => null)
  const added = content.mentions.filter((id) => !previous?.mentions.includes(id))
  const mentions = await checkMentions(config, context, thread, added, comment.authorId)
  const edited: Comment = {
    ...comment,
    format: content.format,
    body: content.body,
    bodyText: content.bodyText,
    editedAt: context.now
  }
  context.emit("comment.edited", {
    ...eventData(thread),
    comment: edited,
    previousFormat: comment.format,
    previousBody: comment.body
  })
  emitMentions(context, thread, edited, mentions.allowed)
  const [updated] = await context.db.batch([
    {
      type: "update",
      model: commentModel,
      where: [{ field: "id", value: comment.id }],
      update: { format: edited.format, body: edited.body, bodyText: edited.bodyText, editedAt: edited.editedAt }
    }
  ])
  return {
    comment: (updated ?? edited) as unknown as Comment,
    droppedMentions: access.moderate ? mentions.dropped : []
  }
}

export async function deleteComment(config: Config, context: Context) {
  const author = requireAuthor(context)
  const original = context.input as CommentTarget
  const comment = await loadComment(context, original.commentId)
  const thread = await loadThread(context, comment.threadId)
  const { access } = await threadAccess(config, context, thread)
  requireView(access)
  forbid(access.moderate || (wrote(author, comment) && access.comment), "You can't delete this comment.")
  if (comment.deletedAt) {
    return { comment, threadDeleted: false }
  }
  await runHook(
    config.hooks.deleteComment,
    { actor: context.actor, author, thread, input: original },
    inputs.deleteComment
  )
  const deleted: Comment = { ...comment, body: null, bodyText: "", deletedAt: context.now }
  const remaining: CommentThread = { ...thread, commentCount: thread.commentCount - 1 }
  context.emit("comment.deleted", {
    ...eventData(remaining),
    comment: deleted,
    previousBody: comment.body,
    previousText: comment.bodyText
  })
  const operations: WriteOperation[] = [
    {
      type: "update",
      model: commentModel,
      where: [{ field: "id", value: comment.id }],
      update: { body: null, bodyText: "", deletedAt: deleted.deletedAt }
    },
    {
      type: "incrementOne",
      model: threadModel,
      where: [{ field: "id", value: thread.id }],
      increment: { commentCount: -1 }
    }
  ]
  const last = thread.commentCount <= 1
  if (last) {
    // The thread goes with its last comment, but only while its count is zero inside the batch, so a reply that lands
    // first keeps it.
    operations.push(
      {
        type: "deleteMany",
        model: commentModel,
        where: [
          { field: "threadId", value: thread.id },
          { field: "deletedAt", operator: "ne", value: null }
        ]
      },
      {
        type: "deleteMany",
        model: threadModel,
        where: [
          { field: "id", value: thread.id },
          { field: "commentCount", value: 0 }
        ]
      }
    )
  }
  const results = await context.db.batch(operations)
  const threadDeleted = last && results[3] === 1
  if (threadDeleted) {
    // Emitted only once the thread is really gone, so a reply that won the race never sees its thread reported deleted.
    context.emit("thread.deleted", eventData(remaining))
  }
  return { comment: deleted, threadDeleted }
}

async function changeStatus(config: Config, context: Context, status: "open" | "resolved") {
  const author = requireAuthor(context)
  const original = context.input as ThreadTarget
  const thread = await loadThread(context, original.threadId)
  const { access } = await threadAccess(config, context, thread)
  requireView(access)
  forbid(access.comment, status === "resolved" ? "You can't resolve this thread." : "You can't reopen this thread.")
  const hook = status === "resolved" ? config.hooks.resolveThread : config.hooks.reopenThread
  await runHook(hook, { actor: context.actor, author, thread, input: original }, inputs.thread)
  if (thread.status === status) {
    return thread
  }
  const change =
    status === "resolved"
      ? { status, resolvedAt: context.now, resolvedBy: authorIdOf(author) }
      : { status, resolvedAt: null, resolvedBy: null }
  const changed: CommentThread = { ...thread, ...change }
  context.emit(status === "resolved" ? "thread.resolved" : "thread.reopened", eventData(changed))
  const [updated] = await context.db.batch([
    { type: "update", model: threadModel, where: [{ field: "id", value: thread.id }], update: change }
  ])
  return (updated ?? changed) as unknown as CommentThread
}

export const resolveThread = (config: Config, context: Context) => changeStatus(config, context, "resolved")
export const reopenThread = (config: Config, context: Context) => changeStatus(config, context, "open")

function createdByCaller(thread: CommentThread, author: Author): boolean {
  return author.type === "user" && thread.createdBy === author.userId
}

export async function updateThread(config: Config, context: Context) {
  const author = requireAuthor(context)
  const original = context.input as UpdateThreadInput
  const thread = await loadThread(context, original.threadId)
  const { rules, access } = await threadAccess(config, context, thread)
  requireView(access)
  forbid(access.moderate || (createdByCaller(thread, author) && access.comment), "You can't change this thread.")
  const input = {
    ...(await runHook(
      config.hooks.updateThread,
      { actor: context.actor, author, thread, input: original },
      inputs.updateThread
    )),
    threadId: thread.id
  }
  const change: Record<string, unknown> = checkFields(config.threadFields, input.fields)
  if (input.metadata !== undefined) {
    change.metadata = input.metadata === null ? null : await writableMetadata(context, rules, input.metadata)
  }
  if (input.visibility !== undefined && input.visibility !== thread.visibility) {
    forbid(access.moderate, "Only moderators can change who sees a thread.")
    if (!isDeclaredVisibility(rules, input.visibility)) {
      throw new CommentsError(
        "INVALID_INPUT",
        `The "${thread.subjectType}" subject type has no "${input.visibility}" visibility.`
      )
    }
    change.visibility = input.visibility
  }
  const changes = Object.keys(change).filter(
    (key) => stableJson(change[key]) !== stableJson((thread as unknown as Record<string, unknown>)[key])
  )
  if (changes.length === 0) {
    return thread
  }
  const update = Object.fromEntries(changes.map((key) => [key, change[key]]))
  const previous = Object.fromEntries(changes.map((key) => [key, (thread as unknown as Record<string, unknown>)[key]]))
  const changed = { ...thread, ...update } as CommentThread
  context.emit("thread.updated", { ...eventData(changed), previous })
  const [updated] = await context.db.batch([
    { type: "update", model: threadModel, where: [{ field: "id", value: thread.id }], update }
  ])
  return (updated ?? changed) as unknown as CommentThread
}

export async function updateAnchor(config: Config, context: Context) {
  const author = requireAuthor(context)
  const original = context.input as UpdateAnchorInput
  const thread = await loadThread(context, original.threadId)
  const { access } = await threadAccess(config, context, thread)
  requireView(access)
  forbid(access.moderate || (createdByCaller(thread, author) && access.comment), "You can't move this thread.")
  const input = await runHook(
    config.hooks.updateAnchor,
    { actor: context.actor, author, thread, input: original },
    inputs.updateAnchor
  )
  const anchor = await checkAnchor(config.anchors, input.anchor)
  const previousAnchor =
    thread.anchorKind === null ? null : { kind: thread.anchorKind, value: thread.anchor, version: thread.anchorVersion }
  const changed: CommentThread = { ...thread, ...anchor }
  context.emit("thread.anchorUpdated", { ...eventData(changed), previousAnchor })
  const [updated] = await context.db.batch([
    { type: "update", model: threadModel, where: [{ field: "id", value: thread.id }], update: { ...anchor } }
  ])
  return (updated ?? changed) as unknown as CommentThread
}

export async function deleteThread(config: Config, context: Context) {
  const author = requireAuthor(context)
  const original = context.input as ThreadTarget
  const thread = await loadThread(context, original.threadId)
  const { access } = await threadAccess(config, context, thread)
  requireView(access)
  forbid(access.moderate, "Only moderators can delete a thread.")
  await runHook(config.hooks.deleteThread, { actor: context.actor, author, thread, input: original }, inputs.thread)
  context.emit("thread.deleted", eventData(thread))
  await context.db.batch([
    { type: "deleteMany", model: commentModel, where: [{ field: "threadId", value: thread.id }] },
    { type: "deleteMany", model: threadModel, where: [{ field: "id", value: thread.id }] }
  ])
  return { threadId: thread.id }
}
