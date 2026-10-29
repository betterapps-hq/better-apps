// React hooks over the comments store, with no UI: apps bring their own composer, thread list and pin styles.
import { useBetterApps, useStore } from "@better-apps/react"
import type { BetterApp, IdentityUser } from "better-apps"
import { BetterAppsClientError, type BetterAppsClient } from "better-apps/client"
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { resolveAnchor, type AnchorResolution } from "./anchor-dom.js"
import {
  countKey,
  createCommentsClient,
  listKey,
  type CommentsClient,
  type CommentsState,
  type ListOptions,
  type LoadState,
  type Subject
} from "./client.js"
import type { CommentsTypes } from "./options.js"
import type { Comment, CommentThread } from "./schema.js"

export * from "./client.js"

/**
 * The comments client for the nearest `BetterAppsProvider`. Each Better Apps client has one, so every hook shares one
 * store, and so does code that called `createCommentsClient` with the same client, such as a router hydrating a server
 * render's loads. Pass `typeof app` for the app's types.
 */
export function useComments<App = BetterApp>() {
  return createCommentsClient(useBetterApps<BetterAppsClient<App>>())
}

type ThreadOf<Types extends CommentsTypes> = CommentThread & Types["threadFields"]
type MessageOf<Types extends CommentsTypes> = Comment & Types["commentFields"]

function useCommentsState<Selected>(
  select: (state: CommentsState) => Selected,
  isEqual?: (a: Selected, b: Selected) => boolean
) {
  const comments = useComments()
  return useStore(comments.store as CommentsClient["store"], select, isEqual)
}

const sameItems = <Item,>(a: readonly Item[], b: readonly Item[]) =>
  a.length === b.length && a.every((item, index) => Object.is(item, b[index]))

/** A thread list as hooks return it. */
export interface ThreadsResult<Thread> {
  threads: Thread[]
  state: LoadState
  error: Error | null
  hasMore: boolean
  loadMore(): Promise<void>
  refresh(): Promise<void>
  users: Readonly<Record<string, IdentityUser>>
}

/** A subject's threads, loaded on first use. A list a server render already loaded isn't fetched again. */
export function useThreads<Types extends CommentsTypes = CommentsTypes>(
  subject: Subject<Types["subjectType"]>,
  options: ListOptions = {}
): ThreadsResult<ThreadOf<Types>> {
  const comments = useComments()
  const { subjectType, subjectId } = subject
  const { status, order } = options
  const key = listKey({ subjectType, subjectId }, { status, order })
  const list = useCommentsState((state) => state.lists[key])
  const threads = useCommentsState(
    (state) => (state.lists[key]?.ids ?? []).flatMap((id) => (state.threads[id] ? [state.threads[id]] : [])),
    sameItems
  ) as ThreadOf<Types>[]
  const users = useCommentsState((state) => state.users)
  const listState = list?.state
  useEffect(() => {
    if (listState === undefined) {
      comments.loadThreads({ subjectType, subjectId }, { status, order }).catch(() => undefined)
    }
  }, [comments, subjectType, subjectId, status, order, listState])
  const loadMore = useCallback(
    () => comments.loadMoreThreads({ subjectType, subjectId }, { status, order }),
    [comments, subjectType, subjectId, status, order]
  )
  const refresh = useCallback(
    () => comments.loadThreads({ subjectType, subjectId }, { status, order }),
    [comments, subjectType, subjectId, status, order]
  )
  return {
    threads,
    state: list?.state ?? "loading",
    error: list?.error ?? null,
    hasMore: Boolean(list?.cursor),
    loadMore,
    refresh,
    users
  }
}

