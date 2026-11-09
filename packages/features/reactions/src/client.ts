// The framework-free browser half of reactions: a store of each record's reactions that any framework binds to, with
// optimistic toggles and live updates through `applyEvent`. It imports no server code.
import type { BetterApp, IdentityUser } from "better-apps"
import {
  BetterAppsClientError,
  createStore,
  type BetterAppsClient,
  type CallOptions,
  type Serialized,
  type Store
} from "better-apps/client"
import { normalizeEmoji } from "./emoji.js"
import type {
  ClientReactionEvent,
  ReactionSettings,
  ReactionSummary,
  ReactorPage,
  ReactResult,
  UnreactResult
} from "./feature.js"
import type { ReactionFilter, ReactionsOptions, ReactionsTypes, ReactionTarget, TypesOf } from "./options.js"

export { normalizeEmoji } from "./emoji.js"
export type {
  ClientReactionChange,
  ClientReactionEvent,
  ClientRecordChange,
  ReactionSettings,
  ReactionSummary,
  ReactorPage,
  ReactResult,
  UnreactResult
} from "./feature.js"
export type {
  ReactionFilter,
  ReactionsOptions,
  ReactionsTypes,
  ReactionTarget,
  ReactorVisibility,
  TypesOf
} from "./options.js"

type ReactionsFeatureOf<App> =
  App extends BetterApp<infer Features> ? Extract<Features[number], { id: "reactions" }> : never

/** The reactions types of an app, from `typeof app`. */
export type AppReactionsTypes<App> =
  ReactionsFeatureOf<App> extends { options: infer Options extends ReactionsOptions }
    ? TypesOf<Options>
    : ReactionsTypes

/** Which record reactions are on. */
export interface Subject<SubjectType extends string = string> {
  subjectType: SubjectType
  subjectId: string
}

/** Where a load stands. `error` holds the client error when it failed. */
export type LoadState = "idle" | "loading" | "ready" | "error"

/** A record's reactions, in the order to show them, with this tab's changes the server hasn't confirmed yet. */
export interface SubjectReactions {
  reactions: ReactionSummary[]
  state: LoadState
  error: Error | null
  /** The emoji whose toggles here are still waiting for the server. */
  pending: readonly string[]
}

/** The people who reacted with one emoji, first reaction first. */
export interface Reactors {
  userIds: string[]
  cursor: string | null
  state: LoadState
  error: Error | null
}

/** Everything the store holds. */
export interface ReactionsState {
  subjects: Readonly<Record<string, SubjectReactions>>
  reactors: Readonly<Record<string, Reactors>>
  /** Names and avatars by user id, from `loadReactors`. */
  users: Readonly<Record<string, IdentityUser>>
  /** How reactions work on each record loaded with `loadSettings`, keyed by `subjectKey`. */
  settings: Readonly<Record<string, ReactionSettings>>
}

/** A store snapshot as JSON carries it, for server rendering. */
export type DehydratedReactions = Serialized<ReactionsState>

/** Keys a record's reactions. */
export function subjectKey(subjectType: string, subjectId: string): string {
  return JSON.stringify([subjectType, subjectId])
}

/** Keys one emoji on one record, for its reactors. */
export function reactionKey(subjectType: string, subjectId: string, emoji: string): string {
  return JSON.stringify([subjectType, subjectId, emoji])
}

const empty: ReactionsState = { subjects: {}, reactors: {}, users: {}, settings: {} }
const nothing: readonly string[] = []
const pageSize = 50
const remembered = 1000

/**
 * Adds or removes one person's reaction from a record's list. A new emoji goes last and an emoji nobody uses any more
 * leaves, so chips never jump around while people click them.
 */
function change(reactions: readonly ReactionSummary[], emoji: string, delta: 1 | -1, mine: boolean) {
  const index = reactions.findIndex((reaction) => reaction.emoji === emoji)
  const current = reactions[index]
  if (!current) {
    return delta === 1 ? [...reactions, { emoji, count: 1, reacted: mine }] : [...reactions]
  }
  const count = current.count + delta
  if (count <= 0) {
    return reactions.filter((_, position) => position !== index)
  }
  const reacted = mine ? delta === 1 : current.reacted
  return reactions.map((reaction, position) => (position === index ? { emoji, count, reacted } : reaction))
}

