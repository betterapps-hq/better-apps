import { HostnameProviderError } from "@better-apps/domains"
import Cloudflare from "cloudflare"
import { describe, expect, it } from "vite-plus/test"
import { cloudflareHostnames } from "./index.js"

type Hostname = {
  id: string
  hostname: string
  status: string
  ssl: {
    method: string
    type: string
    status: string
    validation_records?: { txt_name?: string; txt_value?: string; http_url?: string }[]
    validation_errors?: { message?: string }[]
  }
  ownership_verification?: { type: "txt"; name: string; value: string }
  verification_errors?: string[]
}

const envelope = (result: unknown, status = 200, errors: { code: number; message: string }[] = []) =>
  Response.json({ success: errors.length === 0, errors, messages: [], result }, { status })

/**
 * A fake of the custom hostnames endpoints the adapter calls, behind the real SDK's `fetch`, so tests exercise the SDK's
 * requests and errors without reaching Cloudflare.
 */
function fakeCloudflare() {
  const hostnames = new Map<string, Hostname>()
  const requests: { method: string; path: string; body: unknown }[] = []
  let failNext: Response | null = null
  let nextId = 1
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = init?.method ?? "GET"
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    const path = url.pathname.replace("/client/v4", "")
    requests.push({ method, path, body })
    if (failNext) {
      const response = failNext
      failNext = null
      return response
    }
    const match = /^\/zones\/zone-1\/custom_hostnames(?:\/([^/]+))?$/.exec(path)
    if (!match) {
      return envelope(null, 404, [{ code: 7003, message: "No route" }])
    }
    const id = match[1]
    if (!id && method === "POST") {
      const name = String(body?.hostname)
      if ([...hostnames.values()].some((entry) => entry.hostname === name)) {
        return envelope(null, 409, [{ code: 1406, message: "Duplicate custom hostname found." }])
      }
      const created: Hostname = {
        id: `ch-${nextId++}`,
        hostname: name,
        status: "pending",
        ssl: { ...(body?.ssl as { method: string; type: string }), status: "initializing" },
        ownership_verification: { type: "txt", name: `_cf-custom-hostname.${name}`, value: "owner-token" },
        verification_errors: ["custom hostname does not CNAME to this zone."]
      }
      hostnames.set(created.id, created)
      return envelope(created)
    }
    if (!id && method === "GET") {
      const exact = url.searchParams.get("hostname.exact")
      const result = [...hostnames.values()].filter((entry) => entry.hostname === exact)
      return Response.json({
        success: true,
        errors: [],
        messages: [],
        result,
        result_info: { page: 1, per_page: 20, count: result.length, total_count: result.length }
      })
    }
    const existing = id ? hostnames.get(id) : undefined
    if (!existing) {
      return envelope(null, 404, [{ code: 1436, message: "The custom hostname was not found." }])
    }
    if (method === "GET") {
      return envelope(existing)
    }
    if (method === "PATCH") {
      const edited = { ...existing, status: "pending", ssl: { ...existing.ssl, status: "pending_validation" } }
      hostnames.set(existing.id, edited)
      return envelope(edited)
    }
    hostnames.delete(existing.id)
    return envelope({ id: existing.id })
  }) as typeof globalThis.fetch
  const client = new Cloudflare({ apiToken: "test-token", fetch, maxRetries: 0 })
  const provider = cloudflareHostnames({ client, zoneId: "zone-1", target: "customers.yourapp.com" })
  return {
    hostnames,
    requests,
    provider,
    fetch,
    fail: (response: Response) => {
      failNext = response
    }
  }
}

