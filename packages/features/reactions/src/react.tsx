// React hooks over the reactions store, with no UI: apps bring their own chips, picker and tooltips.
import { useBetterApps, useStore } from "@better-apps/react"
import type { BetterApp, IdentityUser } from "better-apps"
import { BetterAppsClientError, type BetterAppsClient } from "better-apps/client"
import { useCallback, useEffect, useState } from "react"
import {
  createReactionsClient,
  normalizeEmoji,
  reactionKey,
  subjectKey,
  type LoadState,
  type ReactionsClient,
  type ReactionsState,
  type Subject
} from "./client.js"
import type { ReactionSummary } from "./feature.js"
import type { ReactionsTypes } from "./options.js"

export * from "./client.js"

/**
 * The reactions client for the nearest `BetterAppsProvider`. Each Better Apps client has one, so every hook shares one
 * store. Pass `typeof app` for the app's types.
 */
export function useReactions<App = BetterApp>() {
  return createReactionsClient(useBetterApps<BetterAppsClient<App>>())
}

function useReactionsState<Selected>(select: (state: ReactionsState) => Selected) {
  const reactions = useReactions()
  return useStore(reactions.store as ReactionsClient["store"], select)
}

const none: ReactionSummary[] = []

/** A record's reactions as `useSubjectReactions` returns them. */
export interface SubjectReactionsResult<Emoji extends string> {
  /** In the order to show them. */
  reactions: ReactionSummary[]
  state: LoadState
  error: Error | null
  /** Reacts, or removes the signed-in person's reaction. The change shows at once. */
  toggle(emoji: Emoji): Promise<void>
  /** The latest toggle the server refused, until the next one. */
  writeError: Error | null
  /** Whether a toggle of this emoji is still waiting for the server. */
  isPending(emoji: Emoji): boolean
}

/**
 * A record's reactions, loaded on first use. Records that mount together, such as every comment in a thread, load in
 * one call.
 */
export function useSubjectReactions<Types extends ReactionsTypes = ReactionsTypes>(
  subject: Subject<Types["subjectType"]>
): SubjectReactionsResult<Types["emoji"]> {
  const reactions = useReactions()
  const { subjectType, subjectId } = subject
  const key = subjectKey(subjectType, subjectId)
  const loaded = useReactionsState((state) => state.subjects[key])
  const [writeError, setWriteError] = useState<Error | null>(null)
  const loadedState = loaded?.state
  useEffect(() => {
    // A record toggled before it loaded is still idle.
    if (loadedState === undefined || loadedState === "idle") {
      reactions.load(subjectType, [subjectId]).catch(() => undefined)
    }
  }, [reactions, subjectType, subjectId, loadedState])
  useEffect(() => reactions.onReset(() => setWriteError(null)), [reactions])
  const toggle = useCallback(
    async (emoji: string) => {
      setWriteError(null)
      try {
        await reactions.toggle({ subjectType, subjectId, emoji })
      } catch (caught) {
        // A write the store's reset() cancelled belonged to the previous person, so it isn't reported.
        if (!(caught instanceof BetterAppsClientError && caught.code === "ABORTED")) {
          setWriteError(caught as Error)
        }
      }
    },
    [reactions, subjectType, subjectId]
  )
  const pending = loaded?.pending
  const isPending = useCallback((emoji: string) => pending?.includes(normalizeEmoji(emoji)) === true, [pending])
  return {
    reactions: loaded?.reactions ?? none,
    state: loadedState === undefined || loadedState === "idle" ? "loading" : loadedState,
    error: loaded?.error ?? null,
    toggle,
    writeError,
    isPending
  }
}

/**
 * How reactions work on a record, such as the emoji a picker offers, loaded when it first renders. `null` until it
 * loads.
 */
export function useReactionSettings<Types extends ReactionsTypes = ReactionsTypes>(
  subject: Subject<Types["subjectType"]>
) {
  const reactions = useReactions()
  const { subjectType, subjectId } = subject
  const settings = useReactionsState((state) => state.settings[subjectKey(subjectType, subjectId)])
  const [error, setError] = useState<Error | null>(null)
  const loaded = settings !== undefined
  useEffect(() => {
    if (!loaded) {
      reactions.loadSettings({ subjectType, subjectId }).then(
        () => setError(null),
        (caught: unknown) => setError(caught as Error)
      )
    }
  }, [reactions, subjectType, subjectId, loaded])
  return { settings: settings ?? null, error }
}

/** The people who reacted with one emoji, such as for a tooltip, loaded when it first renders. */
export function useReactors<Types extends ReactionsTypes = ReactionsTypes>(
  subject: Subject<Types["subjectType"]>,
  emoji: Types["emoji"]
) {
  const reactions = useReactions()
  const { subjectType, subjectId } = subject
  const key = reactionKey(subjectType, subjectId, normalizeEmoji(emoji))
  const loaded = useReactionsState((state) => state.reactors[key])
  const users = useReactionsState((state) => state.users)
  const loadedState = loaded?.state
  const stale = loaded?.stale === true
  // A stale list loads again while it shows, one load at a time, so a busy record doesn't send one per change.
  useEffect(() => {
    if (loadedState === undefined || (stale && loadedState === "ready")) {
      reactions.loadReactors({ subjectType, subjectId, emoji }).catch(() => undefined)
    }
  }, [reactions, subjectType, subjectId, emoji, loadedState, stale])
  const loadMore = useCallback(
    () => reactions.loadMoreReactors({ subjectType, subjectId, emoji }),
    [reactions, subjectType, subjectId, emoji]
  )
  return {
    userIds: loaded?.userIds ?? [],
    users: users as Readonly<Record<string, IdentityUser>>,
    state: loaded?.state ?? "loading",
    error: loaded?.error ?? null,
    /** Whether the record's reactions changed since the list loaded; it loads again, and shows meanwhile. */
    stale,
    hasMore: Boolean(loaded?.cursor),
    loadMore
  }
}
