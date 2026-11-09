// A test app whose links point to invoices, each in an organization, and to pages anyone signed in can see. Links to
// invoices may let anyone who has them see the invoice. A `feed` feature records every short links event it's
// delivered.
import { createTestApp, type TestUser } from "@better-apps/testing"
import { defineFeature, type BetterAppsEvent, type EventHandler, type SubjectDefinition } from "better-apps"
import { shortLinkEvents, shortLinks, type ShortLinksOptions } from "../src/index.js"

export const users = [
  { id: "ada", name: "Ada Lovelace", orgId: "acme", roles: ["admin"] },
  { id: "bob", name: "Bob Babbage", orgId: "acme", roles: [] },
  { id: "cy", name: "Cy Clerk", orgId: "acme", roles: [] },
  { id: "gus", name: "Gus Globex", orgId: "globex", roles: ["admin"] },
  { id: "solo", name: "Solo Sole", orgId: null, roles: [] }
] as const satisfies readonly TestUser[]

export type UserId = (typeof users)[number]["id"]

export const invoices = new Map<string, { orgId: string; locked?: boolean }>([
  ["inv-1", { orgId: "acme" }],
  ["inv-2", { orgId: "acme" }],
  ["inv-locked", { orgId: "acme", locked: true }],
  ["inv-globex", { orgId: "globex" }]
])

const orgOfInvoice = (subjectId: string) => invoices.get(subjectId)?.orgId ?? null

export const subjects = {
  invoice: {
    getOrgId: ({ subjectId }) => orgOfInvoice(subjectId),
    canView: ({ actor, subjectId }) => actor.orgId !== null && actor.orgId === orgOfInvoice(subjectId)
  },
  page: { canView: () => true, getOrgId: () => null }
} satisfies Record<string, SubjectDefinition>

export const options = {
  subjects: {
    invoice: {
      url: ({ subjectId }) => `/invoices/${subjectId}`,
      canShare: ({ subjectId }) => invoices.get(subjectId)?.locked !== true,
      grantView: ({ actor }) => actor.roles.includes("admin") || actor.userId === "bob"
    },
    page: { url: ({ subjectId }) => `https://docs.test/pages/${subjectId}` }
  },
  canManage: ({ actor }) => actor.roles.includes("admin") || actor.userId === "bob"
} satisfies ShortLinksOptions

/** Creates the app. `extra` changes the short links options. */
export function setup(extra: Partial<ShortLinksOptions> = {}) {
  const delivered: BetterAppsEvent[] = []
  const record: EventHandler = (event) => void delivered.push(event)
  const feed = defineFeature({
    id: "feed",
    on: { shortLinks: Object.fromEntries(Object.keys(shortLinkEvents).map((type) => [type, record])) }
  })
  const feature = shortLinks({ ...options, ...extra } as typeof options)
  const { app, database, identity } = createTestApp({ subjects, features: [feature, feed], users })
  const as = (userId: UserId) => ({ actor: identity.actor(userId) })
  const post = (action: string, body: unknown, userId?: UserId) =>
    app.handler(
      new Request(`https://app.test/api/apps/shortLinks/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(userId ? identity.headers(userId) : {}) },
        body: JSON.stringify(body)
      })
    )
  /** Opens a link the way a browser does, with the cookie it holds. */
  const open = (code: string, { cookie, method = "GET" }: { cookie?: string; method?: string } = {}) => {
    const kept: Promise<unknown>[] = []
    const response = app.handler(
      new Request(`https://app.test/s/${code}`, { method, headers: cookie ? { cookie } : {} }),
      { waitUntil: (promise) => kept.push(promise) }
    )
    return { response, kept }
  }
  const events = (type?: string) => delivered.filter((event) => type === undefined || event.type === type)
  return { app, database, identity, api: app.api.shortLinks, as, post, open, events }
}

/** Expects a call to fail with an error code. */
export async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => {
      throw new Error(`Expected ${code}, but the call succeeded.`)
    },
    (caught: unknown) => caught
  )
  if ((error as { code?: unknown }).code !== code) {
    throw new Error(`Expected ${code}, got ${String((error as { code?: unknown }).code ?? error)}`)
  }
}

/** The cookie a response sets, as a browser would send it back. */
export function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
}
