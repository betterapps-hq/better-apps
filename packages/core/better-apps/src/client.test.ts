import { describe, expect, expectTypeOf, it, vi } from "vitest"
import { memoryDatabase } from "../test/memory-database.js"
import { BetterAppsClientError, createBetterAppsClient, createStore, type Serialized } from "./client.js"
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
    expectTypeOf(client.notes.ping).toEqualTypeOf<(input?: unknown) => Promise<string>>()
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
