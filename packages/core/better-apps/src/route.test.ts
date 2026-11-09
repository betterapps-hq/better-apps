import { describe, expect, it, vi } from "vite-plus/test"
import { memoryDatabase } from "../test/memory-database.js"
import {
  BetterAppsError,
  createBetterApps,
  defineAction,
  defineFeature,
  defineRoute,
  type Actor,
  type BetterAppsFeature,
  type ErrorContext,
  type Identity,
  type RouteContext
} from "./index.js"

const ada: Actor = { userId: "ada", orgId: "acme", roles: [] }

const identity: Identity = {
  getActor: vi.fn<(request: Request) => Promise<Actor | null>>(async (request) =>
    request.headers.get("x-user") === "ada" ? ada : null
  ),
  getActorsFor: async () => []
}

function setup(features: BetterAppsFeature[], basePath?: string) {
  const onError = vi.fn<(error: unknown, context: ErrorContext) => void>()
  const app = createBetterApps({ database: memoryDatabase().database, identity, features, onError, basePath })
  return { app, onError }
}

const get = (path: string, init: RequestInit = {}) => new Request(`https://links.test${path}`, init)

const echo = defineRoute({
  path: "/s/:code",
  method: "GET",
  handler: async ({ params, url, getActor }) =>
    Response.json({ code: params.code, host: url.host, actor: (await getActor())?.userId ?? null })
})

