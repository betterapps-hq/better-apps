import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import { memoryDatabase, type MemoryDatabase } from "../test/memory-database.js"
import {
  BetterAppsError,
  createBetterApps,
  defineAction,
  defineEvent,
  defineFeature,
  eventModel,
  type Actor,
  type BetterAppsEvent,
  type BetterAppsFeature,
  type ErrorContext,
  type Identity,
  type Row,
  type StandardSchemaV1
} from "./index.js"

// A Standard Schema validator, as zod or Valibot would provide.
const noteInput: StandardSchemaV1<{ text: string }, { text: string }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const text = (value as { text?: unknown } | undefined)?.text
      return typeof text === "string" && text.trim() !== ""
        ? { value: { text: text.trim() } }
        : { issues: [{ message: "Text is required.", path: [{ key: "text" }] }] }
    }
  }
}

const failure: StandardSchemaV1<{ code: string; status?: number }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => ({ value: value as { code: string; status?: number } })
  }
}

const ada: Actor = { userId: "ada", orgId: "acme", roles: ["admin"] }

// Reads the actor from an x-user header, the way a provider reads its session cookie.
const identity: Identity = {
  getActor: async (request) => (request.headers.get("x-user") === "ada" ? ada : null),
  getActorsFor: async () => []
}

const notes = defineFeature({
  id: "notes",
  schema: { note: { fields: { text: { type: "string" }, authorId: { type: "string", required: false } } } },
  events: { "note.added": defineEvent<{ noteId: string; text: string }>() },
  actions: {
    add: defineAction({
      input: noteInput,
      handler: async ({ input, db, author, emit }) => {
        const id = crypto.randomUUID()
        emit("note.added", { noteId: id, text: input.text })
        const authorId = author?.type === "user" ? author.userId : null
        const [note] = await db.batch([{ type: "create", model: "note", data: { id, text: input.text, authorId } }])
        return note as Row
      }
    }),
    whoAmI: defineAction({
      handler: ({ actor, author, now, silent, source, request }) => ({
        actor,
        author,
        now: now.toISOString(),
        silent,
        source,
        hasRequest: request !== null
      })
    }),
    fail: defineAction({
      input: failure,
      handler: ({ input }) => {
        throw new BetterAppsError(input.code, `Failed with ${input.code}.`, { status: input.status })
      }
    }),
    crash: defineAction({
      handler: () => {
        throw new Error("secret detail")
      }
    }),
    purge: defineAction({ serverOnly: true, handler: () => "purged" })
  }
})

function setup<const Extra extends readonly BetterAppsFeature[] = readonly []>(extra: { features?: Extra } = {}) {
  const memory: MemoryDatabase = memoryDatabase()
  const onError = vi.fn<(error: unknown, context: ErrorContext) => void | Promise<void>>()
  const features = [notes, ...(extra.features ?? [])] as unknown as readonly [typeof notes, ...Extra]
  const app = createBetterApps({ database: memory.database, identity, features, onError })
  return { app, memory, onError }
}

function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://app.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe("app.api", () => {
  it("checks the input with the action's schema and returns the handler's output", async () => {
    const { app, memory } = setup()
    const note = await app.api.notes.add({ text: "  Hello  " }, { actor: ada })
    expect(note).toMatchObject({ text: "Hello", authorId: "ada" })
    expect(memory.tables.get("note")).toHaveLength(1)
  })

  it("rejects input the schema doesn't accept", async () => {
    const { app } = setup()
    const error = await app.api.notes.add({ text: " " }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BetterAppsError)
    expect(error).toMatchObject({
      code: "INVALID_INPUT",
      status: 400,
      issues: [{ message: "Text is required.", path: ["text"] }]
    })
  })

  it("reads the actor from a request and passes server-only options through", async () => {
    const { app } = setup()
    const createdAt = new Date("2026-01-02T03:04:05.000Z")
    const author = { type: "external", name: "Email reply" } as const
    expect(
      await app.api.notes.whoAmI(undefined, {
        request: post("/", undefined, { "x-user": "ada" }),
        author,
        createdAt,
        silent: true
      })
    ).toEqual({ actor: ada, author, now: createdAt.toISOString(), silent: true, source: "api", hasRequest: true })
  })

  it("acts as the given actor, or as nobody without one", async () => {
    const { app } = setup()
    expect(await app.api.notes.whoAmI(undefined, { actor: ada })).toMatchObject({
      actor: ada,
      author: { type: "user", userId: "ada" }
    })
    expect(await app.api.notes.whoAmI()).toMatchObject({ actor: null, author: null, silent: false, hasRequest: false })
  })

  it("calls server-only actions", async () => {
    const { app } = setup()
    expect(await app.api.notes.purge()).toBe("purged")
  })

  it("types each action's input and output", () => {
    const { app } = setup()
    expectTypeOf(app.api.notes.add).parameter(0).toEqualTypeOf<{ text: string }>()
    expectTypeOf(app.api.notes.add).returns.resolves.toEqualTypeOf<Row>()
    expectTypeOf(app.api.notes.purge).returns.resolves.toEqualTypeOf<string>()
    expectTypeOf<(typeof app.$Infer)["Events"]>().toEqualTypeOf<
      BetterAppsEvent<{ noteId: string; text: string }> & { feature: "notes"; type: "note.added" }
    >()
  })
})

