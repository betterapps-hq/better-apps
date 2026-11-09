import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"
import { setup } from "../test/app.js"
import { expiredError } from "./checks.js"
import { domains, HostnameProviderError, localHostnames } from "./index.js"

const start = new Date(Date.UTC(2026, 10, 9, 9, 0))
const minutes = (count: number) => new Date(start.getTime() + count * 60_000)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(start)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("options", () => {
  it("need subdomains, custom domains or both", () => {
    expect(() => domains({})).toThrow("Set up `subdomains`, `custom` or both")
  })

  it("refuse a zone that isn't a hostname, and limits out of range", () => {
    expect(() => domains({ subdomains: { zone: "Your App.com" } })).toThrow("isn't a zone")
    expect(() => domains({ subdomains: { zone: "yourapp.com", minLength: 0 } })).toThrow("subdomains.minLength")
    expect(() => domains({ subdomains: { zone: "yourapp.com" }, maxPerOrg: 101 })).toThrow("maxPerOrg")
    expect(() => domains({ subdomains: { zone: "localhost" } })).not.toThrow()
  })

  it("subscribe to their own scheduled checks", () => {
    const feature = domains({ custom: { provider: localHostnames() } })
    expect(Object.keys(feature.on.domains)).toEqual(["check.scheduled"])
  })
})

describe("subdomains", () => {
  it("are active at once, and the first becomes primary", async () => {
    const { api, as, events, provider } = setup()
    const domain = await api.add({ kind: "subdomain", label: "  Acme " }, as("ada"))
    expect(domain).toMatchObject({
      hostname: "acme.yourapp.com",
      kind: "subdomain",
      status: "active",
      certificate: "active",
      primary: true,
      records: [],
      error: null,
      verifiedAt: start
    })
    expect(provider.hostnames.size).toBe(0)
    expect(events().map((event) => event.type)).toEqual(["domain.added", "primary.changed"])
    expect(events("primary.changed")[0]?.data).toMatchObject({ orgId: "acme", domain: { id: domain.id } })
  })

  it("are unique across organizations", async () => {
    const { api, as } = setup()
    await api.add({ kind: "subdomain", label: "acme" }, as("ada"))
    await expect(api.add({ kind: "subdomain", label: "acme" }, as("gus"))).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(api.add({ kind: "custom", hostname: "acme.yourapp.com" }, as("gus"))).rejects.toMatchObject({
      code: "INVALID_INPUT"
    })
  })

  it("follow the label rules", async () => {
    const { api, as } = setup()
    const add = (label: string) => api.add({ kind: "subdomain", label }, as("ada"))
    await expect(add("ab")).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(add("a".repeat(64))).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(add("-acme")).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(add("ac--me")).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(add("acme_co")).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(add("www")).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(add("customers")).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(add("acme-co")).resolves.toMatchObject({ hostname: "acme-co.yourapp.com" })
  })

  it("use the app's reserved labels and length", async () => {
    const { api, as } = setup({ subdomains: { zone: "yourapp.com", reserved: ["acme"], minLength: 1, maxPerOrg: 2 } })
    await expect(api.add({ kind: "subdomain", label: "acme" }, as("ada"))).rejects.toMatchObject({
      code: "INVALID_INPUT"
    })
    await expect(api.add({ kind: "subdomain", label: "a" }, as("ada"))).resolves.toBeTruthy()
    await expect(api.add({ kind: "subdomain", label: "www" }, as("ada"))).resolves.toBeTruthy()
    await expect(api.add({ kind: "subdomain", label: "bee" }, as("ada"))).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED"
    })
  })

  it("are one per organization by default", async () => {
    const { api, as } = setup()
    await api.add({ kind: "subdomain", label: "acme" }, as("ada"))
    await expect(api.add({ kind: "subdomain", label: "acme-two" }, as("ada"))).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED"
    })
  })

  it("aren't offered without a zone", async () => {
    const provider = localHostnames()
    const { api, as } = setup({ subdomains: undefined, custom: { provider }, dns: provider.dns })
    await expect(api.add({ kind: "subdomain", label: "acme" }, as("ada"))).rejects.toMatchObject({
      code: "INVALID_INPUT"
    })
    const list = await api.list(undefined, as("ada"))
    expect(list).toMatchObject({ subdomainZone: null, customDomains: true })
  })

  it("aren't checked", async () => {
    const { api, as } = setup()
    const domain = await api.add({ kind: "subdomain", label: "acme" }, as("ada"))
    await expect(api.check({ domainId: domain.id }, as("ada"))).resolves.toEqual(domain)
  })
})