describe("cloudflareHostnames", () => {
  it("creates a custom hostname with HTTP validation, and lists the records to add", async () => {
    const { provider, requests } = fakeCloudflare()
    const created = await provider.create("links.acme.com")
    expect(requests[0]).toEqual({
      method: "POST",
      path: "/zones/zone-1/custom_hostnames",
      body: { hostname: "links.acme.com", ssl: { method: "http", type: "dv" } }
    })
    expect(created).toEqual({
      id: "ch-1",
      hostname: "links.acme.com",
      status: "pending",
      certificate: "pending",
      records: [
        { type: "CNAME", name: "links.acme.com", value: "customers.yourapp.com", purpose: "routing" },
        { type: "TXT", name: "_cf-custom-hostname.links.acme.com", value: "owner-token", purpose: "ownership" }
      ],
      errors: ["custom hostname does not CNAME to this zone."]
    })
  })

  it("returns the hostname Cloudflare already has", async () => {
    const { provider } = fakeCloudflare()
    const first = await provider.create("links.acme.com")
    await expect(provider.create("links.acme.com")).resolves.toEqual(first)
  })

  it("lists certificate TXT records until the certificate is active", async () => {
    const { provider, hostnames } = fakeCloudflare()
    const { id } = await provider.create("links.acme.com")
    const entry = hostnames.get(id) as Hostname
    hostnames.set(id, {
      ...entry,
      status: "active",
      ssl: {
        ...entry.ssl,
        status: "pending_validation",
        validation_records: [{ txt_name: "_acme-challenge.links.acme.com", txt_value: "dcv" }, { http_url: "x" }],
        validation_errors: [{ message: "CAA record prevents issuance." }, {}]
      },
      verification_errors: []
    })
    await expect(provider.get(id)).resolves.toMatchObject({
      status: "active",
      certificate: "pending",
      records: [
        { purpose: "routing" },
        { type: "TXT", name: "_acme-challenge.links.acme.com", value: "dcv", purpose: "certificate" }
      ],
      errors: ["CAA record prevents issuance."]
    })
    hostnames.set(id, { ...entry, status: "active_redeploying", ssl: { ...entry.ssl, status: "active" } })
    await expect(provider.get(id)).resolves.toMatchObject({
      status: "active",
      certificate: "active",
      records: [{ purpose: "routing" }]
    })
  })

  it("reads Cloudflare's statuses", async () => {
    const { provider, hostnames } = fakeCloudflare()
    const { id } = await provider.create("links.acme.com")
    const entry = hostnames.get(id) as Hostname
    const read = async (status: string, certificate: string) => {
      hostnames.set(id, { ...entry, status, ssl: { ...entry.ssl, status: certificate } })
      const hostname = await provider.get(id)
      return [hostname?.status, hostname?.certificate]
    }
    expect(await read("moved", "validation_timed_out")).toEqual(["moved", "failed"])
    expect(await read("pending_blocked", "pending_expiration")).toEqual(["blocked", "active"])
    expect(await read("pending_migration", "pending_issuance")).toEqual(["pending", "pending"])
  })

  it("restarts validation with the same certificate settings", async () => {
    const { provider, requests } = fakeCloudflare()
    const { id } = await provider.create("links.acme.com")
    await provider.refresh(id)
    expect(requests.at(-1)).toEqual({
      method: "PATCH",
      path: `/zones/zone-1/custom_hostnames/${id}`,
      body: { ssl: { method: "http", type: "dv" } }
    })
  })

  it("treats a hostname Cloudflare doesn't have as gone", async () => {
    const { provider, hostnames } = fakeCloudflare()
    await expect(provider.get("missing")).resolves.toBeNull()
    const { id } = await provider.create("links.acme.com")
    await provider.remove(id)
    expect(hostnames.size).toBe(0)
    await expect(provider.remove(id)).resolves.toBeUndefined()
  })

  it("validates certificates by TXT when asked", async () => {
    const { fetch, requests } = fakeCloudflare()
    const client = new Cloudflare({ apiToken: "test-token", fetch, maxRetries: 0 })
    const provider = cloudflareHostnames({
      client,
      zoneId: "zone-1",
      target: "customers.yourapp.com",
      certificateValidation: "txt"
    })
    await provider.create("links.acme.com")
    expect(requests[0]?.body).toMatchObject({ ssl: { method: "txt", type: "dv" } })
  })

  it("reports what a person can act on as provider errors", async () => {
    const { provider, fail } = fakeCloudflare()
    const expectError = async (response: Response, code: string, message?: string) => {
      fail(response)
      const error = await provider.create("links.acme.com").catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(HostnameProviderError)
      expect(error).toMatchObject({ code, ...(message ? { message } : {}) })
    }
    await expectError(envelope(null, 429, [{ code: 10_000, message: "Rate limited" }]), "UNAVAILABLE")
    await expectError(envelope(null, 503, [{ code: 1500, message: "Internal" }]), "UNAVAILABLE")
    await expectError(envelope(null, 403, [{ code: 1405, message: "Quota exceeded." }]), "QUOTA_EXCEEDED")
    await expectError(
      envelope(null, 400, [{ code: 1411, message: "Hostname is not allowed." }]),
      "INVALID_HOSTNAME",
      "Hostname is not allowed."
    )
  })

  it("throws other errors as they are, for the app's operators", async () => {
    const { provider, fail } = fakeCloudflare()
    fail(envelope(null, 403, [{ code: 10_000, message: "Authentication error" }]))
    const error = await provider.get("ch-1").catch((caught: unknown) => caught)
    expect(error).not.toBeInstanceOf(HostnameProviderError)
    expect(error).toMatchObject({ status: 403 })
    fail(envelope(null, 401, [{ code: 10_000, message: "Authentication error" }]))
    await expect(provider.remove("ch-1")).rejects.toMatchObject({ status: 401 })
    fail(envelope(null, 401, [{ code: 10_000, message: "Authentication error" }]))
    await expect(provider.refresh("ch-1")).rejects.toMatchObject({ status: 401 })
  })

  it("reports a connection failure as unavailable", async () => {
    const client = new Cloudflare({
      apiToken: "test-token",
      maxRetries: 0,
      fetch: (async () => {
        throw new TypeError("fetch failed")
      }) as typeof fetch
    })
    const provider = cloudflareHostnames({ client, zoneId: "zone-1", target: "customers.yourapp.com" })
    await expect(provider.get("ch-1")).rejects.toMatchObject({ code: "UNAVAILABLE" })
  })

  it("makes its own client from an API token", () => {
    expect(() =>
      cloudflareHostnames({ apiToken: "token", zoneId: "zone-1", target: "customers.yourapp.com" })
    ).not.toThrow()
  })
})
