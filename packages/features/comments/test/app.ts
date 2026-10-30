// A test app with comments on invoices, where each invoice belongs to an organization and may be locked, and on public
// pages anyone can read. An `audit` feature records every comments event it's delivered.
import { createTestApp, type TestUser } from "@better-apps/testing"
import { defineFeature, type BetterAppsEvent, type EventHandler, type SubjectDefinition } from "better-apps"
import { commentEvents, comments, CommentsError, elementAnchor, type CommentsOptions } from "../src/index.js"

export const users = [
  { id: "ada", name: "Ada Lovelace", email: "ada@acme.test", orgId: "acme", roles: ["admin"] },
  { id: "bob", name: "Bob Babbage", email: "bob@acme.test", orgId: "acme", roles: [] },
  { id: "sam", name: "Sam Staff", email: "sam@acme.test", orgId: "acme", roles: ["staff"] },
  { id: "gus", name: "Gus Globex", email: "gus@globex.test", orgId: "globex", roles: ["admin"] }
] as const satisfies readonly TestUser[]

export type UserId = (typeof users)[number]["id"]

export const invoices = new Map<string, { orgId: string; locked?: boolean }>([
  ["inv-1", { orgId: "acme" }],
  ["inv-2", { orgId: "acme" }],
  ["inv-locked", { orgId: "acme", locked: true }],
  ["inv-globex", { orgId: "globex" }]
])

const orgOfInvoice = (subjectId: string) => invoices.get(subjectId)?.orgId ?? null

/** The app's subject types: invoices, seen within their organization, and public pages. */
export const subjects = {
  invoice: {
    getOrgId: ({ subjectId }) => orgOfInvoice(subjectId),
    canView: ({ actor, subjectId }) => actor.orgId !== null && actor.orgId === orgOfInvoice(subjectId)
  },
  page: {
    publicRead: true,
    canView: () => true,
    getOrgId: () => null
  }
} satisfies Record<string, SubjectDefinition>

export const options = {
  subjects: {
    invoice: {
      canComment: ({ actor, subjectId }) =>
        actor.orgId === orgOfInvoice(subjectId) && invoices.get(subjectId)?.locked !== true,
      canModerate: ({ actor }) => actor.roles.includes("admin"),
      visibility: { staff: ({ actor }) => actor.roles.includes("staff") || actor.roles.includes("admin") }
    },
    page: {
      canComment: () => true
    }
  },
  anchors: [elementAnchor()],
  additionalFields: {
    thread: {
      priority: { type: ["low", "high"], required: false, index: true },
      label: { type: "string", required: false }
    },
    comment: { source: { type: "string", required: false } }
  }
} satisfies CommentsOptions

/** Creates the app. `extra` changes the comments options, such as to add hooks, and `appSubjects` the app's subjects. */
export function setup(extra: Partial<CommentsOptions> = {}, appSubjects: Record<string, SubjectDefinition> = {}) {
  const delivered: BetterAppsEvent[] = []
  const record: EventHandler = (event) => void delivered.push(event)
  const audit = defineFeature({
    id: "audit",
    on: { comments: Object.fromEntries(Object.keys(commentEvents).map((type) => [type, record])) }
  })
  const feature = comments({ ...options, ...extra } as typeof options)
  const { app, database, identity } = createTestApp({
    subjects: { ...subjects, ...appSubjects },
    features: [feature, audit],
    users
  })
  const as = (userId: UserId) => ({ actor: identity.actor(userId) })
  const post = (action: string, body: unknown, userId?: UserId) =>
    app.handler(
      new Request(`https://app.test/api/apps/comments/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(userId ? identity.headers(userId) : {}) },
        body: JSON.stringify(body)
      })
    )
  const events = (type?: string) => delivered.filter((event) => type === undefined || event.type === type)
  const clearEvents = () => void delivered.splice(0)
  return { app, database, identity, api: app.api.comments, as, post, events, clearEvents }
}

/** Expects a call to fail with a comments error code. */
export async function expectCode(promise: Promise<unknown>, code: string): Promise<CommentsError> {
  const error = await promise.then(
    () => {
      throw new Error(`Expected ${code}, but the call succeeded.`)
    },
    (caught: unknown) => caught
  )
  if (!(error instanceof Error) || (error as { code?: unknown }).code !== code) {
    throw new Error(`Expected ${code}, got ${String((error as { code?: unknown }).code ?? error)}`)
  }
  return error as CommentsError
}
