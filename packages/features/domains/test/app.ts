// A test app with domains for two organizations, Acme and Globex, on the local provider. A `feed` feature records
// every domains event it's delivered.
import { createTestApp, type TestUser } from "@better-apps/testing"
import { defineFeature, type BetterAppsEvent, type EventHandler } from "better-apps"
import { domainEvents, domains, localHostnames, type DomainsOptions, type LocalHostnamesOptions } from "../src/index.js"

export const users = [
  { id: "ada", name: "Ada Lovelace", orgId: "acme", roles: ["owner"] },
  { id: "bob", name: "Bob Babbage", orgId: "acme", roles: [] },
  { id: "gus", name: "Gus Globex", orgId: "globex", roles: ["admin"] }
] as const satisfies readonly TestUser[]

export type UserId = (typeof users)[number]["id"]

/** Creates the app. `extra` changes the domains options, and `local` the local provider's. */
export function setup(extra: Partial<DomainsOptions> = {}, local: LocalHostnamesOptions = {}) {
  const provider = localHostnames({ target: "customers.yourapp.com", ...local })
  const delivered: BetterAppsEvent[] = []
  const record: EventHandler = (event) => void delivered.push(event)
  const feed = defineFeature({
    id: "feed",
    on: {
      domains: Object.fromEntries(
        Object.keys(domainEvents)
          .filter((type) => type !== "check.scheduled")
          .map((type) => [type, record])
      )
    }
  })
  const feature = domains({
    subdomains: { zone: "yourapp.com" },
    custom: { provider },
    dns: provider.dns,
    ...extra
  })
  const { app, database, identity } = createTestApp({ features: [feature, feed], users })
  const as = (userId: UserId) => ({ actor: identity.actor(userId) })
  const post = (action: string, body: unknown, userId?: UserId) =>
    app.handler(
      new Request(`https://app.test/api/apps/domains/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(userId ? identity.headers(userId) : {}) },
        body: JSON.stringify(body)
      })
    )
  const events = (type?: string) => delivered.filter((event) => type === undefined || event.type === type)
  /** The outbox's scheduled checks, with when each is due. */
  const scheduled = () =>
    database.sqlite
      .prepare("SELECT data FROM betterAppsEvent WHERE type = 'check.scheduled'")
      .all()
      .map((row) => JSON.parse(String((row as { data: string }).data)) as { domainId: string; token: string })
  return { app, database, identity, provider, api: app.api.domains, as, post, events, scheduled }
}