describe("app.handler", () => {
  it("runs an action for a POST with JSON input", async () => {
    const { app } = setup()
    const response = await app.handler(post("/api/apps/notes/add", { text: "Hi" }, { "x-user": "ada" }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ text: "Hi", authorId: "ada" })
  })

  it("treats an empty body as no input and attributes the call to the signed-in user", async () => {
    const { app } = setup()
    const response = await app.handler(post("/api/apps/notes/whoAmI", undefined, { "x-user": "ada" }))
    expect(await response.json()).toMatchObject({
      actor: ada,
      author: { type: "user", userId: "ada" },
      source: "http",
      silent: false
    })
  })

  it("answers on a custom base path", async () => {
    const memory = memoryDatabase()
    const app = createBetterApps({ database: memory.database, identity, features: [notes], basePath: "/apps/" })
    expect((await app.handler(post("/apps/notes/purge"))).status).toBe(404)
    expect((await app.handler(post("/apps/notes/whoAmI"))).status).toBe(200)
  })

  it.each([
    ["/api/apps/notes/missing"],
    ["/api/apps/missing/add"],
    ["/api/apps/notes/add/extra"],
    ["/api/apps/notes"],
    ["/other/notes/add"],
    ["/api/apps/notes/purge"]
  ])("returns 404 for %s", async (path) => {
    const { app } = setup()
    const response = await app.handler(post(path, { text: "Hi" }))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "There is no such action." } })
  })

  it("only accepts POST", async () => {
    const { app } = setup()
    const response = await app.handler(new Request("https://app.test/api/apps/notes/whoAmI"))
    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("POST")
  })

  it("only accepts JSON, so cross-site forms can't call actions", async () => {
    const { app } = setup()
    const form = new Request("https://app.test/api/apps/notes/add", {
      method: "POST",
      body: new URLSearchParams({ text: "Hi" })
    })
    const response = await app.handler(form)
    expect(response.status).toBe(415)
    expect(await response.json()).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } })
  })

  it("rejects bodies over the size limit", async () => {
    const memory = memoryDatabase()
    const app = createBetterApps({ database: memory.database, identity, features: [notes], maxBodySize: 16 })
    expect((await app.handler(post("/api/apps/notes/add", { text: "x".repeat(32) }))).status).toBe(413)
    const streamed = new Request("https://app.test/api/apps/notes/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ text: "x".repeat(32) })))
          controller.close()
        }
      }),
      duplex: "half"
    } as RequestInit)
    expect((await app.handler(streamed)).status).toBe(413)
  })

  it("rejects a body that isn't JSON", async () => {
    const { app } = setup()
    const request = new Request("https://app.test/api/apps/notes/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    })
    const response = await app.handler(request)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } })
  })

  it("returns schema issues", async () => {
    const { app } = setup()
    const response = await app.handler(post("/api/apps/notes/add", {}))
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "The input isn't valid.",
        issues: [{ message: "Text is required.", path: ["text"] }]
      }
    })
  })

  it.each([
    ["UNAUTHENTICATED", undefined, 401],
    ["FORBIDDEN", undefined, 403],
    ["NOT_FOUND", undefined, 404],
    ["CONFLICT", undefined, 409],
    ["LIMIT_EXCEEDED", undefined, 400],
    ["RATE_LIMITED", undefined, 429],
    ["REJECTED_BY_HOOK", undefined, 400],
    ["PAYMENT_REQUIRED", 402, 402]
  ])("returns %s with status %s as %i", async (code, status, expected) => {
    const { app } = setup()
    const response = await app.handler(post("/api/apps/notes/fail", { code, status }))
    expect(response.status).toBe(expected)
    expect(await response.json()).toEqual({ error: { code, message: `Failed with ${code}.` } })
  })

  it("hides unexpected errors and reports them", async () => {
    const { app, onError } = setup()
    const response = await app.handler(post("/api/apps/notes/crash"))
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain("secret detail")
    expect(JSON.parse(text)).toEqual({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "secret detail" }), {
      feature: "notes",
      action: "crash"
    })
  })

  it("hands an async report to waitUntil, so it isn't cut off after the response", async () => {
    const { app, onError } = setup()
    let finish = () => undefined as void
    onError.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const pending: Promise<unknown>[] = []
    const response = await app.handler(post("/api/apps/notes/crash"), {
      waitUntil: (promise) => void pending.push(promise)
    })
    expect(response.status).toBe(500)
    expect(pending).toHaveLength(1)
    finish()
    await expect(pending[0]).resolves.toBeUndefined()
    const refused = await app.handler(post("/api/apps/notes/crash"), {
      waitUntil: () => {
        throw new Error("Context ended")
      }
    })
    expect(refused.status).toBe(500)
  })

  it("logs unexpected errors with console.error by default", async () => {
    const memory = memoryDatabase()
    const app = createBetterApps({ database: memory.database, identity, features: [notes] })
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    await app.handler(post("/api/apps/notes/crash"))
    expect(log).toHaveBeenCalledWith("Better Apps (notes crash):", expect.any(Error))
    log.mockRestore()
  })
})