describe("custom domains", () => {
  it("start pending, with the records to add", async () => {
    const { api, as, provider, scheduled } = setup({}, { verifyAfter: Infinity })
    const domain = await api.add({ kind: "custom", hostname: "HTTPS://Links.Acme.com/" }, as("ada"))
    const [registered] = [...provider.hostnames.values()]
    expect(domain).toMatchObject({
      hostname: "links.acme.com",
      kind: "custom",
      status: "pending",
      certificate: "pending",
      primary: false,
      lastCheckedAt: start,
      nextCheckAt: minutes(1),
      error: "Add a CNAME record for links.acme.com that points to customers.yourapp.com."
    })
    expect(domain.records).toEqual([
      { type: "CNAME", name: "links.acme.com", value: "customers.yourapp.com", purpose: "routing", found: false },
      {
        type: "TXT",
        name: "_cf-custom-hostname.links.acme.com",
        value: `local-token-${registered?.id}`,
        purpose: "ownership",
        found: false
      }
    ])
    expect(scheduled()).toHaveLength(1)
  })

  it("follow the hostname rules", async () => {
    const { api, as } = setup()
    const add = (hostname: string) => api.add({ kind: "custom", hostname }, as("ada"))
    await expect(add("links")).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(add("192.168.0.1")).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(add("links.acme.com/path")).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(add("links.acme.com:8080")).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(add("*.acme.com")).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(add("app.localhost")).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(add("yourapp.com")).rejects.toMatchObject({ code: "INVALID_INPUT" })
  })

  it("aren't offered without a provider", async () => {
    const { api, as } = setup({ custom: undefined })
    await expect(api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))).rejects.toMatchObject({
      code: "INVALID_INPUT"
    })
  })

  it("can't be added twice", async () => {
    const { api, as } = setup()
    await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    await expect(api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))).rejects.toMatchObject({
      code: "CONFLICT"
    })
    await expect(api.add({ kind: "custom", hostname: "links.acme.com" }, as("gus"))).rejects.toMatchObject({
      code: "CONFLICT"
    })
  })

  it("count toward the organization's limit", async () => {
    const { api, as } = setup({ maxPerOrg: 2 })
    await api.add({ kind: "custom", hostname: "a.acme.com" }, as("ada"))
    await api.add({ kind: "subdomain", label: "acme" }, as("ada"))
    await expect(api.add({ kind: "custom", hostname: "b.acme.com" }, as("ada"))).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED"
    })
    await expect(api.add({ kind: "custom", hostname: "b.globex.com" }, as("gus"))).resolves.toBeTruthy()
  })

  it("are removed again when the provider fails to add them", async () => {
    const { api, as, provider, post } = setup()
    provider.failNext("create", new HostnameProviderError("UNAVAILABLE", "Cloudflare is down."))
    await expect(api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))).rejects.toMatchObject({
      code: "PROVIDER_ERROR"
    })
    expect((await api.list(undefined, as("ada"))).domains).toEqual([])
    provider.failNext("create", new HostnameProviderError("INVALID_HOSTNAME", "That's the zone."))
    const response = await post("add", { kind: "custom", hostname: "links.acme.com" }, "ada")
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT", message: "That's the zone." } })
    provider.failNext("create", new HostnameProviderError("QUOTA_EXCEEDED", "Out of hostnames."))
    await expect(api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED"
    })
    provider.failNext("create", new HostnameProviderError("UNAVAILABLE", "Down."))
    const unavailable = await post("add", { kind: "custom", hostname: "links.acme.com" }, "ada")
    expect(unavailable.status).toBe(502)
    provider.failNext("create", new Error("Bad token"))
    const failed = await post("add", { kind: "custom", hostname: "links.acme.com" }, "ada")
    expect(failed.status).toBe(500)
  })

  it("take over a hostname another organization failed to verify", async () => {
    const { api, as, provider, events } = setup()
    const globex = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("gus"))
    provider.block("links.acme.com")
    vi.setSystemTime(minutes(1))
    await expect(api.check({ domainId: globex.id }, as("gus"))).resolves.toMatchObject({ status: "failed" })
    const acme = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    expect(acme.status).toBe("pending")
    expect(events("domain.removed").map((event) => event.data)).toEqual([
      { domain: expect.objectContaining({ id: globex.id, orgId: "globex" }) }
    ])
    expect((await api.list(undefined, as("gus"))).domains).toEqual([])
    expect([...provider.hostnames.values()].map((entry) => entry.hostname)).toEqual(["links.acme.com"])
  })
})