/**
 * Sets whether the viewer reacted with an emoji, counting them in or out only when that changes it. Applying the same
 * change of the viewer's twice, such as from a live event and then the server's answer, counts it once.
 */
function setMine(reactions: readonly ReactionSummary[], emoji: string, reacted: boolean): readonly ReactionSummary[] {
  const current = reactions.find((reaction) => reaction.emoji === emoji)
  return (current?.reacted ?? false) === reacted ? reactions : change(reactions, emoji, reacted ? 1 : -1, true)
}

type Fix = (reactions: readonly ReactionSummary[]) => readonly ReactionSummary[]

/** How many of a record's latest changes are kept, to make again on a load's answer that went out before them. */
const keptChanges = 50

/** One of this tab's writes the server hasn't answered yet. */
interface Write {
  emoji: string
  reacted: boolean
  /** Whether it takes the place of the viewer's other reactions, when each person has one. */
  replaces: boolean
}

/** Shows one of the viewer's writes on a record's reactions. */
function applyWrite(reactions: readonly ReactionSummary[], write: Write): readonly ReactionSummary[] {
  const cleared = write.replaces
    ? reactions.reduce(
        (shown, reaction) =>
          reaction.reacted && reaction.emoji !== write.emoji ? setMine(shown, reaction.emoji, false) : shown,
        reactions
      )
    : reactions
  return setMine(cleared, write.emoji, write.reacted)
}

/** The reactions client: a store plus the actions that fill it. */
export type ReactionsClient<Types extends ReactionsTypes = ReactionsTypes> = ReturnType<
  typeof createReactionsClientFor<Types>
>

const clients = new WeakMap<object, ReactionsClient>()

/**
 * Creates the reactions store for a Better Apps client. Pass `typeof app` as the client's type to get the app's
 * subject types and emoji. Each Better Apps client has one store, so calling this again with the same client, as
 * `useReactions` does, returns the store already made.
 *
 * The store holds what the signed-in person could see. When someone else signs in without a page load, call `reset()`
 * or create a new Better Apps client.
 */
export function createReactionsClient<App = BetterApp>(client: BetterAppsClient<App>) {
  let reactions = clients.get(client)
  if (!reactions) {
    reactions = createReactionsClientFor((client as BetterAppsClient).$call)
    clients.set(client, reactions)
  }
  return reactions as unknown as ReactionsClient<AppReactionsTypes<App>>
}

