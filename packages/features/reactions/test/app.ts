// A test app with reactions on invoices, where each invoice belongs to an organization and may be locked, and on public
// pages anyone can read. A `feed` feature records every reactions event it's delivered, and a `shares` feature lets a
// request see the invoices its `x-share` header lists, the way a share link does.
import { createTestApp, type TestUser } from "@better-apps/testing"
import { defineFeature, type BetterAppsEvent, type EventHandler, type SubjectDefinition } from "better-apps"
import { reactionEvents, reactions, type ReactionsOptions } from "../src/index.js"

export const users = [
  { id: "ada", name: "Ada Lovelace", orgId: "acme", roles: ["admin"] },
  { id: "bob", name: "Bob Babbage", orgId: "acme", roles: [] },
  { id: "cy", name: "Cy Clerk", orgId: "acme", roles: [] },
  { id: "gus", name: "Gus Globex", orgId: "globex", roles: ["admin"] }
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
  page: { publicRead: true, canView: () => true, getOrgId: () => null }
} satisfies Record<string, SubjectDefinition>

export const options = {
  subjects: {
    invoice: { canReact: ({ subjectId }) => invoices.get(subjectId)?.locked !== true },
    page: {}
  }
} satisfies ReactionsOptions

/** A request carrying a grant to see the given invoices, such as one a share link's visitor makes. */
export function sharing(...invoiceIds: string[]): Request {
  return new Request("https://app.test/", { headers: { "x-share": invoiceIds.join(",") } })
}

const shares = defineFeature({
  id: "shares",
  grants: {
    canViewMany: (refs, { request }) => {
      const shared = (request.headers.get("x-share") ?? "").split(",")
      return refs.map((ref) => ref.subjectType === "invoice" && shared.includes(ref.subjectId))
    }
  }
})

/** Creates the app. `extra` changes the reactions options. */
export function setup(extra: Partial<ReactionsOptions> = {}) {
  const delivered: BetterAppsEvent[] = []
  const record: EventHandler = (event) => void delivered.push(event)
  const feed = defineFeature({
    id: "feed",
    on: { reactions: Object.fromEntries(Object.keys(reactionEvents).map((type) => [type, record])) }
  })
  const feature = reactions({ ...options, ...extra } as typeof options)
  const { app, database, identity } = createTestApp({ subjects, features: [feature, feed, shares], users })
  const as = (userId: UserId) => ({ actor: identity.actor(userId) })
  const post = (action: string, body: unknown, userId?: UserId) =>
    app.handler(
      new Request(`https://app.test/api/apps/reactions/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(userId ? identity.headers(userId) : {}) },
        body: JSON.stringify(body)
      })
    )
  const events = (type?: string) => delivered.filter((event) => type === undefined || event.type === type)
  return { app, database, identity, api: app.api.reactions, as, post, events }
}

/** Expects a call to fail with a reactions error code. */
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