/** A thread with its comments, oldest first, loaded on first use. */
export function useThread<Types extends CommentsTypes = CommentsTypes>(threadId: string | null) {
  const comments = useComments()
  const thread = useCommentsState((state) => (threadId ? state.threads[threadId] : undefined)) as
    | ThreadOf<Types>
    | undefined
  const loaded = useCommentsState((state) => (threadId ? state.threadComments[threadId] : undefined))
  const messages = useCommentsState(
    (state) =>
      ((threadId && state.threadComments[threadId]?.ids) || []).flatMap((id) =>
        state.comments[id] ? [state.comments[id]] : []
      ),
    sameItems
  ) as MessageOf<Types>[]
  const users = useCommentsState((state) => state.users)
  const pending = useCommentsState((state) => state.pending)
  const loadedState = loaded?.state
  useEffect(() => {
    if (threadId && loadedState === undefined) {
      comments.loadThread(threadId).catch(() => undefined)
    }
  }, [comments, threadId, loadedState])
  const loadMore = useCallback(async () => {
    if (threadId) {
      await comments.loadMoreComments(threadId)
    }
  }, [comments, threadId])
  return {
    thread,
    comments: messages,
    state: threadId ? (loaded?.state ?? "loading") : ("idle" as LoadState),
    error: loaded?.error ?? null,
    hasMore: Boolean(loaded?.cursor),
    loadMore,
    users,
    /** Whether a thread or comment is still waiting for the server. */
    isPending: (id: string) => pending[id] === true
  }
}

/** Open and total thread counts for many records, such as badges in a table. Lists over 50 are split into calls. */
export function useThreadCounts<Types extends CommentsTypes = CommentsTypes>(
  subjectType: Types["subjectType"],
  subjectIds: readonly string[]
): Readonly<Record<string, { open: number; total: number }>> {
  const comments = useComments()
  const idsKey = subjectIds.join("\u0000")
  // Ids with no counts at all, not even loading ones. A reset empties the store, so its ids show up here again.
  const missing = useCommentsState(
    (state) => subjectIds.filter((subjectId) => !state.counts[countKey(subjectType, subjectId)]),
    sameItems
  )
  const counts = useCommentsState(
    (state) =>
      Object.fromEntries(
        subjectIds.flatMap((subjectId) => {
          const count = state.counts[countKey(subjectType, subjectId)]
          return count?.state === "ready" ? [[subjectId, { open: count.open, total: count.total }] as const] : []
        })
      ),
    (a, b) => JSON.stringify(a) === JSON.stringify(b)
  )
  const missingKey = missing.join("\u0000")
  useEffect(() => {
    if (missingKey !== "") {
      comments.loadCounts(subjectType, missingKey.split("\u0000")).catch(() => undefined)
    }
  }, [comments, subjectType, idsKey, missingKey])
  // Counts that failed load again once when the list mounts or changes, rather than after every failure, so a failing
  // server isn't asked in a loop.
  useEffect(() => {
    const state = comments.store.getSnapshot()
    const ids = idsKey === "" ? [] : idsKey.split("\u0000")
    const failed = ids.filter((subjectId) => state.counts[countKey(subjectType, subjectId)]?.state === "error")
    if (failed.length > 0) {
      comments.loadCounts(subjectType, failed).catch(() => undefined)
    }
  }, [comments, subjectType, idsKey])
  return counts
}

/** A write as hooks return it: `mutate` runs it, and the rest describes the latest run. */
export interface Mutation<Input, Output> {
  mutate(input: Input): Promise<Output>
  status: "idle" | "pending" | "success" | "error"
  error: Error | null
  reset(): void
}

function useMutation<Input, Output>(run: (input: Input) => Promise<Output>): Mutation<Input, Output> {
  const [status, setStatus] = useState<Mutation<Input, Output>["status"]>("idle")
  const [error, setError] = useState<Error | null>(null)
  // Only the latest run describes the mutation, so one that settles after a newer run or a reset changes nothing.
  const latest = useRef(0)
  const mutate = useCallback(
    async (input: Input) => {
      const current = ++latest.current
      setStatus("pending")
      setError(null)
      try {
        const output = await run(input)
        if (current === latest.current) {
          setStatus("success")
        }
        return output
      } catch (caught) {
        if (current === latest.current) {
          // A write the store's reset() cancelled belonged to the previous person, so it shows as never having run.
          const cancelled = caught instanceof BetterAppsClientError && caught.code === "ABORTED"
          setStatus(cancelled ? "idle" : "error")
          setError(cancelled ? null : (caught as Error))
        }
        throw caught
      }
    },
    [run]
  )
  const reset = useCallback(() => {
    latest.current += 1
    setStatus("idle")
    setError(null)
  }, [])
  return { mutate, status, error, reset }
}

