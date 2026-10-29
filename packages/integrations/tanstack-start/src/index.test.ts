import { createTestApp, type TestIdentity } from "@better-apps/testing"
import { createServerEntry } from "@tanstack/react-start/server"
import { runWithStartContext, type StartStorageContext } from "@tanstack/start-storage-context"
import { defineAction, defineEvent, defineFeature, type BetterAppsEvent } from "better-apps"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { createStartBindings, type StartRequestContext, type WaitUntil } from "./index.js"

// The request context a server entry passes, as an app registers it.
declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { waitUntil?: WaitUntil } }
  }
}

const tasks = defineFeature({
  id: "tasks",
  schema: { task: { fields: { title: { type: "string" }, ownerId: { type: "string", required: false } } } },
  events: { "task.added": defineEvent<{ taskId: string }>() },
  actions: {
    add: defineAction({
      input: z.object({ title: z.string().min(1) }),
      handler: async ({ input, db, actor, emit }) => {
        const id = crypto.randomUUID()
        emit("task.added", { taskId: id })
        await db.batch([{ type: "create", model: "task", data: { id, title: input.title, ownerId: actor?.userId } }])
        return { id }
      }
    }),
    whoami: defineAction({
      handler: async ({ actor, request, silent }) => ({ userId: actor?.userId ?? null, url: request?.url, silent })
    })
  }
})

function setup(basePath?: string) {
  const delivered: BetterAppsEvent[] = []
  const audit = defineFeature({
    id: "audit",
    on: { tasks: { "task.added": (event) => void delivered.push(event) } }
  })
  const { app, identity } = createTestApp({
    features: [tasks, audit],
    users: [{ id: "ada", name: "Ada Lovelace" }],
    basePath
  })
  return { app, identity, delivered }
}

