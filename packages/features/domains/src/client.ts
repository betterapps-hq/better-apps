// The framework-free browser half of domains: a store of the organization's domains that any framework binds to, for
// a settings screen. It imports no server code.
import type { BetterApp } from "better-apps"
import { createStore, type BetterAppsClient, type Serialized, type Store } from "better-apps/client"
import type { Domain, DomainList } from "./feature.js"

export type { Domain, DomainList } from "./feature.js"
export type { AddDomainInput } from "./options.js"
export type { CertificateStatus, DnsRecord, RecordPurpose } from "./provider.js"
export type { CheckedRecord, DomainKind, DomainStatus } from "./schema.js"

/** Where the list's load stands. */
export type LoadState = "idle" | "loading" | "ready" | "error"

/** What a domain is waiting on. */
export type DomainCall = "check" | "remove" | "primary"

/** Everything the store holds. */
export interface DomainsState {
  state: LoadState
  error: Error | null
  /** The organization's domains and settings, once loaded. */
  list: DomainList | null
  /** Calls still waiting for the server, by domain id. */
  calls: Readonly<Record<string, DomainCall>>
}

const empty: DomainsState = { state: "idle", error: null, list: null, calls: {} }

const date = (value: string | null) => (value === null ? null : new Date(value))

function fromJson(domain: Serialized<Domain>): Domain {
  return {
    ...domain,
    records: domain.records.map((record) => ({ ...record })),
    createdAt: new Date(domain.createdAt),
    lastCheckedAt: date(domain.lastCheckedAt),
    nextCheckAt: date(domain.nextCheckAt),
    verifiedAt: date(domain.verifiedAt)
  }
}

/** What the browser can add: a subdomain label, or a custom hostname. */
export type NewDomain = { kind: "subdomain"; label: string } | { kind: "custom"; hostname: string }

type Call = (feature: string, action: string, input?: unknown) => Promise<unknown>

const clients = new WeakMap<object, DomainsClient>()

/**
 * Creates the domains store for a Better Apps client. Each Better Apps client has one store, so calling this again
 * with the same client, as `useDomains` does, returns the store already made. When someone else signs in without a
 * page load, call `reset()`.
 */
export function createDomainsClient<App = BetterApp>(client: BetterAppsClient<App>): DomainsClient {
  let domains = clients.get(client)
  if (!domains) {
    domains = createDomainsClientFor((client as BetterAppsClient).$call)
    clients.set(client, domains)
  }
  return domains
}

function createDomainsClientFor(call: Call): DomainsClient {
  const store: Store<DomainsState> = createStore(empty)
  // Bumped by `reset`, so answers to calls made for the previous person are dropped.
  let generation = 0
  let loading: Promise<void> | null = null

  async function loadList(): Promise<void> {
    const started = generation
    store.setState((state) => ({ ...state, state: "loading", error: null }))
    try {
      const list = (await call("domains", "list")) as Serialized<DomainList>
      if (started === generation) {
        store.setState((state) => ({
          ...state,
          state: "ready",
          list: { ...list, domains: list.domains.map(fromJson) }
        }))
      }
    } catch (caught) {
      if (started === generation) {
        store.setState((state) => ({ ...state, state: "error", error: caught as Error }))
      }
      throw caught
    }
  }

  const setCall = (domainId: string, kind: DomainCall | null) =>
    store.setState((state) => {
      const calls = { ...state.calls }
      if (kind) {
        calls[domainId] = kind
      } else {
        delete calls[domainId]
      }
      return { ...state, calls }
    })

  /** Puts a domain the server returned in the list, in its place or last, and keeps one primary domain. */
  const put = (domain: Domain) =>
    store.setState((state) => {
      if (!state.list) {
        return state
      }
      const others = state.list.domains.map((existing) =>
        domain.primary && existing.id !== domain.id ? { ...existing, primary: false } : existing
      )
      const index = others.findIndex((existing) => existing.id === domain.id)
      const next = index === -1 ? [...others, domain] : others.map((existing, at) => (at === index ? domain : existing))
      return { ...state, list: { ...state.list, domains: next } }
    })

  /** Runs a call for one domain, marking it busy meanwhile. Answers for a previous person are dropped. */
  async function withCall<Result>(
    domainId: string,
    kind: DomainCall,
    run: () => Promise<Result>,
    apply: (result: Result) => void
  ) {
    const started = generation
    setCall(domainId, kind)
    try {
      const result = await run()
      if (started === generation) {
        apply(result)
      }
      return result
    } finally {
      if (started === generation) {
        setCall(domainId, null)
      }
    }
  }

  return {
    store,
    load(): Promise<void> {
      loading ??= loadList().finally(() => {
        loading = null
      })
      return loading
    },
    async add(input: NewDomain): Promise<Domain> {
      const started = generation
      const domain = fromJson((await call("domains", "add", input)) as Serialized<Domain>)
      if (started === generation) {
        put(domain)
      }
      return domain
    },
    check(domainId: string): Promise<Domain> {
      return withCall(
        domainId,
        "check",
        async () => fromJson((await call("domains", "check", { domainId })) as Serialized<Domain>),
        put
      )
    },
    remove(domainId: string): Promise<{ removed: boolean }> {
      return withCall(
        domainId,
        "remove",
        async () => (await call("domains", "remove", { domainId })) as { removed: boolean },
        () =>
          store.setState((state) =>
            state.list
              ? {
                  ...state,
                  list: { ...state.list, domains: state.list.domains.filter((domain) => domain.id !== domainId) }
                }
              : state
          )
      )
    },
    setPrimary(domainId: string | null): Promise<Domain | null> {
      return withCall(
        domainId ?? "",
        "primary",
        async () => {
          const { primary } = (await call("domains", "setPrimary", { domainId })) as {
            primary: Serialized<Domain> | null
          }
          return primary ? fromJson(primary) : null
        },
        (primary) => {
          if (primary) {
            put(primary)
            return
          }
          store.setState((state) =>
            state.list
              ? {
                  ...state,
                  list: { ...state.list, domains: state.list.domains.map((domain) => ({ ...domain, primary: false })) }
                }
              : state
          )
        }
      )
    },
    reset(): void {
      generation++
      loading = null
      store.setState(empty)
    }
  }
}

/** The domains store and the calls that keep it up to date. */
export interface DomainsClient {
  store: Store<DomainsState>
  /** Loads the organization's domains and settings. Loads asked for while one is under way share it. */
  load(): Promise<void>
  /** Adds a domain and shows it last. */
  add(input: NewDomain): Promise<Domain>
  /** Checks a domain's records now and shows what the check found. */
  check(domainId: string): Promise<Domain>
  /** Removes a domain. */
  remove(domainId: string): Promise<{ removed: boolean }>
  /** Makes a domain the primary one, or leaves the organization without one when `domainId` is `null`. */
  setPrimary(domainId: string | null): Promise<Domain | null>
  /** Empties the store and drops answers still on their way, such as when someone else signs in. */
  reset(): void
}