describe("check", () => {
  it("verifies a domain whose records are in place, and makes it primary", async () => {
    const { api, as, events, scheduled } = setup()
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    vi.setSystemTime(minutes(1))
    const checked = await api.check({ domainId: added.id }, as("ada"))
    expect(checked).toMatchObject({
      status: "active",
      certificate: "active",
      primary: true,
      error: null,
      verifiedAt: minutes(1),
      nextCheckAt: null
    })
    expect(checked.records.every((record) => record.found)).toBe(true)
    expect(events().map((event) => event.type)).toEqual([
      "domain.added",
      "domain.status.changed",
      "domain.verified",
      "primary.changed"
    ])
    expect(events("domain.status.changed")[0]?.data).toMatchObject({ from: "pending", domain: { status: "active" } })
    expect(scheduled()).toHaveLength(1)
  })

  it("can't run again within 10 seconds", async () => {
    const { api, as } = setup({}, { verifyAfter: Infinity })
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    await expect(api.check({ domainId: added.id }, as("ada"))).rejects.toMatchObject({ code: "RATE_LIMITED" })
    vi.setSystemTime(new Date(start.getTime() + 10_000))
    await expect(api.check({ domainId: added.id }, as("ada"))).resolves.toMatchObject({ status: "pending" })
  })

  it("finds a routing record that flattened DNS answers with addresses", async () => {
    const { api, as, provider } = setup({}, { verifyAfter: Infinity })
    const added = await api.add({ kind: "custom", hostname: "acme.com" }, as("ada"))
    provider.dns.publish("acme.com", "A", "192.0.2.10")
    provider.dns.publish("customers.yourapp.com", "A", "192.0.2.10")
    vi.setSystemTime(minutes(1))
    const checked = await api.check({ domainId: added.id }, as("ada"))
    expect(checked.records[0]?.found).toBe(true)
    expect(checked.error).toBe("The CNAME record is in place. Waiting for the provider to verify the domain.")
  })

  it("says when a CNAME points elsewhere, and when DNS can't be read", async () => {
    const { api, as, provider } = setup({}, { verifyAfter: Infinity })
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    provider.dns.publish("links.acme.com", "CNAME", "other.example.net.")
    vi.setSystemTime(minutes(1))
    expect((await api.check({ domainId: added.id }, as("ada"))).records[0]?.found).toBe(false)
    provider.dns.resolve = async () => {
      throw new Error("DNS is down")
    }
    vi.setSystemTime(minutes(2))
    const checked = await api.check({ domainId: added.id }, as("ada"))
    expect(checked.records[0]?.found).toBeNull()
    expect(checked.error).toBe("We couldn't look up this domain's DNS records. We'll try again soon.")
  })

  it("waits for the certificate once the hostname is verified", async () => {
    const { api, as, provider } = setup({}, { verifyAfter: Infinity })
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    provider.activate("links.acme.com")
    const entry = [...provider.hostnames.values()][0]
    ;(provider.hostnames as Map<string, typeof entry>).set(entry?.id as string, {
      ...(entry as NonNullable<typeof entry>),
      certificate: "pending"
    })
    vi.setSystemTime(minutes(1))
    expect((await api.check({ domainId: added.id }, as("ada"))).error).toBe(
      "The domain is verified. Its certificate is being issued, which can take a few minutes."
    )
  })

  it("restarts validation of a hostname that moved", async () => {
    const { api, as, provider } = setup()
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    vi.setSystemTime(minutes(1))
    await api.check({ domainId: added.id }, as("ada"))
    provider.move("links.acme.com")
    vi.setSystemTime(minutes(2))
    // The move is read, validation restarts and, on the local provider, the next read finds it ready again.
    const moved = await api.check({ domainId: added.id }, as("ada"))
    expect(moved).toMatchObject({ status: "pending", primary: true, nextCheckAt: minutes(3) })
    vi.setSystemTime(minutes(3))
    await expect(api.check({ domainId: added.id }, as("ada"))).resolves.toMatchObject({ status: "active" })
  })

  it("registers a hostname again when the provider lost it", async () => {
    const { api, as, provider } = setup({}, { verifyAfter: Infinity })
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    const [first] = [...provider.hostnames.keys()]
    await provider.remove(first as string)
    vi.setSystemTime(minutes(1))
    await api.check({ domainId: added.id }, as("ada"))
    expect([...provider.hostnames.values()].map((entry) => entry.hostname)).toEqual(["links.acme.com"])
  })

  it("fails a blocked hostname", async () => {
    const { api, as, provider, scheduled, app } = setup({}, { verifyAfter: Infinity })
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    provider.block("links.acme.com")
    vi.setSystemTime(minutes(1))
    const checked = await api.check({ domainId: added.id }, as("ada"))
    expect(checked).toMatchObject({ status: "failed", error: "The provider blocked this hostname.", nextCheckAt: null })
    await app.deliverEvents()
    expect(scheduled()).toEqual([])
  })

  it("passes on a provider that can't be reached", async () => {
    const { api, as, provider } = setup()
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    provider.failNext("get", new HostnameProviderError("UNAVAILABLE", "Down."))
    vi.setSystemTime(minutes(1))
    await expect(api.check({ domainId: added.id }, as("ada"))).rejects.toMatchObject({ code: "PROVIDER_ERROR" })
  })
})