function post(identity: TestIdentity, path: string, body: unknown) {
  return new Request(`https://app.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...identity.headers("ada") },
    body: JSON.stringify(body)
  })
}

/** Runs `fn` the way Start runs a server function: inside a request, with the request context after middleware. */
function serve<T>(request: Request, context: StartRequestContext | undefined, fn: () => Promise<T>): Promise<T> {
  let result: Promise<T> | undefined
  const entry = createServerEntry({
    fetch: async () => {
      const run = () => fn()
      result = context
        ? runWithStartContext({ request, contextAfterGlobalMiddlewares: context } as StartStorageContext, run)
        : run()
      await result
      return new Response(null, { status: 204 })
    }
  })
  return Promise.resolve(entry.fetch(request)).then(() => result as Promise<T>)
}

/** A platform `waitUntil` that holds promises until the test settles them. */
function platform() {
  const pending: Promise<unknown>[] = []
  const waitUntil = vi.fn<WaitUntil>((promise) => void pending.push(promise))
  return { waitUntil, settle: () => Promise.all(pending) }
}

describe("handlers", () => {
  it("serves actions over HTTP as the request's user", async () => {
    const { app, identity, delivered } = setup()
    const { handlers } = createStartBindings(app)
    const response = await handlers.ANY({ request: post(identity, "/api/apps/tasks/whoami", {}), context: {} })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      userId: "ada",
      url: "https://app.test/api/apps/tasks/whoami",
      silent: false
    })
    expect(delivered).toEqual([])
  })

  it("answers other methods and unknown actions the way app.handler does", async () => {
    const { app } = setup()
    const { handlers } = createStartBindings(app)
    const get = await handlers.ANY({ request: new Request("https://app.test/api/apps/tasks/add"), context: {} })
    expect(get.status).toBe(405)
    expect(get.headers.get("allow")).toBe("POST")
    const missing = await handlers.ANY({
      request: new Request("https://app.test/api/apps/tasks/missing", { method: "POST" }),
      context: {}
    })
    expect(missing.status).toBe(404)
  })

  it("waits for delivery without a waitUntil", async () => {
    const { app, identity, delivered } = setup()
    const { handlers } = createStartBindings(app)
    const response = await handlers.ANY({
      request: post(identity, "/api/apps/tasks/add", { title: "Ship" }),
      context: {}
    })
    expect(response.status).toBe(200)
    expect(delivered).toMatchObject([{ type: "task.added", actor: { userId: "ada" } }])
  })

  it("hands delivery to the waitUntil it reads from the request context", async () => {
    const { app, identity, delivered } = setup()
    const { waitUntil, settle } = platform()
    const read = vi.fn<(context: StartRequestContext) => WaitUntil | undefined>((context) => context.waitUntil)
    const { handlers } = createStartBindings(app, { waitUntil: read })
    const context = { waitUntil }
    const response = await handlers.ANY({ request: post(identity, "/api/apps/tasks/add", { title: "Ship" }), context })
    expect(response.status).toBe(200)
    expect(read).toHaveBeenCalledWith(context)
    expect(waitUntil).toHaveBeenCalledOnce()
    await settle()
    expect(delivered).toMatchObject([{ type: "task.added" }])
  })

  it("waits for delivery when the reader finds no waitUntil", async () => {
    const { app, identity, delivered } = setup()
    const { handlers } = createStartBindings(app, { waitUntil: () => undefined })
    await handlers.ANY({ request: post(identity, "/api/apps/tasks/add", { title: "Ship" }), context: {} })
    expect(delivered).toHaveLength(1)
  })
})

describe("api", () => {
  it("acts as the user of the request being served", async () => {
    const { app, identity } = setup()
    const { api } = createStartBindings(app)
    const request = new Request("https://app.test/invoices", { headers: identity.headers("ada") })
    expect(await serve(request, undefined, () => api.tasks.whoami())).toEqual({
      userId: "ada",
      url: "https://app.test/invoices",
      silent: false
    })
  })

  it("keeps the options callers pass", async () => {
    const { app, identity } = setup()
    const { api } = createStartBindings(app)
    const request = new Request("https://app.test/", { headers: identity.headers("ada") })
    const other = new Request("https://app.test/other")
    expect(await serve(request, undefined, () => api.tasks.whoami(undefined, { silent: true }))).toMatchObject({
      userId: "ada",
      silent: true
    })
    expect(await serve(request, undefined, () => api.tasks.whoami(undefined, { request: other }))).toEqual({
      userId: null,
      url: "https://app.test/other",
      silent: false
    })
    expect(await serve(request, undefined, () => api.tasks.whoami(undefined, { actor: null }))).toMatchObject({
      userId: null,
      url: "https://app.test/"
    })
  })

  it("runs outside a request when the caller names the actor", async () => {
    const { app, identity } = setup()
    const { api } = createStartBindings(app)
    expect(await api.tasks.whoami(undefined, { actor: identity.actor("ada") })).toEqual({
      userId: "ada",
      silent: false
    })
  })

  it("explains that it needs a request or an actor", async () => {
    const { app } = setup()
    const { api } = createStartBindings(app)
    await expect(api.tasks.whoami()).rejects.toThrow("can't find the request being served")
  })

  it("hands delivery to the waitUntil it reads from the request context", async () => {
    const { app, identity, delivered } = setup()
    const { waitUntil, settle } = platform()
    const { api } = createStartBindings(app, {
      waitUntil: (context) => context.waitUntil
    })
    const request = new Request("https://app.test/", { headers: identity.headers("ada") })
    await serve(request, { waitUntil }, () => api.tasks.add({ title: "Ship" }))
    expect(waitUntil).toHaveBeenCalledOnce()
    expect(delivered).toEqual([])
    await settle()
    expect(delivered).toMatchObject([{ type: "task.added", actor: { userId: "ada" } }])
  })

  it("prefers a waitUntil the caller passes", async () => {
    const { app, identity } = setup()
    const fromContext = platform()
    const fromCaller = platform()
    const { api } = createStartBindings(app, { waitUntil: () => fromContext.waitUntil })
    const request = new Request("https://app.test/", { headers: identity.headers("ada") })
    await serve(request, {}, () => api.tasks.add({ title: "Ship" }, { waitUntil: fromCaller.waitUntil }))
    expect(fromCaller.waitUntil).toHaveBeenCalledOnce()
    expect(fromContext.waitUntil).not.toHaveBeenCalled()
    await fromCaller.settle()
  })

  it("waits for delivery when there's no request context to read", async () => {
    const { app, identity, delivered } = setup()
    const read = vi.fn<() => undefined>(() => undefined)
    const { api } = createStartBindings(app, { waitUntil: read })
    const request = new Request("https://app.test/", { headers: identity.headers("ada") })
    await serve(request, undefined, () => api.tasks.add({ title: "Ship" }))
    expect(read).not.toHaveBeenCalled()
    expect(delivered).toHaveLength(1)
  })
})

describe("client", () => {
  it("calls the app in process as the user of the request being served", async () => {
    const { app, identity } = setup("/rpc")
    const { client } = createStartBindings(app)
    // A form post's own body headers don't carry over to the calls.
    const request = new Request("https://app.test/invoices", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...identity.headers("ada") },
      body: "a=1"
    })
    expect(await serve(request, undefined, () => client().tasks.whoami())).toEqual({
      userId: "ada",
      url: "https://app.test/rpc/tasks/whoami",
      silent: false
    })
    expect(await serve(request, undefined, () => client().tasks.add({ title: "Ship" }))).toHaveProperty("id")
  })

  it("throws the app's errors as client errors", async () => {
    const { app, identity } = setup()
    const { client } = createStartBindings(app)
    const request = new Request("https://app.test/", { headers: identity.headers("ada") })
    await expect(serve(request, undefined, () => client().tasks.add({ title: "" }))).rejects.toMatchObject({
      name: "BetterAppsClientError",
      code: "INVALID_INPUT",
      status: 400
    })
  })

  it("hands delivery to the waitUntil it reads from the request context", async () => {
    const { app, identity, delivered } = setup()
    const { waitUntil, settle } = platform()
    const { client } = createStartBindings(app, { waitUntil: (context) => context.waitUntil })
    const request = new Request("https://app.test/", { headers: identity.headers("ada") })
    await serve(request, { waitUntil }, () => client().tasks.add({ title: "Ship" }))
    expect(waitUntil).toHaveBeenCalledOnce()
    await settle()
    expect(delivered).toMatchObject([{ type: "task.added", actor: { userId: "ada" } }])
  })

  it("explains that it needs a request", () => {
    const { app } = setup()
    const { client } = createStartBindings(app)
    expect(() => client()).toThrow("can't find the request being served")
  })
})
