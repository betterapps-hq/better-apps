import { describe, expect, expectTypeOf, it, vi } from "vite-plus/test"
import { memoryDatabase } from "../test/memory-database.js"
import {
  BetterAppsClientError,
  createBetterAppsClient,
  createStore,
  type CallOptions,
  type JsonValue,
  type Serialized
} from "./client.js"
import {
  BetterAppsError,
  createBetterApps,
  defineAction,
  defineFeature,
  localIdentity,
  type StandardSchemaV1
} from "./index.js"

const text: StandardSchemaV1<{ text: string }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) =>
      typeof (value as { text?: unknown } | null)?.text === "string"
        ? { value: value as { text: string } }
        : { issues: [{ message: "Text is required.", path: [{ key: "text" }] }] }
  }
}

const notes = defineFeature({
  id: "notes",
  actions: {
    echo: defineAction({
      input: text,
      handler: ({ input, actor, now }) => ({ text: input.text, by: actor?.userId ?? null, at: now, tags: [now] })
    }),
    ping: defineAction({ handler: () => "pong" }),
    refuse: defineAction({
      handler: () => {
        throw new BetterAppsError("FORBIDDEN", "Not yours.")
      }
    }),
    purge: defineAction({ serverOnly: true, handler: () => "purged" })
  }
})

function setup() {
  const app = createBetterApps({ database: memoryDatabase().database, identity: localIdentity(), features: [notes] })
  const requests: Request[] = []
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url, init) => {
    const request = new Request(url, init)
    requests.push(request.clone())
    return app.handler(request)
  })
  return { app, requests, fetch }
}

