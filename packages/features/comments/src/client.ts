// The framework-free browser half of comments: a store of threads and comments that any framework binds to, with
// optimistic writes under client-generated ids and live updates through `applyEvent`. It imports no server code.
import type { BetterApp, IdentityUser } from "better-apps"
import { createStore, type BetterAppsClient, type Serialized, type Store } from "better-apps/client"
import type {
  CountThreadsInput,
  GetThreadInput,
  ListThreadsInput,
  SuggestMentionsInput,
  ThreadCounts
} from "./feature.js"
import { textFormat } from "./formats.js"
import type {
  CommentTarget,
  CommentsOptions,
  CommentsTypes,
  CreateThreadInput,
  EditCommentInput,
  ReplyInput,
  ThreadTarget,
  TypesOf,
  UpdateAnchorInput,
  UpdateThreadInput
} from "./options.js"
import type { ClientEvent } from "./reads.js"
import type { Comment, CommentThread } from "./schema.js"
import { ulid } from "./ulid.js"

export { elementAnchorFor, resolveAnchor, selectorFor, type AnchorResolution } from "./anchor-dom.js"
export { mentionToken, textFormat } from "./formats.js"
export { isUlid, ulid } from "./ulid.js"

type CommentsFeatureOf<App> =
  App extends BetterApp<infer Features> ? Extract<Features[number], { id: "comments" }> : never

/** The comments types of an app, from `typeof app`. */
export type AppCommentsTypes<App> =
  CommentsFeatureOf<App> extends { options: infer Options extends CommentsOptions } ? TypesOf<Options> : CommentsTypes

/** Which record a list of threads is about. */
export interface Subject<SubjectType extends string = string> {
  subjectType: SubjectType
  subjectId: string
}

/** How a list of threads is filtered and ordered. */
export interface ListOptions {
  status?: "open" | "resolved" | undefined
  order?: "activity" | "created" | undefined
}

/** Where a load stands. `error` holds the client error when it failed. */
export type LoadState = "idle" | "loading" | "ready" | "error"

/** A loaded list of a subject's threads, as ids into `threads`. */
export interface ThreadList {
  subjectType: string
  subjectId: string
  status: "open" | "resolved" | null
  order: "activity" | "created"
  ids: string[]
  cursor: string | null
  state: LoadState
  error: Error | null
}

/** A thread's loaded comments, oldest first, as ids into `comments`. */
export interface ThreadComments {
  ids: string[]
  cursor: string | null
  state: LoadState
  error: Error | null
}

/** Everything the store holds. Dates are `Date`s again, except in additional fields. */
export interface CommentsState<Thread = CommentThread, Message = Comment> {
  threads: Readonly<Record<string, Thread>>
  comments: Readonly<Record<string, Message>>
  threadComments: Readonly<Record<string, ThreadComments>>
  lists: Readonly<Record<string, ThreadList>>
  counts: Readonly<Record<string, ThreadCounts & { state: LoadState }>>
  /** Names and avatars by user id, from reads. */
  users: Readonly<Record<string, IdentityUser>>
  /** Ids of threads and comments written here and not yet confirmed by the server. */
  pending: Readonly<Record<string, true>>
}

/** A store snapshot as JSON carries it, for server rendering. */
export type DehydratedComments = Serialized<CommentsState>

/** Keys a list by its subject and options. */
export function listKey(subject: Subject, options: ListOptions = {}): string {
  return JSON.stringify([subject.subjectType, subject.subjectId, options.status ?? null, options.order ?? "activity"])
}

/** Keys a subject's counts. */
export function countKey(subjectType: string, subjectId: string): string {
  return JSON.stringify([subjectType, subjectId])
}

const toDate = (value: unknown) => (typeof value === "string" ? new Date(value) : (value as Date | null))

function reviveThread<Thread>(thread: unknown): Thread {
  const row = thread as Record<string, unknown>
  return {
    ...row,
    createdAt: toDate(row.createdAt),
    lastActivityAt: toDate(row.lastActivityAt),
    resolvedAt: toDate(row.resolvedAt ?? null)
  } as Thread
}