describe("scheduled rechecks", () => {
  it("back off while a domain is pending, and stop once it's active", async () => {
    const { api, as, app, provider, scheduled } = setup({}, { verifyAfter: Infinity })
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    const list = async () => (await api.list(undefined, as("ada"))).domains[0]
    // Not due yet: the event waits for the next run.
    await app.deliverEvents()
    expect(await list()).toMatchObject({ lastCheckedAt: start, nextCheckAt: minutes(1) })
    expect(scheduled()).toHaveLength(1)
    vi.setSystemTime(minutes(1))
    await app.deliverEvents()
    expect(await list()).toMatchObject({ lastCheckedAt: minutes(1), nextCheckAt: minutes(3) })
    vi.setSystemTime(minutes(3))
    await app.deliverEvents()
    expect(await list()).toMatchObject({ lastCheckedAt: minutes(3), nextCheckAt: minutes(8) })
    provider.activate("links.acme.com")
    vi.setSystemTime(minutes(8))
    await app.deliverEvents()
    expect(await list()).toMatchObject({ status: "active", primary: true, nextCheckAt: null })
    expect(scheduled()).toEqual([])
    void added
  })

  it("fail a domain still pending after 7 days", async () => {
    const { api, as, app, scheduled } = setup({}, { verifyAfter: Infinity })
    await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    vi.setSystemTime(minutes(7 * 24 * 60))
    await app.deliverEvents()
    const [domain] = (await api.list(undefined, as("ada"))).domains
    expect(domain).toMatchObject({ status: "failed", error: expiredError, nextCheckAt: null })
    expect(scheduled()).toEqual([])
  })

  it("stop the older schedule when someone checks now", async () => {
    const { api, as, app, scheduled } = setup({}, { verifyAfter: Infinity })
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    vi.setSystemTime(minutes(1))
    await api.check({ domainId: added.id }, as("ada"))
    expect(scheduled()).toHaveLength(2)
    vi.setSystemTime(minutes(2))
    await app.deliverEvents()
    expect(scheduled()).toHaveLength(1)
  })

  it("leave a check the provider couldn't make in the outbox", async () => {
    const { api, as, app, provider } = setup({}, { verifyAfter: Infinity })
    await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    provider.failNext("get", new HostnameProviderError("UNAVAILABLE", "Down."))
    vi.setSystemTime(minutes(1))
    expect(await app.deliverEvents()).toMatchObject({ failed: 1 })
  })

  it("fail a domain the provider refuses to register again", async () => {
    const { api, as, app, provider } = setup({}, { verifyAfter: Infinity })
    await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    await provider.remove([...provider.hostnames.keys()][0] as string)
    provider.failNext("create", new HostnameProviderError("INVALID_HOSTNAME", "Not allowed."))
    vi.setSystemTime(minutes(1))
    await app.deliverEvents()
    expect((await api.list(undefined, as("ada"))).domains[0]).toMatchObject({ status: "failed", error: "Not allowed." })
  })

  it("stop for a domain that was removed", async () => {
    const { api, as, app, scheduled } = setup({}, { verifyAfter: Infinity })
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    await api.remove({ domainId: added.id }, as("ada"))
    vi.setSystemTime(minutes(1))
    await app.deliverEvents()
    expect(scheduled()).toEqual([])
  })
})