describe("routes", () => {
  it("serve a feature's public paths with their decoded parameters, the URL and the actor", async () => {
    const { app } = setup([defineFeature({ id: "links", routes: { open: echo } })])
    const response = await app.handler(get("/s/caf%C3%A9", { headers: { "x-user": "ada" } }))
    expect(await response.json()).toEqual({ code: "café", host: "links.test", actor: "ada" })
  })

  it("read the actor only when the handler asks, and only once", async () => {
    const read = vi.mocked(identity.getActor)
    read.mockClear()
    const quiet = defineRoute({ path: "/ping", method: "GET", handler: () => new Response("pong") })
    const twice = defineRoute({
      path: "/who",
      method: "GET",
      handler: async ({ getActor }) => new Response(String((await getActor()) === (await getActor())))
    })
    const { app } = setup([defineFeature({ id: "links", routes: { quiet, twice } })])
    expect(await (await app.handler(get("/ping"))).text()).toBe("pong")
    expect(read).not.toHaveBeenCalled()
    expect(await (await app.handler(get("/who"))).text()).toBe("true")
    expect(read).toHaveBeenCalledTimes(1)
  })

  it("answer HEAD for GET routes without a body, and 405 with Allow for other methods", async () => {
    const page = defineRoute({ path: "/page", method: "GET", handler: () => new Response("hello") })
    const submit = defineRoute({ path: "/page", method: "POST", handler: () => new Response("sent") })
    const { app } = setup([defineFeature({ id: "site", routes: { page, submit } })])
    const head = await app.handler(get("/page", { method: "HEAD" }))
    expect(head.status).toBe(200)
    expect(await head.text()).toBe("")
    expect(await (await app.handler(get("/page", { method: "POST" }))).text()).toBe("sent")
    const refused = await app.handler(get("/page", { method: "DELETE" }))
    expect(refused.status).toBe(405)
    expect(refused.headers.get("allow")).toBe("GET, HEAD, POST")
  })

  it("prefer literal segments over parameters, whatever order features declare them in", async () => {
    const byCode = defineRoute({ path: "/s/:code", method: "GET", handler: () => new Response("code") })
    const create = defineRoute({ path: "/s/new", method: "GET", handler: () => new Response("new") })
    const { app } = setup([
      defineFeature({ id: "links", routes: { byCode } }),
      defineFeature({ id: "editor", routes: { create } })
    ])
    expect(await (await app.handler(get("/s/new"))).text()).toBe("new")
    expect(await (await app.handler(get("/s/abc"))).text()).toBe("code")
  })

  it("leave paths no route matches to the actions, which answer 404", async () => {
    const { app } = setup([defineFeature({ id: "links", routes: { open: echo } })])
    for (const path of ["/s", "/s/", "/s/a/b", "/s/%E0%A4%A", "/elsewhere"]) {
      expect((await app.handler(get(path))).status).toBe(404)
    }
  })

  it("keep work running after the response with the platform's waitUntil", async () => {
    let finish: () => void = () => undefined
    const work = new Promise<void>((resolve) => {
      finish = resolve
    })
    const track = defineRoute({
      path: "/t",
      method: "GET",
      handler: ({ waitUntil }) => {
        waitUntil(work)
        return new Response("ok")
      }
    })
    const { app } = setup([defineFeature({ id: "links", routes: { track } })])
    const kept: Promise<unknown>[] = []
    const response = await app.handler(get("/t"), { waitUntil: (promise) => kept.push(promise) })
    expect(await response.text()).toBe("ok")
    expect(kept).toHaveLength(1)
    finish()
    await Promise.all(kept)
  })

  it("wait for kept work without waitUntil, or when it throws, and report work that fails", async () => {
    const order: string[] = []
    const track = defineRoute({
      path: "/t",
      method: "GET",
      handler: ({ waitUntil }) => {
        waitUntil(
          new Promise<void>((resolve) => {
            setTimeout(() => {
              order.push("work")
              resolve()
            }, 5)
          })
        )
        waitUntil(Promise.reject(new Error("click lost")))
        return new Response("ok")
      }
    })
    const { app, onError } = setup([defineFeature({ id: "links", routes: { track } })])
    const response = await app.handler(get("/t"))
    order.push("response")
    expect(order).toEqual(["work", "response"])
    expect(response.status).toBe(200)
    expect(onError).toHaveBeenCalledWith(new Error("click lost"), { feature: "links", route: "track" })

    order.length = 0
    await app.handler(get("/t"), {
      waitUntil: () => {
        throw new Error("context ended")
      }
    })
    order.push("response")
    expect(order).toEqual(["work", "response"])
  })

  it("answer errors as actions do, and report unexpected ones", async () => {
    const gone = defineRoute({
      path: "/gone",
      method: "GET",
      handler: () => {
        throw new BetterAppsError("NOT_FOUND", "Nothing here.")
      }
    })
    const crash = defineRoute({
      path: "/crash",
      method: "GET",
      handler: () => {
        throw new Error("secret detail")
      }
    })
    const { app, onError } = setup([defineFeature({ id: "links", routes: { gone, crash } })])
    const missing = await app.handler(get("/gone"))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: { code: "NOT_FOUND", message: "Nothing here." } })
    const crashed = await app.handler(get("/crash"))
    expect(crashed.status).toBe(500)
    expect(JSON.stringify(await crashed.json())).not.toContain("secret")
    expect(onError).toHaveBeenCalledWith(new Error("secret detail"), { feature: "links", route: "crash" })
  })

  it("give handlers the app's database, identity and subjects", async () => {
    let seen: RouteContext | undefined
    const look = defineRoute({
      path: "/look",
      method: "GET",
      handler: (context) => {
        seen = context
        return new Response(null, { status: 204 })
      }
    })
    const { app } = setup([defineFeature({ id: "links", routes: { look } })])
    await app.handler(get("/look"))
    expect(seen?.db).toBe(app.db)
    expect(seen?.subjects).toBe(app.subjects)
    expect(seen?.identity).toBe(identity)
    expect(seen?.now).toBeInstanceOf(Date)
  })

  it("may sit under basePath when they can't match an action's URL, beside the actions", async () => {
    const files = defineRoute({
      path: "/api/apps/attachments/files/:fileId/:name",
      method: "GET",
      handler: ({ params }) => new Response(`${params.fileId} ${params.name}`)
    })
    const upload = defineRoute({
      path: "/api/apps/attachments/uploads/:fileId",
      method: "PUT",
      handler: ({ params }) => new Response(params.fileId, { status: 201 })
    })
    const ping = defineAction({ handler: () => "pong" })
    const { app } = setup([defineFeature({ id: "attachments", routes: { files, upload }, actions: { ping } })])
    expect(await (await app.handler(get("/api/apps/attachments/files/f-1/report.pdf"))).text()).toBe("f-1 report.pdf")
    const uploaded = await app.handler(get("/api/apps/attachments/uploads/f-2", { method: "PUT", body: "data" }))
    expect([uploaded.status, await uploaded.text()]).toEqual([201, "f-2"])
    const action = await app.handler(
      get("/api/apps/attachments/ping", { method: "POST", headers: { "content-type": "application/json" } })
    )
    expect(await action.json()).toBe("pong")
  })

  it("get the request body unread, whatever its type or size", async () => {
    let received = 0
    const upload = defineRoute({
      path: "/upload",
      method: "PUT",
      handler: async ({ request }) => {
        const reader = (request.body as ReadableStream<Uint8Array>).getReader()
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
          received += chunk.value.byteLength
        }
        return new Response(null, { status: 204 })
      }
    })
    const onError = vi.fn<(error: unknown, context: ErrorContext) => void>()
    const app = createBetterApps({
      database: memoryDatabase().database,
      identity,
      features: [defineFeature({ id: "files", routes: { upload } })],
      maxBodySize: 10,
      onError
    })
    const body = new Uint8Array(64 * 1024)
    const response = await app.handler(
      get("/upload", { method: "PUT", headers: { "content-type": "application/octet-stream" }, body })
    )
    expect(response.status).toBe(204)
    expect(received).toBe(body.byteLength)
  })

  it("send the handler's response as it is: streamed bodies, partial and unchanged statuses, and headers", async () => {
    const cancelled = vi.fn<() => void>()
    const stream = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("par"))
          controller.enqueue(new TextEncoder().encode("tial"))
        },
        pull(controller) {
          controller.close()
        },
        cancel: cancelled
      })
    const range = defineRoute({
      path: "/range",
      method: "GET",
      handler: () =>
        new Response(stream(), { status: 206, headers: { "content-range": "bytes 0-6/100", "x-file": "f-1" } })
    })
    const fresh = defineRoute({
      path: "/fresh",
      method: "GET",
      handler: () => new Response(null, { status: 304, headers: { etag: '"v1"' } })
    })
    const { app } = setup([defineFeature({ id: "files", routes: { range, fresh } })])
    const partial = await app.handler(get("/range"))
    expect(partial.status).toBe(206)
    expect(partial.headers.get("content-range")).toBe("bytes 0-6/100")
    expect(partial.headers.get("x-file")).toBe("f-1")
    expect(await partial.text()).toBe("partial")
    const head = await app.handler(get("/range", { method: "HEAD" }))
    expect([head.status, head.headers.get("x-file"), await head.text()]).toEqual([206, "f-1", ""])
    // A HEAD request closes the handler's stream rather than leaving it open.
    expect(cancelled).toHaveBeenCalledTimes(1)
    const unchanged = await app.handler(get("/fresh"))
    expect([unchanged.status, unchanged.headers.get("etag")]).toEqual([304, '"v1"'])
  })

  it("refuse paths that can't be matched, could match an action's URL, or repeat another route", () => {
    const route = (path: string) => defineRoute({ path, method: "GET", handler: () => new Response() })
    const app = (path: string, basePath?: string) =>
      setup([defineFeature({ id: "links", routes: { open: route(path) } })], basePath)
    expect(() => app("s/:code")).toThrow("must start with /")
    expect(() => app("/")).toThrow("must start with /")
    expect(() => app("/s//x")).toThrow("empty or unescaped segment")
    expect(() => app("/s/:")).toThrow("isn't a valid, unique name")
    expect(() => app("/s/:a/:a")).toThrow("isn't a valid, unique name")
    expect(() => app("/api/apps/:feature")).not.toThrow()
    expect(() => app("/api/:x/:feature/:action")).toThrow("could match an action's URL")
    expect(() => app("/x/y", "/")).toThrow('under the app\'s base path, "/"')
    expect(() =>
      setup([
        defineFeature({ id: "links", routes: { open: route("/s/:code") } }),
        defineFeature({ id: "other", routes: { show: route("/s/:id") } })
      ])
    ).toThrow('The "other" route "show" has the same method and path as the "links" route "open".')
  })
})