function createReactionsClientFor<Types extends ReactionsTypes>(
  call: (feature: string, action: string, input: unknown, options: CallOptions) => Promise<unknown>
) {
  const store: Store<ReactionsState> = createStore(empty)
  // reset() cancels calls still under way, so one waiting on its headers never goes out as the next person.
  let calls = new AbortController()
  const run = (action: string, input: unknown) => call("reactions", action, input, { signal: calls.signal })
  const update = (next: (state: ReactionsState) => ReactionsState) => store.setState(next)
  // Answers to requests made before a reset() belong to the previous person, so they apply only in their generation.
  let generation = 0
  const scoped = () => {
    const started = generation
    return (next: (state: ReactionsState) => ReactionsState) => {
      if (started === generation) {
        update(next)
      }
    }
  }
  const applied: string[] = []
  const resetListeners = new Set<() => void>()

  // Loads asked for in the same tick go out together, so a list of comments that each show reactions makes one call.
  const queued = new Map<string, { ids: Set<string>; waiters: { resolve(): void; reject(error: unknown): void }[] }>()
  // Writes to one record go to the server one after another, so quick toggles end where the last click left them, and
  // a reaction that replaces another one sees the one before it.
  const chains = new Map<string, Promise<unknown>>()
  // What the server last said about each loaded record, kept up to date by answers and live events. The store shows it
  // with this tab's writes still going on top, so a load or an event that lands meanwhile never loses one, and a
  // refused write just drops out.
  const confirmed = new Map<string, readonly ReactionSummary[]>()
  const writes = new Map<string, Write[]>()
  // How many emoji each person may use per record, by subject type, learned from `getSettings` as records load, so a
  // swap shows at once when each person has one.
  const maxPerUser = new Map<string, number>()
  // Each subject type's list of emoji, in order, from the same settings, so a new chip shows where a load will put it.
  const listed = new Map<string, ReadonlyMap<string, number>>()
  const asked = new Set<string>()
  // Records reloading after someone else's change; `true` when another change came meanwhile, so they load once more.
  const refreshing = new Map<string, boolean>()

  const setSubject = (state: ReactionsState, key: string, value: Partial<SubjectReactions>): ReactionsState => {
    const current = state.subjects[key] ?? { reactions: [], state: "idle", error: null, pending: nothing }
    return { ...state, subjects: { ...state.subjects, [key]: { ...current, ...value } } }
  }

  /** Shows a record as the server last had it, with this tab's writes on top. */
  const show = (state: ReactionsState, key: string): ReactionsState => {
    const going = writes.get(key) ?? []
    const pending = going.length === 0 ? nothing : [...new Set(going.map((write) => write.emoji))]
    const base = confirmed.get(key)
    if (!base) {
      return state.subjects[key] || going.length > 0 ? setSubject(state, key, { pending }) : state
    }
    const reactions = [...going.reduce(applyWrite, base)]
    const order = orderOf(state, key)
    if (order) {
      // Emoji the list doesn't have keep their places after the listed ones; the sort is stable.
      reactions.sort((a, b) => {
        const listed = (order.get(a.emoji) ?? Infinity) - (order.get(b.emoji) ?? Infinity)
        return Number.isNaN(listed) ? 0 : listed
      })
    }
    return setSubject(state, key, { reactions, pending })
  }

  /**
   * The order of a record's listed emoji: from its own settings when loaded, or else its subject type's, when the list
   * doesn't depend on the organization.
   */
  const orderOf = (state: ReactionsState, key: string): ReadonlyMap<string, number> | undefined => {
    const own = state.settings[key]
    if (own) {
      return own.emojis ? new Map(own.emojis.map((emoji, index) => [emoji, index])) : undefined
    }
    const [subjectType] = JSON.parse(key) as [string]
    return listed.get(subjectType)
  }

  // Each record's version, raised whenever what the server said about it changes here, with the latest changes and how
  // to make each again, or `null` when it can't be, so a load that went out before them doesn't undo them.
  const versions = new Map<string, number>()
  const history = new Map<string, { version: number; fix: Fix | null }[]>()
  const bump = (key: string, fix: Fix | null) => {
    const version = (versions.get(key) ?? 0) + 1
    versions.set(key, version)
    history.set(key, [...(history.get(key) ?? []), { version, fix }].slice(-keptChanges))
  }

  /**
   * A load's answer with the changes made here since it was asked made again on top, in order, or `null` when one of
   * them can't be, and the record should load again instead. Only the viewer's own changes can be made again: they
   * are set rather than counted, so making one the answer already has changes nothing. Someone else's change, another
   * load's answer or many changes at once can't, since whether the answer already has them can't be told.
   */
  const caughtUp = (key: string, asked: number, answer: readonly ReactionSummary[]) => {
    const now = versions.get(key) ?? 0
    const since = (history.get(key) ?? []).filter((entry) => entry.version > asked)
    if (since.length !== now - asked) {
      return null
    }
    let reactions = answer
    for (const { fix } of since) {
      if (!fix) {
        return null
      }
      reactions = fix(reactions)
    }
    return reactions
  }

  /**
   * Changes what the server last said about a record, once loaded, and remembers the change for a load under way.
   * `again` is how to make it again on a newer answer, or `null` when it can't be.
   */
  const confirm = (key: string, next: Fix, again: Fix | null = next) => {
    const base = confirmed.get(key)
    if (base) {
      confirmed.set(key, next(base))
    }
    bump(key, again)
  }

  const setReactors = (state: ReactionsState, key: string, value: Partial<Reactors>): ReactionsState => {
    const current = state.reactors[key] ?? { userIds: [], cursor: null, state: "idle", error: null }
    return { ...state, reactors: { ...state.reactors, [key]: { ...current, ...value } } }
  }

  // Each list of reactors' version, raised by every change to who reacted, so a page that was asked for before one is
  // asked for again rather than putting back someone who left.
  const reactorVersions = new Map<string, number>()

  /**
   * Drops a record's lists of reactors, after many of its reactions changed at once, so they load again. Pages still on
   * their way are asked for again rather than putting the old lists back.
   */
  function dropReactors(record: string) {
    const prefix = `${record.slice(0, -1)},`
    update((state) => withoutReactors(state, (name) => name.startsWith(prefix)))
  }

  /** Drops the lists of reactors `drop` picks, so they load again, and has pages on their way asked for again. */
  function withoutReactors(state: ReactionsState, drop: (key: string) => boolean): ReactionsState {
    const kept = Object.entries(state.reactors).filter(([name]) => {
      if (!drop(name)) {
        return true
      }
      reactorVersions.set(name, (reactorVersions.get(name) ?? 0) + 1)
      return false
    })
    return { ...state, reactors: Object.fromEntries(kept) }
  }

  /** Adds or removes someone in a list of reactors, including one whose next page is loading. */
  function withReactor(state: ReactionsState, target: ReactionTarget, delta: 1 | -1, userId: string) {
    const key = reactionKey(target.subjectType, target.subjectId, target.emoji)
    reactorVersions.set(key, (reactorVersions.get(key) ?? 0) + 1)
    const reactors = state.reactors[key]
    if (reactors?.state !== "ready" && reactors?.state !== "loading") {
      return state
    }
    if (delta === 1) {
      // A new reactor is only added once the last page is loaded, since pages are in order of reacting, and one already
      // listed keeps their place.
      if (reactors.userIds.includes(userId) || reactors.cursor !== null) {
        return state
      }
      if (!state.users[userId]) {
        // Someone whose name hasn't loaded: the list starts over, so it loads again with them.
        return {
          ...state,
          reactors: Object.fromEntries(Object.entries(state.reactors).filter(([name]) => name !== key))
        }
      }
      return setReactors(state, key, { userIds: [...reactors.userIds, userId] })
    }
    return setReactors(state, key, { userIds: reactors.userIds.filter((id) => id !== userId) })
  }

  const reactedWith = (target: ReactionTarget) =>
    store
      .getSnapshot()
      .subjects[subjectKey(target.subjectType, target.subjectId)]?.reactions.some(
        (reaction) => reaction.emoji === target.emoji && reaction.reacted
      ) === true

  function serial<Output>(key: string, task: () => Promise<Output>): Promise<Output> {
    const previous = chains.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(task)
    chains.set(key, next)
    const forget = () => {
      if (chains.get(key) === next) {
        chains.delete(key)
      }
    }
    next.then(forget, forget)
    return next
  }

  async function write<Output>(action: "react" | "unreact", asked: ReactionTarget): Promise<Output> {
    // The server stores one spelling of each emoji, so the store uses it too.
    const target = { ...asked, emoji: normalizeEmoji(asked.emoji) }
    const reacted = action === "react"
    const record = subjectKey(target.subjectType, target.subjectId)
    const started = generation
    const current = () => started === generation
    const replaces = reacted && maxPerUser.get(target.subjectType) === 1
    const pending: Write = { emoji: target.emoji, reacted, replaces }
    writes.set(record, [...(writes.get(record) ?? []), pending])
    update((state) => show(state, record))
    // The signal is taken now, so a write still waiting its turn when reset() runs never goes out as the next person.
    const { signal } = calls
    let output: Output
    try {
      output = await serial(record, async () => (await call("reactions", action, target, { signal })) as Output)
    } finally {
      if (current()) {
        const left = (writes.get(record) ?? []).filter((write) => write !== pending)
        if (left.length > 0) {
          writes.set(record, left)
        } else {
          writes.delete(record)
        }
        // A refused write just stops showing, so toggles made meanwhile keep theirs.
        update((state) => show(state, record))
      }
    }
    if (!current()) {
      return output
    }
    // Whatever the server already had, such as from another tab, the viewer now has this reaction or doesn't, and
    // `setMine` counts it once however many answers and live events say so.
    const { reaction, replaced = [] } = output as {
      reaction?: { userId: string } | null
      replaced?: { emoji: string; userId: string }[]
    }
    // When each person has one, the viewer's others are gone too, even ones the server didn't replace now because another
    // tab already had, which this tab may still show.
    confirm(record, (reactions) => applyWrite(reactions, pending))
    for (const gone of replaced) {
      confirm(record, (reactions) => setMine(reactions, gone.emoji, false))
    }
    update((state) => {
      let next = show(state, record)
      // The server names the reactor, so a loaded list of reactors gains or loses them now.
      if (reaction) {
        next = withReactor(next, target, reacted ? 1 : -1, reaction.userId)
      } else {
        // The server had nothing to change, such as a reaction another tab already took back, and doesn't say who the
        // viewer is, so the emoji's list of reactors loads again.
        const key = reactionKey(target.subjectType, target.subjectId, target.emoji)
        next = withoutReactors(next, (name) => name === key)
      }
      return replaced.reduce(
        (shown, gone) => withReactor(shown, { ...target, emoji: gone.emoji }, -1, gone.userId),
        next
      )
    })
    return output
  }

  async function loadNow(subjectType: string, subjectIds: readonly string[]): Promise<void> {
    const apply = scoped()
    const pages: string[][] = []
    for (let start = 0; start < subjectIds.length; start += pageSize) {
      pages.push(subjectIds.slice(start, start + pageSize))
    }
    try {
      await Promise.all(
        pages.map(async (page) => {
          const asked = new Map(
            page.map((subjectId) => [subjectId, versions.get(subjectKey(subjectType, subjectId)) ?? 0])
          )
          const found = (await run("listReactions", { subjectType, subjectIds: page })) as Record<
            string,
            ReactionSummary[]
          >
          const stale: string[] = []
          apply((state) =>
            page.reduce((next, subjectId) => {
              const key = subjectKey(subjectType, subjectId)
              // A write answered, or a live event applied, since this load went out may be newer than its answer, so
              // it's made again on top; when one can't be, the record keeps what it has and loads again instead.
              const reactions = caughtUp(key, asked.get(subjectId) ?? 0, found[subjectId] ?? [])
              if (!reactions) {
                stale.push(subjectId)
                return next
              }
              confirmed.set(key, reactions)
              bump(key, null)
              return show(setSubject(next, key, { state: "ready", error: null }), key)
            }, state)
          )
          for (const subjectId of stale) {
            refresh(subjectType, subjectId)
          }
        })
      )
    } catch (error) {
      apply((state) =>
        subjectIds.reduce((next, subjectId) => {
          const key = subjectKey(subjectType, subjectId)
          return next.subjects[key]?.state === "ready"
            ? next
            : setSubject(next, key, { state: "error", error: error as Error })
        }, state)
      )
      throw error
    }
  }

  function flush(subjectType: string) {
    const batch = queued.get(subjectType)
    queued.delete(subjectType)
    if (!batch) {
      return
    }
    const ids = [...batch.ids]
    loadNow(subjectType, ids).then(
      () => batch.waiters.forEach((waiter) => waiter.resolve()),
      (error: unknown) => batch.waiters.forEach((waiter) => waiter.reject(error))
    )
    // The first load of a subject type also learns its settings, so a swap can show before the server answers.
    const [first] = ids
    if (first !== undefined && !asked.has(subjectType)) {
      asked.add(subjectType)
      loadSettings({ subjectType, subjectId: first }).catch(() => asked.delete(subjectType))
    }
  }

  function load(subjectType: string, subjectIds: readonly string[]): Promise<void> {
    const ids = [...new Set(subjectIds)]
    if (ids.length === 0) {
      return Promise.resolve()
    }
    update((state) =>
      ids.reduce((next, subjectId) => {
        const key = subjectKey(subjectType, subjectId)
        return next.subjects[key]?.state === "ready" ? next : setSubject(next, key, { state: "loading", error: null })
      }, state)
    )
    return new Promise<void>((resolve, reject) => {
      let batch = queued.get(subjectType)
      if (!batch) {
        batch = { ids: new Set(), waiters: [] }
        queued.set(subjectType, batch)
        queueMicrotask(() => flush(subjectType))
      }
      for (const id of ids) {
        batch.ids.add(id)
      }
      batch.waiters.push({ resolve, reject })
    })
  }

  /**
   * Loads a record again after someone else's change, so its counts match the server's even when the change was
   * already in a load, or reported twice. Changes that come while it loads make it load once more.
   */
  function refresh(subjectType: string, subjectId: string) {
    const key = subjectKey(subjectType, subjectId)
    if (refreshing.has(key)) {
      refreshing.set(key, true)
      return
    }
    refreshing.set(key, false)
    const started = generation
    load(subjectType, [subjectId])
      .catch(() => undefined)
      .finally(() => {
        if (started !== generation) {
          return
        }
        const again = refreshing.get(key) === true
        refreshing.delete(key)
        if (again) {
          refresh(subjectType, subjectId)
        }
      })
  }

  async function loadSettings(subject: Subject): Promise<ReactionSettings> {
    const apply = scoped()
    const settings = (await run("getSettings", subject)) as ReactionSettings
    apply((state) => {
      maxPerUser.set(subject.subjectType, settings.maxPerUser)
      if (settings.emojis && !settings.emojisByOrg) {
        listed.set(subject.subjectType, new Map(settings.emojis.map((emoji, index) => [emoji, index])))
      } else {
        listed.delete(subject.subjectType)
      }
      return {
        ...state,
        settings: { ...state.settings, [subjectKey(subject.subjectType, subject.subjectId)]: settings }
      }
    })
    return settings
  }

  async function loadReactorsPage(asked: ReactionTarget, cursor: string | undefined) {
    const target = { ...asked, emoji: normalizeEmoji(asked.emoji) }
    const key = reactionKey(target.subjectType, target.subjectId, target.emoji)
    const apply = scoped()
    apply((state) => setReactors(state, key, { state: "loading", error: null }))
    // Taken now, so a page asked for again after reset() never goes out as the next person.
    const { signal } = calls
    let from = cursor
    try {
      let page: ReactorPage
      // A change to who reacted while a page was on its way may not be in it, so the page is asked for again, a few
      // times at most on a busy record. When the list was dropped meanwhile, the pages before are gone too, so it
      // starts over from the first.
      for (let attempt = 1; ; attempt += 1) {
        const asked = reactorVersions.get(key) ?? 0
        page = (await call("reactions", "listReactors", { ...target, cursor: from }, { signal })) as ReactorPage
        if ((reactorVersions.get(key) ?? 0) === asked) {
          break
        }
        const dropped = !store.getSnapshot().reactors[key]
        if (attempt === 3) {
          if (dropped && from !== undefined) {
            // A later page alone would leave out the people before it, so the list stays dropped and loads again.
            return
          }
          break
        }
        if (dropped) {
          from = undefined
        }
      }
      apply((state) => {
        const loaded = state.reactors[key]?.userIds ?? []
        const userIds =
          from === undefined ? page.userIds : [...loaded, ...page.userIds.filter((id) => !loaded.includes(id))]
        return {
          ...setReactors(state, key, { userIds, cursor: page.cursor, state: "ready", error: null }),
          users: { ...state.users, ...page.users }
        }
      })
    } catch (error) {
      apply((state) => setReactors(state, key, { state: "error", error: error as Error }))
      throw error
    }
  }

  return {
    store,

    /**
     * Loads many records' reactions. Loads asked for in the same tick share calls of up to 50 records, and records
     * already loaded load again.
     */
    load: (subjectType: Types["subjectType"], subjectIds: readonly string[]): Promise<void> =>
      load(subjectType, subjectIds),

    /**
     * Loads how reactions work on a record: its allowed emoji, which can differ by organization, and its limits. The
     * first load of each subject type does this for one of its records.
     */
    loadSettings: (subject: Subject<Types["subjectType"]>) => loadSettings(subject),

    /** Loads the first page of the people who reacted with one emoji, with their names and avatars. */
    loadReactors: (target: ReactionTarget<Types>) => loadReactorsPage(target, undefined),

    /** Loads the next page of reactors loaded with `loadReactors`. */
    async loadMoreReactors(target: ReactionTarget<Types>) {
      const reactors =
        store.getSnapshot().reactors[reactionKey(target.subjectType, target.subjectId, normalizeEmoji(target.emoji))]
      if (reactors?.cursor && reactors.state !== "loading") {
        await loadReactorsPage(target, reactors.cursor)
      }
    },

    /** Reacts with an emoji. It shows at once, and is rolled back if the server refuses it. */
    react: (target: ReactionTarget<Types>) => write<ReactResult>("react", target),

    /** Removes the signed-in person's reaction with an emoji. */
    unreact: (target: ReactionTarget<Types>) => write<UnreactResult>("unreact", target),

    /** Reacts, or removes the reaction when the signed-in person has already reacted with that emoji. */
    toggle(target: ReactionTarget<Types>): Promise<ReactResult | UnreactResult> {
      const normalized = { ...target, emoji: normalizeEmoji(target.emoji) }
      return reactedWith(normalized)
        ? write<UnreactResult>("unreact", normalized)
        : write<ReactResult>("react", normalized)
    },

    /**
     * Removes reactions on a record, for people the app lets moderate: all of them, or one emoji's, one person's, or
     * both, calling the server a page at a time until it's done. The record and its lists of reactors load again
     * afterward, since live events may arrive before or after the answer, even when a page fails and the pages before it
     * stay removed. A `reset()` meanwhile stops it, and it rejects with `ABORTED`.
     */
    async removeReactions(filter: ReactionFilter<Types>): Promise<{ removed: number }> {
      // Taken now, so no page goes out after reset() as the next person.
      const { signal } = calls
      const started = generation
      const output = { removed: 0 }
      try {
        for (let done = false; !done;) {
          const step = (await call("reactions", "removeReactions", filter, { signal })) as {
            removed: number
            done: boolean
          }
          if (started !== generation) {
            throw new BetterAppsClientError("ABORTED", "The call was cancelled.", { status: 0 })
          }
          output.removed += step.removed
          // A page that removed nothing can't leave more behind, so a server that says otherwise isn't asked forever.
          done = step.done || step.removed === 0
        }
      } finally {
        if (output.removed > 0 && started === generation) {
          dropReactors(subjectKey(filter.subjectType, filter.subjectId))
          await loadNow(filter.subjectType, [filter.subjectId]).catch(() => undefined)
        }
      }
      return output
    },

    /**
     * Applies a live update from `toClientEvent`. Events it has already applied are ignored, and so are the viewer's
     * own changes the store already shows, such as one made in this tab.
     */
    applyEvent(event: ClientReactionEvent | Serialized<ClientReactionEvent>) {
      if (applied.includes(event.id)) {
        return
      }
      applied.push(event.id)
      applied.splice(0, Math.max(0, applied.length - remembered))
      const key = subjectKey(event.subjectType, event.subjectId)
      if (event.type === "subject.changed") {
        // Many reactions changed at once, so a loaded record loads again, and its lists of reactors start over. A load
        // under way may have gone out before the change, so its answer can't be kept.
        bump(key, null)
        dropReactors(key)
        if (confirmed.has(key)) {
          refresh(event.subjectType, event.subjectId)
        }
        return
      }
      const added = event.type === "reaction.added"
      // The viewer's own changes are set rather than counted, so one this tab already applied counts once. Someone
      // else's shows at once, and the record loads again to match the server.
      const base = confirmed.get(key)
      const before = base?.find((reaction) => reaction.emoji === event.emoji)?.count ?? 0
      // An own change the store doesn't have yet, such as from another tab, or a late event for one this tab has since
      // taken back. It shows at once either way, and the record loads again to learn which.
      const surprising =
        event.mine &&
        base !== undefined &&
        (base.find((reaction) => reaction.emoji === event.emoji)?.reacted ?? false) !== added &&
        !(writes.get(key) ?? []).some((write) => write.emoji === event.emoji && write.reacted === added)
      // Someone else's change loads the record again unless it moves the count from what the store had to just what the
      // event says, which saves a load in the usual case. Events that arrive out of order, such as a removal before its
      // add, don't.
      const stale = event.mine ? surprising : base !== undefined && event.count !== before + (added ? 1 : -1)
      if (event.mine) {
        confirm(key, (reactions) => setMine(reactions, event.emoji, added))
      } else {
        // Someone else's change is counted now. A load under way may or may not have it, so its answer can't be kept,
        // and the record loads again once it lands.
        confirm(key, (reactions) => change(reactions, event.emoji, added ? 1 : -1, false), null)
      }
      const list = reactionKey(event.subjectType, event.subjectId, event.emoji)
      update((state) => {
        const shown = show(state, key)
        if (stale) {
          // An event that may be out of date can't say who reacted either, so the emoji's list loads again too.
          return withoutReactors(shown, (name) => name === list)
        }
        // An event without a user id comes from someone the viewer may not see, so lists of reactors stay as they are.
        return event.userId === "" ? shown : withReactor(shown, event, added ? 1 : -1, event.userId)
      })
      if (stale) {
        refresh(event.subjectType, event.subjectId)
      }
    },

    /** The store's state as JSON can carry it, to send a server render's loads to the browser. */
    dehydrate(): DehydratedReactions {
      const state = store.getSnapshot()
      const ready = <Value extends { state: LoadState }>(record: Readonly<Record<string, Value>>) =>
        Object.fromEntries(Object.entries(record).filter(([, value]) => value.state === "ready"))
      // A server render has no writes going, but what's sent is what the server confirmed either way.
      const subjects = Object.fromEntries(
        Object.entries(ready(state.subjects)).map(([key, value]) => [
          key,
          { ...value, reactions: confirmed.get(key) ?? value.reactions, pending: [] }
        ])
      )
      const json = JSON.stringify({ ...state, subjects, reactors: ready(state.reactors) })
      return JSON.parse(json) as DehydratedReactions
    },

    /** Merges a snapshot from `dehydrate`, such as one a server render loaded. */
    hydrate(snapshot: DehydratedReactions) {
      const subjects = snapshot.subjects as Record<string, SubjectReactions>
      for (const [key, value] of Object.entries(subjects)) {
        confirmed.set(key, value.reactions)
      }
      const settings = (snapshot.settings ?? {}) as Record<string, ReactionSettings>
      for (const [key, value] of Object.entries(settings)) {
        const [subjectType] = JSON.parse(key) as [string]
        maxPerUser.set(subjectType, value.maxPerUser)
        if (value.emojis && !value.emojisByOrg) {
          listed.set(subjectType, new Map(value.emojis.map((emoji, index) => [emoji, index])))
        }
        asked.add(subjectType)
      }
      update((state) =>
        Object.keys(subjects).reduce((next, key) => show(next, key), {
          subjects: { ...state.subjects, ...subjects },
          reactors: { ...state.reactors, ...(snapshot.reactors as Record<string, Reactors>) },
          users: { ...state.users, ...(snapshot.users as Record<string, IdentityUser>) },
          settings: { ...state.settings, ...settings }
        })
      )
    },

    /**
     * Empties the store, such as when the signed-in person changes without a page load. Calls still under way are
     * cancelled and reject with an `ABORTED` error.
     */
    reset() {
      generation += 1
      calls.abort()
      calls = new AbortController()
      // Loads asked for this tick haven't gone out yet, so they never do.
      for (const batch of queued.values()) {
        const aborted = new BetterAppsClientError("ABORTED", "The call was cancelled.", { status: 0 })
        batch.waiters.forEach((waiter) => waiter.reject(aborted))
      }
      queued.clear()
      reactorVersions.clear()
      applied.length = 0
      chains.clear()
      confirmed.clear()
      writes.clear()
      maxPerUser.clear()
      listed.clear()
      versions.clear()
      history.clear()
      asked.clear()
      refreshing.clear()
      store.setState(() => empty)
      for (const listener of Array.from(resetListeners)) {
        listener()
      }
    },

    /** Calls `listener` after each `reset()`. Returns a function that stops it. */
    onReset(listener: () => void) {
      resetListeners.add(listener)
      return () => {
        resetListeners.delete(listener)
      }
    }
  }
}
