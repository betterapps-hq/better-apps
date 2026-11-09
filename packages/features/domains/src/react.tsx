// A React hook over the domains store, with no UI: apps bring their own settings screen.
import { useBetterApps, useStore } from "@better-apps/react"
import type { BetterApp } from "better-apps"
import type { BetterAppsClient } from "better-apps/client"
import { useEffect } from "react"
import { createDomainsClient, type Domain, type DomainsClient } from "./client.js"

export * from "./client.js"

/** The domains client for the nearest `BetterAppsProvider`. Each Better Apps client has one, so hooks share one store. */
export function useDomainsClient<App = BetterApp>(): DomainsClient {
  return createDomainsClient(useBetterApps<BetterAppsClient<App>>())
}

const none: Domain[] = []

/**
 * The organization's domains and the calls that change them, loaded on first use. `list` holds the settings a screen
 * needs, such as whether the viewer can manage domains and the zone for subdomains, once loaded.
 */
export function useDomains() {
  const client = useDomainsClient()
  const state = useStore(client.store)
  const loadState = state.state
  useEffect(() => {
    if (loadState === "idle") {
      client.load().catch(() => undefined)
    }
  }, [client, loadState])
  return {
    domains: state.list?.domains ?? none,
    list: state.list,
    state: loadState === "idle" ? "loading" : loadState,
    error: state.error,
    /** What each domain is waiting on, such as `check`, by id. */
    calls: state.calls,
    reload: client.load,
    add: client.add,
    check: client.check,
    remove: client.remove,
    setPrimary: client.setPrimary
  }
}
