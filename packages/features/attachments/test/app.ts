// A test app with files on invoices, where each invoice belongs to an organization and may be locked, on public pages
// anyone can read, and on their own. A `feed` feature records every attachments event it's delivered.
import { createTestApp, type TestUser } from "@better-apps/testing"
import { defineFeature, type BetterAppsEvent, type EventHandler, type SubjectDefinition } from "better-apps"
import { attachmentEvents, attachments, fileModel, memoryStorage, type AttachmentsOptions } from "../src/index.js"

export const users = [
  { id: "ada", name: "Ada Lovelace", orgId: "acme", roles: ["admin"] },
  { id: "bob", name: "Bob Babbage", orgId: "acme", roles: [] },
  { id: "cy", name: "Cy Clerk", orgId: "acme", roles: [] },
  { id: "gus", name: "Gus Globex", orgId: "globex", roles: ["admin"] },
  { id: "solo", name: "Solo Sam", roles: [] }
] as const satisfies readonly TestUser[]

export type UserId = (typeof users)[number]["id"]

export const invoices = new Map<string, { orgId: string; locked?: boolean }>([
  ["inv-1", { orgId: "acme" }],
  ["inv-2", { orgId: "acme" }],
  ["inv-locked", { orgId: "acme", locked: true }],
  ["inv-globex", { orgId: "globex" }]
])

const orgOfInvoice = (subjectId: string) => invoices.get(subjectId)?.orgId ?? null

/**
 * Invoices that pass this many more access checks, then can't be seen, as one deleted while a file is attached to it.
 */
export const vanishing = new Map<string, number>()

function stillVisible(subjectId: string): boolean {
  const left = vanishing.get(subjectId)
  if (left === undefined) {
    return true
  }
  vanishing.set(subjectId, left - 1)
  return left > 0
}

export const subjects = {
  invoice: {
    getOrgId: ({ subjectId }) => orgOfInvoice(subjectId),
    canView: ({ actor, subjectId }) =>
      actor.orgId !== null && actor.orgId === orgOfInvoice(subjectId) && stillVisible(subjectId)
  },
  page: { publicRead: true, canView: () => true, getOrgId: () => null }
} satisfies Record<string, SubjectDefinition>

export const secret = "a test secret that is long enough to sign"

export const inv1 = { subjectType: "invoice", subjectId: "inv-1" } as const

/** Creates the app. `extra` changes the attachments options; `signedUploads` makes storage sign direct uploads. */
export function setup(extra: Partial<AttachmentsOptions> = {}, { signedUploads = false } = {}) {
  const storage = memoryStorage({ signedUploads })
  const delivered: BetterAppsEvent[] = []
  const record: EventHandler = (event) => void delivered.push(event)
  const feed = defineFeature({
    id: "feed",
    on: { attachments: Object.fromEntries(Object.keys(attachmentEvents).map((type) => [type, record])) }
  })
  // A share link: a request with `x-share: {invoiceId}` may see that invoice, as a share link's grant would allow.
  const share = defineFeature({
    id: "share",
    grants: { canViewMany: (checks) => checks.map((check) => check.subjectId === check.request.headers.get("x-share")) }
  })
  const feature = attachments({
    storage,
    subjects: {
      invoice: {
        canUpload: ({ subjectId }) => invoices.get(subjectId)?.locked !== true,
        canModerate: ({ actor }) => actor.roles.includes("admin"),
        contentTypes: ["image/*", "application/pdf", "text/plain"],
        maxSize: 1000,
        maxFiles: 3
      },
      page: {}
    },
    standalone: { canManage: ({ actor }) => actor.roles.includes("admin") },
    ...extra
  })
  const { app, database, identity } = createTestApp({ subjects, features: [feature, feed, share], users })
  const as = (userId: UserId) => ({ actor: identity.actor(userId) })
  /** Sends a request as a user, or signed out. */
  const request = async (url: string, init: RequestInit = {}, userId?: UserId) =>
    app.handler(
      new Request(new URL(url, "https://app.test"), {
        ...init,
        headers: { ...(init.headers as Record<string, string>), ...(userId ? identity.headers(userId) : {}) }
      })
    )

  /** Sends an upload's bytes where `createUpload` said to, as a browser does. */
  const send = async (upload: { url: string; headers: Record<string, string> }, bytes: Uint8Array | string) => {
    const body = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes
    const init = {
      method: "PUT",
      headers: { ...upload.headers, "content-length": String(body.length) },
      body,
      duplex: "half"
    } as RequestInit
    const url = new URL(upload.url, "https://app.test")
    return url.host === "storage.test" ? storage.handle(new Request(url, init)) : app.handler(new Request(url, init))
  }

  /** Uploads a file all the way, as a user. */
  const upload = async (
    userId: UserId,
    target: { subjectType?: "invoice" | "page"; subjectId?: string; owner?: "user" | "org" },
    {
      name = "notes.txt",
      contentType = "text/plain",
      bytes = "hello"
    }: { name?: string; contentType?: string; bytes?: string } = {}
  ) => {
    const size = new TextEncoder().encode(bytes).length
    const created = await app.api.attachments.createUpload({ ...target, name, contentType, size } as never, as(userId))
    const sent = await send(created.upload, bytes)
    if (!sent.ok) {
      throw new Error(`The upload failed with ${sent.status}: ${await sent.text()}`)
    }
    return app.api.attachments.completeUpload({ fileId: created.file.id }, as(userId))
  }

  const events = (type?: string) => delivered.filter((event) => type === undefined || event.type === type)
  // A deleted file's row waits until its upload address closed, so files count only while they aren't deleted.
  const count = (table: string) =>
    (
      database.sqlite
        .prepare(`SELECT COUNT(*) AS count FROM ${table}${table === fileModel ? " WHERE status <> 'deleted'" : ""}`)
        .get() as { count: number }
    ).count
  return { app, database, identity, storage, api: app.api.attachments, as, request, send, upload, events, count }
}
