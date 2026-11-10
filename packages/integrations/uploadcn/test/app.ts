// A test app with files on invoices, drafts for comments, and files on their own, and a browser's view of it: a Better
// Apps client whose fetch goes straight to `app.handler`, the attachments client on top of it, and an UploadCN transport
// that sends bytes where the server said. A test can fail or stall sends, hold an action's answer, or count calls.
import { attachments, memoryStorage, type AttachmentsOptions } from "@better-apps/attachments"
import { createAttachmentsClient } from "@better-apps/attachments/client"
import { createTestApp, type TestUser } from "@better-apps/testing"
import type { Transport } from "@uploadcn/core"
import type { SubjectDefinition } from "better-apps"
import { createBetterAppsClient } from "better-apps/client"

const users = [
  { id: "bob", name: "Bob Babbage", orgId: "acme", roles: [] },
  { id: "gus", name: "Gus Globex", orgId: "globex", roles: [] }
] as const satisfies readonly TestUser[]

const orgs = new Map([
  ["inv-1", "acme"],
  ["inv-2", "acme"],
  ["c-1", "acme"]
])

const subjects = {
  invoice: {
    getOrgId: ({ subjectId }) => orgs.get(subjectId) ?? null,
    canView: ({ actor, subjectId }) => actor.orgId === orgs.get(subjectId)
  },
  comment: {
    getOrgId: ({ subjectId }) => orgs.get(subjectId) ?? null,
    canView: ({ actor, subjectId }) => actor.orgId === orgs.get(subjectId)
  }
} satisfies Record<string, SubjectDefinition>

export const inv1 = { subjectType: "invoice", subjectId: "inv-1" } as const

/** A file as a browser's file picker gives it. */
export function pick(body: string, name = "notes.txt", type = "text/plain"): File {
  return new File([body], name, { type })
}

export function setup({
  extra = {},
  signedUploads = false
}: { extra?: Partial<AttachmentsOptions>; signedUploads?: boolean } = {}) {
  const storage = memoryStorage({ signedUploads })
  const feature = attachments({
    storage,
    subjects: {
      invoice: { contentTypes: ["image/*", "text/plain"], maxSize: 1000, maxFiles: 3 },
      comment: { contentTypes: ["image/*", "text/plain"], maxSize: 1000 }
    },
    standalone: {},
    ...extra
  })
  const { app, identity, database } = createTestApp({ subjects, features: [feature], users })
  const calls: string[] = []
  const heldAnswers = new Map<string, Promise<void>>()
  const heldCalls = new Map<string, Promise<void>>()
  const lostAnswers = new Set<string>()
  const failures = new Map<string, { status: number; code: string }[]>()
  const client = createBetterAppsClient<typeof app>({
    baseURL: "https://app.test",
    fetch: async (url, init) => {
      const action = url.slice(url.lastIndexOf("/") + 1)
      calls.push(action)
      const failure = failures.get(action)?.shift()
      if (failure !== undefined) {
        const { status, code } = failure
        return Response.json({ error: { code, message: "Something went wrong." } }, { status })
      }
      await heldCalls.get(action)
      const headers = new Headers(init.headers)
      for (const [name, value] of Object.entries(identity.headers("bob"))) {
        headers.set(name, value)
      }
      const response = await app.handler(new Request(url, { ...init, headers }))
      await heldAnswers.get(action)
      if (lostAnswers.delete(action)) {
        throw new TypeError("Failed to fetch")
      }
      return response
    }
  })
  const sends: string[] = []
  const sendStatuses: { status: number; body: string }[] = []
  let stall = false
  // Bytes go where the server said, half then all of them, so progress shows. A stalled send waits until it's aborted.
  // Signed sends need the node test environment: happy-dom's Request drops the signed content-length header.
  const sentHeaders: Record<string, string>[] = []
  const transport: Transport = async (request) => {
    sends.push(request.url)
    sentHeaders.push(request.headers ?? {})
    const failure = sendStatuses.shift()
    if (failure !== undefined) {
      return { ...failure, headers: new Headers() }
    }
    const bytes = new Uint8Array(await (request.body as Blob).arrayBuffer())
    request.onUploadProgress?.(Math.floor(bytes.length / 2), bytes.length)
    if (stall) {
      await new Promise((_, reject) =>
        request.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
      )
    }
    const url = new URL(request.url, "https://app.test")
    const sent = new Request(url, {
      method: "PUT",
      headers: { ...request.headers, "content-length": String(bytes.length) },
      body: bytes,
      duplex: "half"
    } as RequestInit)
    const response = url.host === "storage.test" ? await storage.handle(sent) : await app.handler(sent)
    request.onUploadProgress?.(bytes.length, bytes.length)
    return { status: response.status, headers: response.headers, body: await response.text() }
  }
  const holder = (waits: Map<string, Promise<void>>) => (action: string) => {
    let release: () => void = () => undefined
    waits.set(
      action,
      new Promise<void>((resolve) => {
        release = resolve
      })
    )
    return () => {
      waits.delete(action)
      release()
    }
  }
  /** Files that aren't deleted, as the server keeps them. */
  const liveFiles = () =>
    (
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM attachmentFile WHERE status <> 'deleted'").get() as {
        count: number
      }
    ).count
  return {
    app,
    storage,
    client,
    attachments: createAttachmentsClient(client),
    transport,
    calls,
    sends,
    sentHeaders,
    liveFiles,
    /** Answers the next sends with these statuses instead of storing the bytes, with an empty body or the one given. */
    failSends: (...failures: (number | { status: number; body: string })[]) =>
      sendStatuses.push(
        ...failures.map((failure) => (typeof failure === "number" ? { status: failure, body: "" } : failure))
      ),
    /** Answers the next calls of an action with this server error, without the server seeing them. */
    failCalls: (action: string, status: number, { code = "INTERNAL_ERROR", times = 1 } = {}) =>
      failures.set(
        action,
        Array.from({ length: times }, () => ({ status, code }))
      ),
    stallSends: (on: boolean) => {
      stall = on
    },
    /** Holds an action's answer after the server handled it, until the returned function lets it go. */
    holdAnswer: holder(heldAnswers),
    /** Holds an action's call before the server sees it, until the returned function lets it go. */
    holdCall: holder(heldCalls),
    /** Loses the next answer to an action after the server handled it, as a dropped connection does. */
    loseAnswer: (action: string) => lostAnswers.add(action)
  }
}
