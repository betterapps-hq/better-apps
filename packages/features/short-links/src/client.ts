// The framework-free browser half of short links: lists of links any framework binds to, and the calls that change
// them. It imports no server code.
import type { BetterApp } from "better-apps"
import { createStore, type BetterAppsClient, type CallOptions, type Store } from "better-apps/client"
import type { LinkPage } from "./feature.js"
import type { ShortLink } from "./link.js"
import type { CreateLinkInput, OwnerType, ShortLinksOptions, SubjectTypeOf, UpdateLinkInput } from "./options.js"

export type { ClicksByDay, ClickTotals, LinkPage } from "./feature.js"
export type { ShortLink, ShortLinkTarget } from "./link.js"
export type {
  ClicksByDayInput,
  ClickTotalsInput,
  CreateLinkInput,
  DayRangeInput,
  LinkSort,
  LinkSubject,
  LinkTarget,
  OwnerType,
  ShortLinksOptions,
  SubjectTypeOf,
  UpdateLinkInput
} from "./options.js"

type ShortLinksFeatureOf<App> =
  App extends BetterApp<infer Features> ? Extract<Features[number], { id: "shortLinks" }> : never

/** The subject types an app's links can point to, from `typeof app`. */
export type AppLinkSubjectType<App> =
  ShortLinksFeatureOf<App> extends { options: infer Options extends ShortLinksOptions }
    ? SubjectTypeOf<Options>
    : string

/** Which links a list holds: one record's, or every link the caller manages, narrowed to one owner or not. */
export interface LinkFilter<SubjectType extends string = string> {
  subjectType?: SubjectType | undefined
  subjectId?: string | undefined
  owner?: OwnerType | undefined
}

/** Where a load stands. `error` holds the client error when it failed. */
export type LoadState = "idle" | "loading" | "ready" | "error"

/** One list of links, newest first. */
export interface LinkList {
  links: ShortLink[]
  /** The cursor for the next page, or `null` when every link has loaded. */
  cursor: string | null
  state: LoadState
  error: Error | null
}

/** Everything the store holds: lists keyed by `listKey`. */
export interface ShortLinksState {
  lists: Readonly<Record<string, LinkList>>
}

/** Keys the list for a filter. */
export function listKey(filter: LinkFilter = {}): string {
  return JSON.stringify([filter.subjectType ?? null, filter.subjectId ?? null, filter.owner ?? null])
}

const toDate = (value: unknown): Date | null => (typeof value === "string" ? new Date(value) : (value as Date | null))

/** A link as JSON carried it, with its dates back as `Date`s. */
function revive(value: unknown): ShortLink {
  const link = value as ShortLink
  return {
    ...link,
    expiresAt: toDate(link.expiresAt),
    lastClickedAt: toDate(link.lastClickedAt),
    createdAt: toDate(link.createdAt) as Date,
    updatedAt: toDate(link.updatedAt) as Date
  }
}

/** Whether a list for `filter` should hold a link. */
function belongs(filter: LinkFilter, link: ShortLink): boolean {
  if (filter.owner !== undefined && filter.owner !== link.owner.type) {
    return false
  }
  if (filter.subjectType === undefined) {
    return true
  }
  return (
    link.target.type === "subject" &&
    link.target.subjectType === filter.subjectType &&
    link.target.subjectId === filter.subjectId
  )
}

const empty: ShortLinksState = { lists: {} }
const idle: LinkList = { links: [], cursor: null, state: "idle", error: null }

/** The short links client: a store plus the calls that fill and change it. */
export type ShortLinksClient<SubjectType extends string = string> = ReturnType<
  typeof createShortLinksClientFor<SubjectType>
>

const clients = new WeakMap<object, ShortLinksClient>()

/**
 * Creates the short links store for a Better Apps client. Each Better Apps client has one, so calling this again with
 * the same client, as `useShortLinks` does, returns the store already made. Call `reset()` when someone else signs in
 * without a page load.
 */
export function createShortLinksClient<App = BetterApp>(client: BetterAppsClient<App>) {
  let links = clients.get(client)
  if (!links) {
    links = createShortLinksClientFor((client as BetterAppsClient).$call)
    clients.set(client, links)
  }
  return links as unknown as ShortLinksClient<AppLinkSubjectType<App>>
}