describe("remove", () => {
  it("removes the domain from the provider, and its primary place", async () => {
    const { api, as, provider, events } = setup()
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    vi.setSystemTime(minutes(1))
    await api.check({ domainId: added.id }, as("ada"))
    await expect(api.remove({ domainId: added.id }, as("ada"))).resolves.toEqual({ removed: true })
    expect(provider.hostnames.size).toBe(0)
    expect(events("primary.changed").at(-1)?.data).toEqual({ orgId: "acme", domain: null })
    await expect(api.getPrimary({ orgId: "acme" })).resolves.toBeNull()
    await expect(api.remove({ domainId: added.id }, as("ada"))).resolves.toEqual({ removed: false })
  })

  it("keeps the domain when the provider fails", async () => {
    const { api, as, provider } = setup()
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    provider.failNext("remove", new HostnameProviderError("UNAVAILABLE", "Down."))
    await expect(api.remove({ domainId: added.id }, as("ada"))).rejects.toMatchObject({ code: "PROVIDER_ERROR" })
    expect((await api.list(undefined, as("ada"))).domains).toHaveLength(1)
  })
})

describe("setPrimary", () => {
  it("moves the primary place to another active domain, or clears it", async () => {
    const { api, as, events } = setup()
    const subdomain = await api.add({ kind: "subdomain", label: "acme" }, as("ada"))
    vi.setSystemTime(minutes(0.5))
    const custom = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    await expect(api.setPrimary({ domainId: custom.id }, as("ada"))).rejects.toMatchObject({ code: "CONFLICT" })
    vi.setSystemTime(minutes(1))
    expect(await api.check({ domainId: custom.id }, as("ada"))).toMatchObject({ status: "active", primary: false })
    await expect(api.setPrimary({ domainId: custom.id }, as("ada"))).resolves.toMatchObject({
      primary: { id: custom.id, primary: true }
    })
    const { domains: listed } = await api.list(undefined, as("ada"))
    expect(listed.map((domain) => [domain.id, domain.primary])).toEqual([
      [subdomain.id, false],
      [custom.id, true]
    ])
    await expect(api.setPrimary({ domainId: custom.id }, as("ada"))).resolves.toMatchObject({
      primary: { id: custom.id }
    })
    await expect(api.getPrimary({ orgId: "acme" })).resolves.toMatchObject({ hostname: "links.acme.com" })
    await expect(api.setPrimary({ domainId: null }, as("ada"))).resolves.toEqual({ primary: null })
    await expect(api.getPrimary({ orgId: "acme" })).resolves.toBeNull()
    await expect(api.setPrimary({ domainId: null }, as("ada"))).resolves.toEqual({ primary: null })
    expect(
      events("primary.changed").map((event) => (event.data as { domain: { id: string } | null }).domain?.id)
    ).toEqual([subdomain.id, custom.id, undefined])
  })

  it("refuses another organization's domain", async () => {
    const { api, as } = setup()
    const domain = await api.add({ kind: "subdomain", label: "globex" }, as("gus"))
    await expect(api.setPrimary({ domainId: domain.id }, as("ada"))).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})

describe("lookup", () => {
  it("finds a hostname's organization, ignoring case and port", async () => {
    const { api, as } = setup()
    const domain = await api.add({ kind: "subdomain", label: "acme" }, as("ada"))
    await expect(api.lookup({ hostname: "ACME.yourapp.com:443" })).resolves.toEqual({
      domainId: domain.id,
      orgId: "acme",
      hostname: "acme.yourapp.com",
      kind: "subdomain",
      status: "active",
      verified: true,
      primary: true
    })
    await expect(api.lookup({ hostname: "nobody.yourapp.com" })).resolves.toBeNull()
    await expect(api.lookup({ hostname: "not a host" })).resolves.toBeNull()
  })

  it("reports pending custom domains as unverified", async () => {
    const { api, as } = setup()
    await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    await expect(api.lookup({ hostname: "links.acme.com." })).resolves.toMatchObject({
      verified: false,
      status: "pending"
    })
  })

  it("isn't reachable over HTTP", async () => {
    const { post } = setup()
    expect((await post("lookup", { hostname: "acme.yourapp.com" }, "ada")).status).toBe(404)
    expect((await post("getPrimary", { orgId: "acme" }, "ada")).status).toBe(404)
  })
})

describe("permissions", () => {
  it("let members list their organization's domains, and only managers change them", async () => {
    const { api, as } = setup()
    const domain = await api.add({ kind: "subdomain", label: "acme" }, as("ada"))
    await expect(api.list(undefined, as("bob"))).resolves.toMatchObject({
      domains: [{ id: domain.id }],
      canManage: false,
      subdomainZone: "yourapp.com",
      customDomains: true,
      maxPerOrg: 10
    })
    await expect(api.list(undefined, as("gus"))).resolves.toMatchObject({ domains: [], canManage: true })
    await expect(api.add({ kind: "subdomain", label: "bobs" }, as("bob"))).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(api.check({ domainId: domain.id }, as("bob"))).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(api.remove({ domainId: domain.id }, as("bob"))).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(api.check({ domainId: domain.id }, as("gus"))).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("refuse signed-out visitors and actors naming another organization", async () => {
    const { api, as, post } = setup()
    expect((await post("list", {})).status).toBe(401)
    await expect(api.list({ orgId: "globex" }, as("ada"))).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(api.list({ orgId: "acme" }, as("ada"))).resolves.toMatchObject({ domains: [] })
  })

  it("follow the app's canManage", async () => {
    const { api, as } = setup({ canManage: ({ actor }) => actor.userId === "bob" })
    await expect(api.add({ kind: "subdomain", label: "acme" }, as("ada"))).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(api.add({ kind: "subdomain", label: "acme" }, as("bob"))).resolves.toBeTruthy()
  })

  it("trust server code that names the organization", async () => {
    const { api } = setup()
    const domain = await api.add({ kind: "subdomain", label: "acme", orgId: "acme" })
    expect(domain.hostname).toBe("acme.yourapp.com")
    await expect(api.list({ orgId: "acme" })).resolves.toMatchObject({ domains: [{ id: domain.id }], canManage: true })
    await expect(api.lookup({ hostname: "acme.yourapp.com" })).resolves.toMatchObject({ orgId: "acme" })
  })

  it("keep one set of domains for an app without organizations", async () => {
    const { api } = setup()
    await api.add({ kind: "subdomain", label: "solo", orgId: null })
    await expect(api.lookup({ hostname: "solo.yourapp.com" })).resolves.toMatchObject({ orgId: null })
    await expect(api.getPrimary({ orgId: null })).resolves.toMatchObject({ hostname: "solo.yourapp.com" })
  })
})