function reviveComment<Message>(comment: unknown): Message {
  const row = comment as Record<string, unknown>
  return {
    ...row,
    createdAt: toDate(row.createdAt),
    editedAt: toDate(row.editedAt ?? null),
    deletedAt: toDate(row.deletedAt ?? null)
  } as Message
}

const empty: CommentsState = {
  threads: {},
  comments: {},
  threadComments: {},
  lists: {},
  counts: {},
  users: {},
  pending: {}
}

function without<Value>(record: Readonly<Record<string, Value>>, ...keys: string[]): Record<string, Value> {
  const copy = { ...record }
  for (const key of keys) {
    delete copy[key]
  }
  return copy
}

const remembered = 1000

/** The comments client: a store plus the actions that fill it. */
export type CommentsClient<Types extends CommentsTypes = CommentsTypes> = ReturnType<
  typeof createCommentsClientFor<Types>
>

/**
 * Creates the comments store for a Better Apps client. Pass `typeof app` as the client's type to get the app's subject
 * types, anchors, formats and additional fields.
 */
export function createCommentsClient<App = BetterApp>(client: BetterAppsClient<App>) {
  return createCommentsClientFor<AppCommentsTypes<App>>(client.$call)
}

function createCommentsClientFor<Types extends CommentsTypes>(
  call: (feature: string, action: string, input?: unknown) => Promise<unknown>
) {
  type Thread = CommentThread & Types["threadFields"]
  type Message = Comment & Types["commentFields"]
  type State = CommentsState<Thread, Message>
  const store: Store<State> = createStore(empty as State)
  const run = (action: string, input: unknown) => call("comments", action, input)
  const applied: string[] = []
  const update = (change: (state: State) => State) => store.setState(change)

  const mergeUsers = (state: State, users: Record<string, IdentityUser> | undefined): State =>
    users && Object.keys(users).length > 0 ? { ...state, users: { ...state.users, ...users } } : state

  /**
   * Keeps a thread's place in its subject's lists: a new thread goes on top, a new comment moves its thread to the top
   * of lists by activity, and a thread leaves lists whose status it no longer has. A thread a list hasn't loaded is
   * only added when it's new or just had activity, since its place is otherwise unknown.
   */
  const placeThread = (state: State, thread: Thread, change: { isNew?: boolean; bump?: boolean }): State => {
    const lists = { ...state.lists }
    for (const [key, list] of Object.entries(state.lists)) {
      if (list.subjectType !== thread.subjectType || list.subjectId !== thread.subjectId) {
        continue
      }
      const present = list.ids.includes(thread.id)
      const rest = list.ids.filter((id) => id !== thread.id)
      const toTop = change.isNew === true || (change.bump === true && list.order === "activity")
      if (list.status !== null && list.status !== thread.status) {
        lists[key] = present ? { ...list, ids: rest } : list
      } else if (toTop) {
        lists[key] = { ...list, ids: [thread.id, ...rest] }
      }
    }
    return { ...state, lists }
  }

  const countChange = (state: State, thread: Thread, total: number, open: number): State => {
    const key = countKey(thread.subjectType, thread.subjectId)
    const counts = state.counts[key]
    if (!counts) {
      return state
    }
    return {
      ...state,
      counts: { ...state.counts, [key]: { ...counts, total: counts.total + total, open: counts.open + open } }
    }
  }

  const putThread = (state: State, thread: Thread): State => ({
    ...state,
    threads: { ...state.threads, [thread.id]: thread }
  })

  const putComment = (state: State, comment: Message, append: boolean): State => {
    const loaded = state.threadComments[comment.threadId]
    const threadComments =
      append && loaded && !loaded.ids.includes(comment.id)
        ? { ...state.threadComments, [comment.threadId]: { ...loaded, ids: [...loaded.ids, comment.id] } }
        : state.threadComments
    return { ...state, comments: { ...state.comments, [comment.id]: comment }, threadComments }
  }

  const removeThread = (state: State, threadId: string): State => {
    const thread = state.threads[threadId]
    const commentIds = state.threadComments[threadId]?.ids ?? []
    let next: State = {
      ...state,
      threads: without(state.threads, threadId),
      comments: without(state.comments, ...commentIds),
      threadComments: without(state.threadComments, threadId),
      lists: Object.fromEntries(
        Object.entries(state.lists).map(([key, list]) => [
          key,
          { ...list, ids: list.ids.filter((id) => id !== threadId) }
        ])
      )
    }
    if (thread) {
      next = countChange(next, thread, -1, thread.status === "open" ? -1 : 0)
    }
    return next
  }

  /** Applies a change now and returns a function that undoes it, for when the server refuses the write. */
  const optimistic = (change: (state: State) => State, ids: readonly string[]) => {
    const before = store.getSnapshot()
    update((state) => {
      const next = change(state)
      return { ...next, pending: { ...next.pending, ...Object.fromEntries(ids.map((id) => [id, true as const])) } }
    })
    const settle = () => update((state) => ({ ...state, pending: without(state.pending, ...ids) }))
    const undo = () =>
      update((state) => ({
        ...before,
        // Keep what was loaded meanwhile; only the optimistic change is rolled back.
        users: state.users,
        pending: without(state.pending, ...ids)
      }))
    return { settle, undo }
  }

  async function write<Output>(
    action: string,
    input: unknown,
    change: (state: State) => State,
    ids: readonly string[],
    confirm: (state: State, output: Output) => State
  ): Promise<Output> {
    const { settle, undo } = optimistic(change, ids)
    let output: Output
    try {
      output = (await run(action, input)) as Output
    } catch (error) {
      undo()
      throw error
    }
    update((state) => confirm(state, output))
    settle()
    return output
  }

  const existing = (threadId: string) => {
    const thread = store.getSnapshot().threads[threadId]
    if (!thread) {
      throw new Error(`Load thread ${threadId} before changing it.`)
    }
    return thread
  }

  return {
    store,

    /** Loads the first page of a subject's threads. */
    async loadThreads(subject: Subject<Types["subjectType"]>, options: ListOptions = {}) {
      const key = listKey(subject, options)
      const blank: ThreadList = {
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        status: options.status ?? null,
        order: options.order ?? "activity",
        ids: [],
        cursor: null,
        state: "loading",
        error: null
      }
      update((state) => ({
        ...state,
        lists: { ...state.lists, [key]: { ...(state.lists[key] ?? blank), state: "loading", error: null } }
      }))
      await loadPage(key, { ...subject, ...options } as ListThreadsInput, false)
    },

    /** Loads the next page of a list loaded with `loadThreads`. */
    async loadMoreThreads(subject: Subject<Types["subjectType"]>, options: ListOptions = {}) {
      const key = listKey(subject, options)
      const list = store.getSnapshot().lists[key]
      if (!list?.cursor || list.state === "loading") {
        return
      }
      update((state) => ({ ...state, lists: { ...state.lists, [key]: { ...list, state: "loading" } } }))
      await loadPage(key, { ...subject, ...options, cursor: list.cursor } as ListThreadsInput, true)
    },

    /** Loads a thread and the first page of its comments. */
    async loadThread(threadId: string) {
      await loadComments({ threadId }, false)
    },

    /** Loads the next page of a thread's comments. */
    async loadMoreComments(threadId: string) {
      const loaded = store.getSnapshot().threadComments[threadId]
      if (loaded?.cursor && loaded.state !== "loading") {
        await loadComments({ threadId, cursor: loaded.cursor }, true)
      }
    },

    /** Loads open and total counts for many subjects, 50 per call. */
    async loadCounts(subjectType: Types["subjectType"], subjectIds: readonly string[]) {
      const unique = [...new Set(subjectIds)]
      const pages: string[][] = []
      for (let start = 0; start < unique.length; start += 50) {
        pages.push(unique.slice(start, start + 50))
      }
      await Promise.all(
        pages.map(async (page) => {
          const input: CountThreadsInput = { subjectType, subjectIds: page }
          const counts = (await run("countThreads", input)) as Record<string, ThreadCounts>
          update((state) => ({
            ...state,
            counts: {
              ...state.counts,
              ...Object.fromEntries(
                page.map((subjectId) => [
                  countKey(subjectType, subjectId),
                  { ...(counts[subjectId] ?? { open: 0, total: 0 }), state: "ready" as const }
                ])
              )
            }
          }))
        })
      )
    },

    /** Starts a thread. It shows at once under its final id, and is rolled back if the server refuses it. */
    async createThread(input: CreateThreadInput<Types>) {
      const id = input.id ?? ulid()
      const commentId = input.commentId ?? ulid()
      const now = new Date()
      const anchor = input.anchor ?? null
      const thread = {
        id,
        orgId: "",
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        visibility: input.visibility ?? "default",
        anchorKind: anchor?.kind ?? null,
        anchor: anchor?.value ?? null,
        anchorVersion: anchor?.version ?? null,
        status: "open",
        resolvedAt: null,
        resolvedBy: null,
        createdBy: "",
        createdAt: now,
        lastActivityAt: now,
        commentCount: 1,
        metadata: input.metadata ?? null,
        ...input.fields
      } as Thread
      const comment = draftComment(commentId, thread, input, now, input.commentFields)
      const output = await write<{ thread: unknown; comment: unknown; droppedMentions: string[] }>(
        "createThread",
        { ...input, id, commentId },
        (state) => {
          let next = putComment(putThread(state, thread), comment, false)
          next = {
            ...next,
            threadComments: {
              ...next.threadComments,
              [id]: { ids: [commentId], cursor: null, state: "ready", error: null }
            }
          }
          return countChange(placeThread(next, thread, { isNew: true }), thread, 1, 1)
        },
        [id, commentId],
        (state, result) =>
          putComment(putThread(state, reviveThread(result.thread)), reviveComment(result.comment), false)
      )
      return {
        thread: reviveThread<Thread>(output.thread),
        comment: reviveComment<Message>(output.comment),
        droppedMentions: output.droppedMentions
      }
    },

    /** Replies to a thread, reopening it if it was resolved. */
    async reply(input: ReplyInput<Types>) {
      const thread = existing(input.threadId)
      const id = input.id ?? ulid()
      const now = new Date()
      const comment = draftComment(id, thread, input, now, input.fields)
      const bumped = {
        ...thread,
        status: "open",
        resolvedAt: null,
        resolvedBy: null,
        commentCount: thread.commentCount + 1,
        lastActivityAt: now
      } as Thread
      const output = await write<{ thread: unknown; comment: unknown; droppedMentions: string[] }>(
        "reply",
        { ...input, id },
        (state) => {
          const reopened = thread.status === "resolved" ? 1 : 0
          return countChange(
            placeThread(putComment(putThread(state, bumped), comment, true), bumped, { bump: true }),
            bumped,
            0,
            reopened
          )
        },
        [id],
        (state, result) =>
          putComment(putThread(state, reviveThread(result.thread)), reviveComment(result.comment), true)
      )
      return {
        thread: reviveThread<Thread>(output.thread),
        comment: reviveComment<Message>(output.comment),
        droppedMentions: output.droppedMentions
      }
    },

    async editComment(input: EditCommentInput<Types>) {
      const comment = store.getSnapshot().comments[input.commentId]
      const format = input.format ?? "text"
      const edited = comment && {
        ...comment,
        format,
        body: input.body,
        bodyText: format === "text" ? textFormat.toText(String(input.body)) : comment.bodyText,
        editedAt: new Date()
      }
      const output = await write<{ comment: unknown; droppedMentions: string[] }>(
        "editComment",
        input,
        (state) => (edited ? putComment(state, edited, false) : state),
        [input.commentId],
        (state, result) => putComment(state, reviveComment(result.comment), false)
      )
      return { comment: reviveComment<Message>(output.comment), droppedMentions: output.droppedMentions }
    },

    async deleteComment(input: CommentTarget) {
      const comment = store.getSnapshot().comments[input.commentId]
      const thread = comment && store.getSnapshot().threads[comment.threadId]
      const output = await write<{ comment: unknown; threadDeleted: boolean }>(
        "deleteComment",
        input,
        (state) => {
          if (!comment || !thread || comment.deletedAt) {
            return state
          }
          const deleted = { ...comment, body: null, bodyText: "", deletedAt: new Date() }
          return putThread(putComment(state, deleted, false), { ...thread, commentCount: thread.commentCount - 1 })
        },
        [input.commentId],
        (state, result) => {
          const deleted = reviveComment<Message>(result.comment)
          return result.threadDeleted ? removeThread(state, deleted.threadId) : putComment(state, deleted, false)
        }
      )
      return { comment: reviveComment<Message>(output.comment), threadDeleted: output.threadDeleted }
    },

    resolveThread: (input: ThreadTarget) => setStatus("resolveThread", input, "resolved"),
    reopenThread: (input: ThreadTarget) => setStatus("reopenThread", input, "open"),

    async updateThread(input: UpdateThreadInput<Types>) {
      const thread = existing(input.threadId)
      const changed = {
        ...thread,
        ...input.fields,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        ...(input.visibility === undefined ? {} : { visibility: input.visibility })
      } as Thread
      return confirmThread("updateThread", input, changed)
    },

    async updateAnchor(input: UpdateAnchorInput<Types>) {
      const thread = existing(input.threadId)
      const changed = {
        ...thread,
        anchorKind: input.anchor?.kind ?? null,
        anchor: input.anchor?.value ?? null,
        anchorVersion: input.anchor?.version ?? null
      } as Thread
      return confirmThread("updateAnchor", input, changed)
    },

    async deleteThread(input: ThreadTarget) {
      return write<{ threadId: string }>(
        "deleteThread",
        input,
        (state) => removeThread(state, input.threadId),
        [input.threadId],
        (state) => state
      )
    },

    /** Suggests users to mention in a thread, or on a subject before its thread exists. */
    suggestMentions(input: SuggestMentionsInput<Types["subjectType"]>) {
      return run("suggestMentions", input) as Promise<IdentityUser[]>
    },

    /**
     * Applies a live update from `toClientEvent`. Events it has already applied, and comments it already has, are
     * ignored, so an event that arrives before the server's own answer doesn't duplicate a comment.
     */
    applyEvent(event: ClientEvent | Serialized<ClientEvent>) {
      if (applied.includes(event.id)) {
        return
      }
      applied.push(event.id)
      applied.splice(0, Math.max(0, applied.length - remembered))
      const thread = reviveThread<Thread>(event.thread)
      update((state) => {
        if (event.type === "thread.deleted") {
          return removeThread(state, thread.id)
        }
        const known = state.threads[thread.id]
        let next = putThread(state, thread)
        if ("comment" in event) {
          const comment = reviveComment<Message>(event.comment)
          next = putComment(next, comment, true)
        }
        const isNew = event.type === "thread.created" && !known
        if (isNew) {
          next = countChange(next, thread, 1, thread.status === "open" ? 1 : 0)
        } else if (known && known.status !== thread.status) {
          next = countChange(next, thread, 0, thread.status === "open" ? 1 : -1)
        }
        return placeThread(next, thread, { isNew, bump: event.type === "comment.created" })
      })
    },

    /** The store's state as JSON can carry it, to send a server render's loads to the browser. */
    dehydrate(): DehydratedComments {
      // Through JSON on purpose, so dates become the strings a server render sends.
      const json = JSON.stringify({ ...store.getSnapshot(), pending: {} })
      return JSON.parse(json) as DehydratedComments
    },

    /** Merges a snapshot from `dehydrate`, such as one a server render loaded. */
    hydrate(snapshot: DehydratedComments) {
      update((state) => ({
        threads: {
          ...state.threads,
          ...Object.fromEntries(
            Object.entries(snapshot.threads).map(([id, thread]) => [id, reviveThread<Thread>(thread)])
          )
        },
        comments: {
          ...state.comments,
          ...Object.fromEntries(
            Object.entries(snapshot.comments).map(([id, comment]) => [id, reviveComment<Message>(comment)])
          )
        },
        threadComments: { ...state.threadComments, ...(snapshot.threadComments as Record<string, ThreadComments>) },
        lists: { ...state.lists, ...(snapshot.lists as Record<string, ThreadList>) },
        counts: { ...state.counts, ...snapshot.counts },
        users: { ...state.users, ...(snapshot.users as Record<string, IdentityUser>) },
        pending: state.pending
      }))
    }
  }

  function draftComment(
    id: string,
    thread: Thread,
    input: { format?: string | undefined; body: unknown },
    now: Date,
    fields: object | undefined
  ): Message {
    const format = input.format ?? "text"
    return {
      id,
      threadId: thread.id,
      orgId: thread.orgId,
      authorType: "user",
      authorId: "",
      authorName: null,
      format,
      body: input.body,
      bodyText: format === "text" ? textFormat.toText(String(input.body)) : "",
      createdAt: now,
      editedAt: null,
      deletedAt: null,
      metadata: null,
      ...fields
    } as Message
  }

  async function loadPage(key: string, input: ListThreadsInput, append: boolean) {
    try {
      const page = (await run("listThreads", input)) as {
        threads: unknown[]
        cursor: string | null
        users: Record<string, IdentityUser>
      }
      const threads = page.threads.map((thread) => reviveThread<Thread>(thread))
      update((state) => {
        const list = state.lists[key] as ThreadList
        const ids = threads.map((thread) => thread.id)
        // Threads that moved up through an event while paging are already listed, so they aren't repeated.
        const merged = append ? [...list.ids, ...ids.filter((id) => !list.ids.includes(id))] : ids
        return mergeUsers(
          {
            ...state,
            threads: { ...state.threads, ...Object.fromEntries(threads.map((thread) => [thread.id, thread])) },
            lists: { ...state.lists, [key]: { ...list, ids: merged, cursor: page.cursor, state: "ready", error: null } }
          },
          page.users
        )
      })
    } catch (error) {
      update((state) => ({
        ...state,
        lists: { ...state.lists, [key]: { ...(state.lists[key] as ThreadList), state: "error", error: error as Error } }
      }))
      throw error
    }
  }

  async function loadComments(input: GetThreadInput, append: boolean) {
    const { threadId } = input
    update((state) => ({
      ...state,
      threadComments: {
        ...state.threadComments,
        [threadId]: { ...(state.threadComments[threadId] ?? { ids: [], cursor: null }), state: "loading", error: null }
      }
    }))
    try {
      const page = (await run("getThread", input)) as {
        thread: unknown
        comments: unknown[]
        cursor: string | null
        users: Record<string, IdentityUser>
      }
      const comments = page.comments.map((comment) => reviveComment<Message>(comment))
      update((state) => {
        const loaded = state.threadComments[threadId] as ThreadComments
        const ids = comments.map((comment) => comment.id)
        return mergeUsers(
          {
            ...putThread(state, reviveThread(page.thread)),
            comments: { ...state.comments, ...Object.fromEntries(comments.map((comment) => [comment.id, comment])) },
            threadComments: {
              ...state.threadComments,
              [threadId]: {
                ids: append ? [...loaded.ids, ...ids.filter((id) => !loaded.ids.includes(id))] : ids,
                cursor: page.cursor,
                state: "ready",
                error: null
              }
            }
          },
          page.users
        )
      })
    } catch (error) {
      update((state) => ({
        ...state,
        threadComments: {
          ...state.threadComments,
          [threadId]: { ...(state.threadComments[threadId] as ThreadComments), state: "error", error: error as Error }
        }
      }))
      throw error
    }
  }

  async function setStatus(action: "resolveThread" | "reopenThread", input: ThreadTarget, status: "open" | "resolved") {
    const thread = existing(input.threadId)
    const changed = {
      ...thread,
      status,
      resolvedAt: status === "resolved" ? new Date() : null,
      resolvedBy: status === "resolved" ? thread.resolvedBy : null
    } as Thread
    return confirmThread(action, input, changed)
  }

  async function confirmThread(action: string, input: unknown, changed: Thread): Promise<Thread> {
    const previous = store.getSnapshot().threads[changed.id]
    const output = await write<unknown>(
      action,
      input,
      (state) => {
        let next = putThread(state, changed)
        if (previous && previous.status !== changed.status) {
          next = countChange(next, changed, 0, changed.status === "open" ? 1 : -1)
        }
        return placeThread(next, changed, {})
      },
      [changed.id],
      (state, result) => putThread(state, reviveThread(result))
    )
    return reviveThread<Thread>(output)
  }
}
