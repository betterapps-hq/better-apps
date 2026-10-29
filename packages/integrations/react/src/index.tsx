import type { BetterAppsClient, Store } from "better-apps/client"
import { createContext, useContext, useRef, useSyncExternalStore, type ReactNode } from "react"

const ClientContext = createContext<object | null>(null)

/** Makes a client from `createBetterAppsClient` available to the hooks below it. */
export function BetterAppsProvider({ client, children }: { client: object; children?: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
}

/**
 * The client from the nearest `BetterAppsProvider`. Pass its type, such as `BetterAppsClient<typeof app>`, to call
 * actions with their types.
 */
export function useBetterApps<Client extends object = BetterAppsClient>(): Client {
  const client = useContext(ClientContext)
  if (!client) {
    throw new Error("useBetterApps needs a BetterAppsProvider above it.")
  }
  return client as Client
}

const same = <Value,>(value: Value) => value

/** Reads a store and re-renders when it changes. Works with server rendering, where the snapshot doesn't change. */
export function useStore<State>(store: Store<State>): State
/**
 * Reads part of a store and re-renders only when that part changes. The selection is cached per state, so a selector
 * may build a new object or array; pass `isEqual` to also keep it across states that select equal values.
 */
export function useStore<State, Selected>(
  store: Store<State>,
  select: (state: State) => Selected,
  isEqual?: (previous: Selected, next: Selected) => boolean
): Selected
export function useStore<State, Selected>(
  store: Store<State>,
  select: (state: State) => Selected = same as (state: State) => Selected,
  isEqual: (previous: Selected, next: Selected) => boolean = Object.is
): Selected {
  const cache = useRef<{ state: State; select: (state: State) => Selected; selected: Selected } | null>(null)
  const getSelection = () => {
    const state = store.getSnapshot()
    const previous = cache.current
    if (previous && Object.is(previous.state, state) && previous.select === select) {
      return previous.selected
    }
    const next = select(state)
    const selected = previous && isEqual(previous.selected, next) ? previous.selected : next
    cache.current = { state, select, selected }
    return selected
  }
  return useSyncExternalStore(store.subscribe, getSelection, getSelection)
}
