// React hooks over the short links store, with no UI: apps bring their own share dialog and lists.
import { useBetterApps, useStore } from "@better-apps/react"
import type { BetterApp } from "better-apps"
import type { BetterAppsClient } from "better-apps/client"
import { useEffect } from "react"
import {
  createShortLinksClient,
  listKey,
  type LinkFilter,
  type LinkList,
  type ShortLinksClient,
  type ShortLinksState
} from "./client.js"

export * from "./client.js"

/**
 * The short links client for the nearest `BetterAppsProvider`. Each Better Apps client has one, so every hook shares
 * one store. Pass `typeof app` for the app's subject types.
 */
export function useShortLinks<App = BetterApp>() {
  return createShortLinksClient(useBetterApps<BetterAppsClient<App>>())
}

const idle: LinkList = { links: [], cursor: null, state: "idle", error: null }

/** A list of links as `useLinks` returns it, with the calls that change it. */
export interface LinksResult<SubjectType extends string> extends LinkList {
  /** Loads the next page, when `cursor` says there is one. */
  loadMore(): Promise<void>
  /** The short links client, to make, change and remove links. */
  client: ShortLinksClient<SubjectType>
}

/**
 * A list of links, loaded on first use: one record's, with `subjectType` and `subjectId`, or every link the signed-in
 * person manages. Links made, changed and removed through the same client show at once.
 */
export function useLinks<SubjectType extends string = string>(
  filter: LinkFilter<SubjectType> = {}
): LinksResult<SubjectType> {
  const client = useShortLinks() as unknown as ShortLinksClient<SubjectType>
  const key = listKey(filter)
  const list = useStore(client.store, (state: ShortLinksState) => state.lists[key]) ?? idle
  const { subjectType, subjectId, owner } = filter
  const loaded = list.state
  useEffect(() => {
    if (loaded === "idle") {
      client.load({ subjectType, subjectId, owner }).catch(() => undefined)
    }
  }, [client, subjectType, subjectId, owner, loaded])
  return { ...list, loadMore: () => client.loadMore({ subjectType, subjectId, owner }), client }
}