type Client = ReturnType<typeof useComments>
type Action<Name extends keyof Client> = Client[Name] extends (input: infer Input) => Promise<infer Output>
  ? Mutation<Input, Output>
  : never

function useAction<Name extends keyof Client>(name: Name): Action<Name> {
  const comments = useComments()
  const run = useCallback(
    (input: unknown) => (comments[name] as (input: unknown) => Promise<unknown>)(input),
    [comments, name]
  )
  return useMutation(run) as Action<Name>
}

/** Starts a thread, shown at once and rolled back if the server refuses it. */
export const useCreateThread = () => useAction("createThread")
/** Replies to a thread, reopening it if it was resolved. */
export const useReply = () => useAction("reply")
export const useEditComment = () => useAction("editComment")
export const useDeleteComment = () => useAction("deleteComment")
export const useResolveThread = () => useAction("resolveThread")
export const useReopenThread = () => useAction("reopenThread")
export const useUpdateThread = () => useAction("updateThread")
export const useUpdateAnchor = () => useAction("updateAnchor")
export const useDeleteThread = () => useAction("deleteThread")

/** Mention suggestions for a thread, or for a subject before its thread exists. `search` asks for a query's matches. */
export function useSuggestMentions(target: { threadId: string } | Subject) {
  const comments = useComments()
  const [suggestions, setSuggestions] = useState<IdentityUser[]>([])
  const [error, setError] = useState<Error | null>(null)
  const targetKey = JSON.stringify(target)
  // Suggestions are what the signed-in person could see, so they go when the store is reset for someone else.
  useEffect(
    () =>
      comments.onReset(() => {
        setSuggestions([])
        setError(null)
      }),
    [comments]
  )
  const search = useCallback(
    async (query: string) => {
      try {
        const found = await comments.suggestMentions({ ...(JSON.parse(targetKey) as object), query } as never)
        setSuggestions(found)
        setError(null)
        return found
      } catch (caught) {
        setError(caught as Error)
        return []
      }
    },
    [comments, targetKey]
  )
  return { suggestions, error, search }
}

/**
 * Where an anchored thread sits inside `root`, kept current as the page resizes, scrolls or changes. `version` is the
 * content version on screen; a different one marks the anchor `outdated`.
 */
export function useAnchorPosition(
  thread: { anchorKind: string | null; anchor: unknown; anchorVersion: string | null } | undefined,
  root: RefObject<Element | null>,
  version?: string | null
): AnchorResolution | null {
  const [resolution, setResolution] = useState<AnchorResolution | null>(null)
  const anchorKey = thread ? JSON.stringify([thread.anchorKind, thread.anchor, thread.anchorVersion]) : ""
  const anchored = useMemo(
    () => (anchorKey === "" ? undefined : (JSON.parse(anchorKey) as [string | null, unknown, string | null])),
    [anchorKey]
  )
  useEffect(() => {
    const element = root.current
    const view = element?.ownerDocument.defaultView
    if (!anchored || !element || !view) {
      return
    }
    const [anchorKind, anchor, anchorVersion] = anchored
    const measure = () => setResolution(resolveAnchor({ anchorKind, anchor, anchorVersion }, element, version))
    // Measured after layout, then again whenever the page resizes, scrolls or changes.
    const frame = view.requestAnimationFrame(measure)
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    resized?.observe(element)
    const changed = typeof MutationObserver === "undefined" ? null : new MutationObserver(measure)
    changed?.observe(element, { childList: true, subtree: true, attributes: true })
    view.addEventListener("resize", measure)
    view.addEventListener("scroll", measure, true)
    return () => {
      view.cancelAnimationFrame(frame)
      resized?.disconnect()
      changed?.disconnect()
      view.removeEventListener("resize", measure)
      view.removeEventListener("scroll", measure, true)
    }
  }, [anchored, root, version])
  return anchored ? resolution : null
}