function createShortLinksClientFor<SubjectType extends string>(
  call: (feature: string, action: string, input: unknown, options: CallOptions) => Promise<unknown>
) {
  const store: Store<ShortLinksState> = createStore(empty)
  // reset() cancels calls under way and drops their answers, which belong to the person signed in before.
  let calls = new AbortController()
  let generation = 0
  const run = (action: string, input: unknown) => call("shortLinks", action, input, { signal: calls.signal })
  const filters = new Map<string, LinkFilter>()
  const loading = new Map<string, Promise<void>>()

  // A load's answer may have been read before a change made here since it was asked, so each change is numbered and
  // kept while a load is under way, then made again on top of its answer. Each is safe to make twice: a link listed
  // already isn't added again, an older copy never replaces a newer one, and a removed link stays out.
  type Change = (links: readonly ShortLink[], filter: LinkFilter) => ShortLink[]
  let changes: { at: number; change: Change }[] = []
  let changed = 0
  const asked = new Map<string, number>()

  const change = (made: Change) => {
    changed += 1
    if (asked.size > 0) {
      changes.push({ at: changed, change: made })
    }
    eachList((list, filter) => ({ ...list, links: made(list.links, filter) }))
  }

  /** A load's links with the changes made since it was asked made again on top. */
  const caughtUp = (links: readonly ShortLink[], filter: LinkFilter, since: number) =>
    changes.reduce((next, { at, change: made }) => (at > since ? made(next, filter) : next), [...links])

  /** Ends a load's claim on the changes made since it was asked, dropping the ones no load under way needs. */
  const settle = (key: string) => {
    asked.delete(key)
    const oldest = Math.min(...asked.values())
    changes = changes.filter(({ at }) => at > oldest)
  }

  const setList = (key: string, change: (list: LinkList) => Partial<LinkList>) =>
    store.setState((state) => {
      const current = state.lists[key] ?? idle
      return { lists: { ...state.lists, [key]: { ...current, ...change(current) } } }
    })

  /** Applies a change to every loaded list. */
  const eachList = (apply: (list: LinkList, filter: LinkFilter) => LinkList) =>
    store.setState((state) => ({
      lists: Object.fromEntries(
        Object.entries(state.lists).map(([key, list]) => [key, apply(list, filters.get(key) ?? {})])
      )
    }))

  const fetchPage = (filter: LinkFilter, more: boolean): Promise<void> => {
    const key = listKey(filter)
    const going = loading.get(key)
    if (going) {
      return going
    }
    filters.set(key, filter)
    const started = generation
    const cursor = more ? store.getSnapshot().lists[key]?.cursor : undefined
    if (more && !cursor) {
      return Promise.resolve()
    }
    setList(key, () => ({ state: "loading", error: null }))
    const since = changed
    asked.set(key, since)
    const page = (async () => {
      try {
        const answer = (await run("list", { ...filter, ...(cursor ? { cursor } : {}) })) as LinkPage
        if (started !== generation) {
          return
        }
        const links = answer.links.map(revive)
        setList(key, (list) => ({
          links: caughtUp(
            more ? [...list.links, ...links.filter((link) => !list.links.some((had) => had.id === link.id))] : links,
            filter,
            since
          ),
          cursor: answer.cursor,
          state: "ready",
          error: null
        }))
      } catch (error) {
        if (started === generation) {
          setList(key, () => ({ state: "error", error: error as Error }))
        }
        throw error
      } finally {
        // After a reset(), the key may belong to a newer load.
        if (started === generation) {
          loading.delete(key)
          settle(key)
        }
      }
    })()
    loading.set(key, page)
    return page
  }

  return {
    store,
    /** Loads the first page of a list, such as a record's links. A load under way for the same list is shared. */
    load: (filter: LinkFilter<SubjectType> = {}) => fetchPage(filter, false),
    /** Loads the next page of a list that has one. */
    loadMore: (filter: LinkFilter<SubjectType> = {}) => fetchPage(filter, true),
    /** Makes a link and puts it first in the loaded lists it belongs in. */
    async create(input: CreateLinkInput<SubjectType>): Promise<ShortLink> {
      const started = generation
      const link = revive(await run("create", input))
      if (started === generation) {
        change((links, filter) =>
          belongs(filter, link) && !links.some((had) => had.id === link.id) ? [link, ...links] : [...links]
        )
      }
      return link
    },
    /** Changes a link, such as turning it off, and shows the change in every loaded list. */
    async update(input: UpdateLinkInput): Promise<ShortLink> {
      const started = generation
      const link = revive(await run("update", input))
      if (started === generation) {
        change((links) =>
          links.map((had) => (had.id === link.id && had.updatedAt.getTime() <= link.updatedAt.getTime() ? link : had))
        )
      }
      return link
    },
    /** Removes a link and takes it out of every loaded list. */
    async remove(id: string): Promise<{ removed: boolean }> {
      const started = generation
      const result = (await run("remove", { id })) as { removed: boolean }
      if (started === generation) {
        change((links) => links.filter((had) => had.id !== id))
      }
      return result
    },
    /** Empties the store and cancels calls under way, such as when someone else signs in. */
    reset() {
      calls.abort()
      calls = new AbortController()
      generation += 1
      loading.clear()
      filters.clear()
      asked.clear()
      changes = []
      store.setState(empty)
    }
  }
}