describe("createBetterAppsClient", () => {
  it("calls actions through app.handler, typed from the server's features", async () => {
    const { app, fetch, requests } = setup()
    const client = createBetterAppsClient<typeof app>({ baseURL: "https://app.test/", fetch })
    const echoed = await client.notes.echo({ text: "Hi" })
    expect(echoed).toEqual({ text: "Hi", by: "local", at: expect.any(String), tags: [expect.any(String)] })
    expect(await client.notes.ping()).toBe("pong")
    expect(requests[0]?.url).toBe("https://app.test/api/apps/notes/echo")
    expect(requests[0]?.headers.get("content-type")).toBe("application/json")
    expect(await requests[1]?.text()).toBe("")
    expect(await client.$call("notes", "ping")).toBe("pong")
    expectTypeOf(echoed).toEqualTypeOf<{ text: string; by: string | null; at: string; tags: string[] }>()
    expectTypeOf(client.notes).not.toHaveProperty("purge")
    expectTypeOf(client.notes.ping).toEqualTypeOf<(input?: unknown, options?: CallOptions) => Promise<string>>()
  })

  it("throws the server's code, status and issues", async () => {
    const { app, fetch } = setup()
    const client = createBetterAppsClient<typeof app>({ baseURL: "https://app.test", fetch })
    await expect(client.notes.refuse()).rejects.toMatchObject({ code: "FORBIDDEN", status: 403, message: "Not yours." })
    const invalid = await client.notes.echo({ text: 5 } as never).catch((error: unknown) => error)
    expect(invalid).toBeInstanceOf(BetterAppsClientError)
    expect(invalid).toMatchObject({ code: "INVALID_INPUT", issues: [{ message: "Text is required.", path: ["text"] }] })
    const hidden = client as unknown as { notes: { purge(): Promise<unknown> } }
    await expect(hidden.notes.purge()).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 })
  })

  it("reports network failures and answers that aren't JSON", async () => {
    const down = createBetterAppsClient({ fetch: () => Promise.reject(new TypeError("offline")) })
    await expect(down.$call("notes", "ping")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 })
    const html = (status: number) => () => Promise.resolve(new Response("<html>", { status }))
    await expect(createBetterAppsClient({ fetch: html(502) }).$call("a", "b")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      status: 502,
      message: "The server answered 502."
    })
    await expect(createBetterAppsClient({ fetch: html(200) }).$call("a", "b")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "The server's answer isn't JSON."
    })
    const empty = createBetterAppsClient({ fetch: () => Promise.resolve(new Response(null, { status: 204 })) })
    expect(await empty.$call("a", "b")).toBeNull()
  })

  it("sends headers and cookies as configured, to the configured path", async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const fetch = (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return Promise.resolve(Response.json(null))
    }
    const client = createBetterAppsClient({
      basePath: "/rpc/",
      fetch,
      headers: async () => ({ authorization: "Bearer t" }),
      credentials: "include"
    })
    await client.$call("feature one", "do/it", { a: 1 })
    expect(seen[0]?.url).toBe("/rpc/feature%20one/do%2Fit")
    expect(new Headers(seen[0]?.init.headers).get("authorization")).toBe("Bearer t")
    expect(seen[0]?.init).toMatchObject({ method: "POST", credentials: "include", body: '{"a":1}' })
    await createBetterAppsClient({ basePath: "/", fetch, headers: { "x-a": "b" } }).$call("f", "a")
    expect(seen[1]?.url).toBe("/f/a")
    expect(seen[1]?.init.credentials).toBe("same-origin")
  })

  it("never sends a call cancelled while its headers resolve", async () => {
    const { app, fetch } = setup()
    let token = (_value: string) => undefined as void
    const client = createBetterAppsClient<typeof app>({
      fetch,
      headers: () =>
        new Promise<Record<string, string>>((resolve) => (token = (value) => resolve({ authorization: value })))
    })
    const controller = new AbortController()
    const calling = client.notes.echo({ text: "Hi" }, { signal: controller.signal })
    controller.abort(new Error("Signed out"))
    token("Bearer next-person")
    const error = await calling.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BetterAppsClientError)
    expect(error).toMatchObject({ code: "ABORTED", status: 0, cause: { message: "Signed out" } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("stops waiting on headers that never resolve once the call is cancelled", async () => {
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(Response.json(null))
    )
    const client = createBetterAppsClient({
      fetch,
      headers: () => new Promise<Record<string, string>>(() => undefined)
    })
    const controller = new AbortController()
    const calling = client.$call("notes", "ping", undefined, { signal: controller.signal })
    controller.abort()
    await expect(calling).rejects.toMatchObject({ code: "ABORTED" })
    const already = client.$call("notes", "ping", undefined, { signal: controller.signal })
    await expect(already).rejects.toMatchObject({ code: "ABORTED" })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects with ABORTED when headers fail after a cancel, and with their own error otherwise", async () => {
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(Response.json(null))
    )
    let fail = (_error: Error) => undefined as void
    const client = createBetterAppsClient({
      fetch,
      headers: () => new Promise<Record<string, string>>((_, reject) => (fail = reject))
    })
    const controller = new AbortController()
    const cancelled = client.$call("notes", "ping", undefined, { signal: controller.signal })
    controller.abort()
    fail(new Error("Refresh cut short"))
    await expect(cancelled).rejects.toMatchObject({ code: "ABORTED" })
    const failing = client.$call("notes", "ping")
    fail(new Error("Refresh failed"))
    await expect(failing).rejects.toThrow("Refresh failed")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("stops waiting on a fetch or a body that never finishes once the call is cancelled", async () => {
    const controller = new AbortController()
    const never = createBetterAppsClient({ fetch: () => new Promise<Response>(() => undefined) })
    const waiting = never.$call("notes", "ping", undefined, { signal: controller.signal })
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ code: "ABORTED" })

    const later = new AbortController()
    const stalled = createBetterAppsClient({
      fetch: () => Promise.resolve(new Response(new ReadableStream({ pull: () => new Promise<void>(() => undefined) })))
    })
    const reading = stalled.$call("notes", "ping", undefined, { signal: later.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    later.abort()
    await expect(reading).rejects.toMatchObject({ code: "ABORTED" })
  })

  it("handles a fetch that rejects after cancelling its own call", async () => {
    const controller = new AbortController()
    const client = createBetterAppsClient({
      fetch: () => {
        controller.abort()
        return Promise.reject(new TypeError("Aborted by the fetch"))
      }
    })
    await expect(client.$call("notes", "ping", undefined, { signal: controller.signal })).rejects.toMatchObject({
      code: "ABORTED"
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it("rejects a call cancelled under way, whether or not its fetch stops", async () => {
    const controller = new AbortController()
    const stops = createBetterAppsClient({
      fetch: (_, init) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))
    })
    const stopped = stops.$call("notes", "ping", undefined, { signal: controller.signal })
    controller.abort()
    await expect(stopped).rejects.toMatchObject({ code: "ABORTED" })

    const { fetch } = setup()
    const later = new AbortController()
    const ignores = createBetterAppsClient({
      baseURL: "https://app.test",
      fetch: async (url, init) => {
        later.abort()
        return fetch(url, init)
      }
    })
    await expect(ignores.$call("notes", "ping", undefined, { signal: later.signal })).rejects.toMatchObject({
      code: "ABORTED"
    })
    expect(await ignores.$call("notes", "ping")).toBe("pong")
  })

  it("isn't mistaken for a promise or a React element", async () => {
    const client = createBetterAppsClient({ fetch: () => Promise.resolve(Response.json(null)) })
    const record = client as unknown as Record<string | symbol, unknown>
    expect(record.then).toBeUndefined()
    expect(record.$$typeof).toBeUndefined()
    expect(record[Symbol.toPrimitive]).toBeUndefined()
    expect(await Promise.resolve(client)).toBe(client)
    const feature = record.notes as Record<string | symbol, unknown>
    expect(record.notes).toBe(feature)
    expect(feature.then).toBeUndefined()
    expect(feature[Symbol.iterator]).toBeUndefined()
  })
})

describe("Serialized", () => {
  it("turns dates into strings and drops functions", () => {
    expectTypeOf<
      Serialized<{ at: Date; list: readonly Date[]; nested: { at: Date | null }; run(): void }>
    >().toEqualTypeOf<{
      at: string
      list: string[]
      nested: { at: string | null }
      run: never
    }>()
  })

  it("types unknown values as JSON", () => {
    expectTypeOf<Serialized<{ body: unknown; meta: Record<string, unknown> | null }>>().toEqualTypeOf<{
      body: JsonValue
      meta: { [key: string]: JsonValue } | null
    }>()
  })
})

describe("createStore", () => {
  it("notifies subscribers of each change until they unsubscribe", () => {
    const store = createStore({ count: 0 })
    const listener = vi.fn<() => void>()
    const stop = store.subscribe(listener)
    store.setState((state) => ({ count: state.count + 1 }))
    expect(store.getSnapshot()).toEqual({ count: 1 })
    const same = store.getSnapshot()
    store.setState(same)
    store.setState((state) => state)
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
    store.setState({ count: 5 })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual({ count: 5 })
  })
})