describe("events", () => {
  function subscriber(handle: (event: BetterAppsEvent<{ noteId: string; text: string }>) => void | Promise<void>) {
    return defineFeature({ id: "audit", on: { notes: { "note.added": handle } } })
  }

  it("writes events in the same batch as the change and delivers them once it commits", async () => {
    const received: BetterAppsEvent[] = []
    const { app, memory } = setup({ features: [subscriber((event) => void received.push(event))] })
    const note = await app.api.notes.add({ text: "Hi" }, { actor: ada, silent: true })
    expect(memory.batches[0]?.map((operation) => operation.model)).toEqual(["note", eventModel])
    expect(received).toEqual([
      {
        id: expect.any(String),
        feature: "notes",
        type: "note.added",
        data: { noteId: note.id, text: "Hi" },
        actor: ada,
        author: { type: "user", userId: "ada" },
        silent: true,
        createdAt: expect.any(Date)
      }
    ])
    expect(memory.tables.get(eventModel)).toEqual([])
  })

  it("doesn't write events nobody subscribes to", async () => {
    const { app, memory } = setup()
    await app.api.notes.add({ text: "Hi" })
    expect(memory.batches[0]?.map((operation) => operation.model)).toEqual(["note"])
  })

  it("rejects events the feature doesn't declare", async () => {
    const loose = defineFeature({
      id: "loose",
      actions: { go: defineAction({ handler: ({ emit }) => emit("undeclared", null) }) }
    })
    const { app } = setup({ features: [loose] })
    await expect(app.api.loose.go()).rejects.toThrow('The "loose" feature doesn\'t declare a "undeclared" event.')
  })

  it("writes events emitted outside a batch after the handler returns", async () => {
    const received: string[] = []
    const direct = defineFeature({
      id: "direct",
      events: { pinged: defineEvent<null>() },
      actions: { ping: defineAction({ handler: ({ emit }) => emit("pinged", null) }) }
    })
    const listener = defineFeature({
      id: "listener",
      on: { direct: { pinged: (event) => void received.push(event.type) } }
    })
    const { app } = setup({ features: [direct, listener] })
    await app.api.direct.ping()
    expect(received).toEqual(["pinged"])
  })

  it("drops events from an action that fails before writing them", async () => {
    const received: string[] = []
    const failing = defineFeature({
      id: "failing",
      events: { started: defineEvent<null>() },
      actions: {
        go: defineAction({
          handler: ({ emit }) => {
            emit("started", null)
            throw new Error("No")
          }
        })
      }
    })
    const listener = defineFeature({
      id: "listener",
      on: { failing: { started: (event) => void received.push(event.type) } }
    })
    const { app, memory } = setup({ features: [failing, listener] })
    await expect(app.api.failing.go()).rejects.toThrow("No")
    expect(received).toEqual([])
    expect(memory.tables.get(eventModel) ?? []).toEqual([])
  })

  it("delivers events whose batch committed even when the action fails afterwards", async () => {
    const received: string[] = []
    const partial = defineFeature({
      id: "partial",
      events: { saved: defineEvent<null>() },
      actions: {
        go: defineAction({
          handler: async ({ db, emit }) => {
            emit("saved", null)
            await db.batch([])
            throw new Error("Later step failed")
          }
        })
      }
    })
    const listener = defineFeature({
      id: "listener",
      on: { partial: { saved: (event) => void received.push(event.type) } }
    })
    const { app } = setup({ features: [partial, listener] })
    await expect(app.api.partial.go()).rejects.toThrow("Later step failed")
    expect(received).toEqual(["saved"])
  })

  it("rolls the events back with the batch they were written in", async () => {
    const { app, memory } = setup({ features: [subscriber(() => undefined)] })
    memory.failNextWrite()
    await expect(app.api.notes.add({ text: "Hi" })).rejects.toThrow("The write failed.")
    expect(memory.tables.get("note") ?? []).toEqual([])
    expect(memory.tables.get(eventModel) ?? []).toEqual([])
  })

  it("hands delivery to waitUntil", async () => {
    const received: string[] = []
    const { app } = setup({ features: [subscriber((event) => void received.push(event.type))] })
    const pending: Promise<unknown>[] = []
    const context = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) }
    const response = await app.handler(post("/api/apps/notes/add", { text: "Hi" }), context)
    expect(response.status).toBe(200)
    expect(pending).toHaveLength(1)
    await Promise.all(pending)
    expect(received).toEqual(["note.added"])
  })

  it("hands a failed subscriber's report to waitUntil, in requests and in delivery runs", async () => {
    const { app, onError } = setup({
      features: [
        subscriber(() => {
          throw new Error("Subscriber down")
        })
      ]
    })
    const finishes: (() => void)[] = []
    onError.mockImplementation(() => new Promise<void>((resolve) => void finishes.push(resolve)))
    const pending: Promise<unknown>[] = []
    const context = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) }
    const response = await app.handler(post("/api/apps/notes/add", { text: "Hi" }), context)
    expect(response.status).toBe(200)
    await pending[0]
    // The delivery, then the subscriber's report.
    expect(pending).toHaveLength(2)

    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + 60_000)
    const scheduled: Promise<unknown>[] = []
    expect(await app.deliverEvents({ waitUntil: (promise) => void scheduled.push(promise) })).toEqual({
      delivered: 0,
      failed: 1
    })
    expect(scheduled).toHaveLength(1)
    for (const finish of finishes) {
      finish()
    }
    await Promise.all([...pending, ...scheduled])
  })

  it("waits for delivery when waitUntil throws", async () => {
    const received: string[] = []
    const { app, onError } = setup({ features: [subscriber((event) => void received.push(event.type))] })
    const refused = new Error("The context has ended.")
    const context = {
      waitUntil: () => {
        throw refused
      }
    }
    const response = await app.handler(post("/api/apps/notes/add", { text: "Hi" }), context)
    expect(response.status).toBe(200)
    expect(received).toEqual(["note.added"])
    expect(onError).toHaveBeenCalledWith(refused, { feature: "notes" })
  })

  it.each([
    [
      "throws",
      () => {
        throw new Error("Reporter down")
      }
    ],
    ["rejects", () => Promise.reject(new Error("Reporter down"))]
  ])("keeps delivering and returns the result when onError %s", async (_, reporter) => {
    const received: string[] = []
    const { app, memory, onError } = setup({
      features: [
        subscriber((event) => {
          if (event.data.text === "Fail") {
            throw new Error("Subscriber down")
          }
          received.push(event.data.text)
        })
      ]
    })
    onError.mockImplementation(reporter)
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const context = {
      waitUntil: () => {
        throw new Error("The context has ended.")
      }
    }
    const response = await app.handler(post("/api/apps/notes/add", { text: "Fail" }), context)
    expect(response.status).toBe(200)
    expect(memory.tables.get(eventModel)).toEqual([
      expect.objectContaining({ attempts: 1, lastError: "Subscriber down" })
    ])
    await app.api.notes.add({ text: "Hi" })
    expect(received).toEqual(["Hi"])
    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith(
        "Better Apps: onError failed while reporting an error.",
        expect.objectContaining({ message: "Reporter down" })
      )
    )
    logged.mockRestore()
  })

  it("keeps a failed event, retries it after a backoff, and reports the failure", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    let fail = true
    const { app, memory, onError } = setup({
      features: [
        subscriber(() => {
          if (fail) {
            throw new Error("Subscriber down")
          }
        })
      ]
    })
    await app.api.notes.add({ text: "Hi" })
    const [stored] = memory.tables.get(eventModel) ?? []
    expect(stored).toMatchObject({
      attempts: 1,
      lastError: "Subscriber down",
      availableAt: new Date("2026-01-01T00:00:30.000Z")
    })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Subscriber down" }), {
      feature: "notes",
      event: expect.objectContaining({ type: "note.added" })
    })

    fail = false
    expect(await app.deliverEvents()).toEqual({ delivered: 0, failed: 0 })
    vi.setSystemTime(new Date("2026-01-01T00:00:31.000Z"))
    expect(await app.deliverEvents()).toEqual({ delivered: 1, failed: 0 })
    expect(memory.tables.get(eventModel)).toEqual([])
  })

  it("backs off longer after each failure, up to an hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    let now = new Date("2026-01-01T00:00:00.000Z").getTime()
    vi.setSystemTime(now)
    const { app, memory } = setup({
      features: [
        subscriber(() => {
          throw new Error("Down")
        })
      ]
    })
    await app.api.notes.add({ text: "Hi" })
    const delays: number[] = []
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const [stored] = memory.tables.get(eventModel) ?? []
      const availableAt = ((stored as Row).availableAt as Date).getTime()
      delays.push((availableAt - now) / 1000)
      now = availableAt
      vi.setSystemTime(now)
      await app.deliverEvents()
    }
    expect(delays).toEqual([30, 60, 120, 240, 480, 960, 1920, 3600, 3600])
  })

  it("delivers the events subscribers emit in the same run", async () => {
    const received: string[] = []
    const relay = defineFeature({
      id: "relay",
      events: { relayed: defineEvent<{ from: string }>() },
      on: { notes: { "note.added": (event, { emit }) => emit("relayed", { from: event.id }) } }
    })
    const sink = defineFeature({ id: "sink", on: { relay: { relayed: (event) => void received.push(event.type) } } })
    const { app } = setup({ features: [relay, sink] })
    await app.api.notes.add({ text: "Hi" })
    expect(received).toEqual(["relayed"])
  })

  it("delivers nothing when no feature subscribes", async () => {
    const { app } = setup()
    expect(await app.deliverEvents()).toEqual({ delivered: 0, failed: 0 })
  })

  it("reports an outbox it can't reach and keeps going", async () => {
    const { app, memory, onError } = setup({ features: [subscriber(() => undefined)] })
    await app.api.notes.add({ text: "Hi" })
    memory.tables
      .get(eventModel)
      ?.push({ id: "stuck", feature: "notes", type: "note.added", availableAt: new Date(0), attempts: 0 })
    memory.failNextWrite(new Error("Outbox offline"))
    expect(await app.deliverEvents()).toEqual({ delivered: 0, failed: 1 })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Outbox offline" }), {})
  })
})

describe("createBetterApps", () => {
  it.each([
    [defineFeature({ id: "has space" })],
    [defineFeature({ id: "notes2", actions: { "do/it": defineAction({ handler: () => null }) } })]
  ])("rejects names that don't fit in a URL", (feature) => {
    const memory = memoryDatabase()
    expect(() => createBetterApps({ database: memory.database, identity, features: [feature] })).toThrow(
      "must start with a letter and use only letters, digits, _ and -"
    )
  })

  it("exposes its database adapter and options", () => {
    const { app } = setup()
    expect(app.db.id).toBe("memory")
    expect(app.options.features[0]).toBe(notes)
  })
})
