import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"
import { setup, type UserId } from "../test/app.js"
import { evictedError, expiredError, lookupError } from "./checks.js"
import {
  checkWindowMs,
  domains,
  HostnameProviderError,
  localHostnames,
  recheckMs,
  type Domain,
  type HostnameProvider
} from "./index.js"

const start = new Date(Date.UTC(2026, 10, 9, 9, 0))
const minutes = (count: number) => new Date(start.getTime() + count * 60_000)
const later = (from: Date, ms: number) => new Date(from.getTime() + ms)

/** Moves the clock on, past the cooldown between checks of one domain. */
const advance = (seconds = 10) => vi.setSystemTime(new Date(Date.now() + seconds * 1000))

type App = ReturnType<typeof setup>

const proveError = (hostname: string) => `Add the TXT record for _verify.${hostname} to prove you own the domain.`
const cnameError = (hostname: string) => `Add a CNAME record for ${hostname} that points to customers.yourapp.com.`
const waiting = "The records are in place. Waiting for the provider to verify the domain."

/** Adds a custom domain, adds its records, and checks it until it's ready. */
async function addReady(t: App, userId: UserId, hostname: string): Promise<Domain> {
  const added = await t.api.add({ kind: "custom", hostname }, t.as(userId))
  t.prove(added)
  t.route(hostname)
  await expect(t.api.check({ domainId: added.id }, t.as(userId))).resolves.toMatchObject({ error: waiting })
  advance()
  const ready = await t.api.check({ domainId: added.id }, t.as(userId))
  expect(ready.status).toBe("active")
  return ready
}

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

  it("refuse a zone that isn't a hostname, limits out of range and an ownership label that isn't one", () => {
    expect(() => domains({ subdomains: { zone: "Your App.com" } })).toThrow("isn't a zone")
    expect(() => domains({ subdomains: { zone: "yourapp.com", minLength: 0 } })).toThrow("subdomains.minLength")
    expect(() => domains({ subdomains: { zone: "yourapp.com" }, maxPerOrg: 101 })).toThrow("maxPerOrg")
    expect(() => domains({ subdomains: { zone: "localhost" } })).not.toThrow()
    expect(() => domains({ custom: { provider: localHostnames(), ownershipLabel: "verify" } })).toThrow(
      "isn't a label for the ownership record"
    )
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

  it("go to one organization when two add the same label at once", async () => {
    const { api, as } = setup()
    const results = await Promise.allSettled([
      api.add({ kind: "subdomain", label: "acme" }, as("ada")),
      api.add({ kind: "subdomain", label: "acme" }, as("gus"))
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } })
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
    const { api, as } = setup({ subdomains: undefined })
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
  it("start pending, asking the organization to prove it owns them first", async () => {
    const { api, as, provider, scheduled } = setup()
    const domain = await api.add({ kind: "custom", hostname: "HTTPS://Links.Acme.com/" }, as("ada"))
    expect(domain).toMatchObject({
      hostname: "links.acme.com",
      kind: "custom",
      status: "pending",
      certificate: "pending",
      primary: false,
      lastCheckedAt: null,
      nextCheckAt: minutes(1),
      error: proveError("links.acme.com")
    })
    expect(domain.records).toEqual([
      { type: "CNAME", name: "links.acme.com", value: "customers.yourapp.com", purpose: "routing", found: null },
      {
        type: "TXT",
        name: "_verify.links.acme.com",
        value: expect.stringMatching(/^[0-9a-f]{32}$/),
        purpose: "ownership",
        found: null
      }
    ])
    // Nothing reaches the provider until the organization proves it owns the hostname.
    expect(provider.hostnames.size).toBe(0)
    expect(scheduled()).toEqual([{ domainId: domain.id, token: expect.any(String), dueAt: minutes(1).toISOString() }])
    await expect(api.lookup({ hostname: "links.acme.com" })).resolves.toBeNull()
  })

  it("name the ownership record after the app", async () => {
    const provider = localHostnames({ target: "customers.yourapp.com" })
    const { api, as } = setup({ custom: { provider, ownershipLabel: "_acme-verify" }, dns: provider.dns })
    const domain = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    expect(domain.records[1]?.name).toBe("_acme-verify.links.acme.com")
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

  it("can't be in the provider's own zone", async () => {
    const { api, as } = setup({ subdomains: undefined })
    const add = (hostname: string) => api.add({ kind: "custom", hostname }, as("ada"))
    await expect(add("customers.yourapp.com")).rejects.toMatchObject({ message: "That's this app's own domain." })
    await expect(add("yourapp.com")).rejects.toMatchObject({ message: "That's this app's own domain." })
    await expect(add("links.acme.com")).resolves.toMatchObject({ status: "pending" })
  })

  it("aren't offered without a provider", async () => {
    const { api, as } = setup({ custom: undefined })
    await expect(api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))).rejects.toMatchObject({
      code: "INVALID_INPUT"
    })
  })

  it("can be added by several organizations, but once by each", async () => {
    const { api, as } = setup()
    await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    await expect(api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Your organization already added that domain."
    })
    await expect(api.add({ kind: "custom", hostname: "links.acme.com" }, as("gus"))).resolves.toMatchObject({
      status: "pending"
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
})

describe("ownership", () => {
  it("gives the hostname to the organization that proves it owns it, and registers it then", async () => {
    const t = setup()
    const { api, as, provider } = t
    const squatter = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("gus"))
    const owner = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    t.prove(owner)
    const proven = await api.check({ domainId: owner.id }, as("ada"))
    expect(proven).toMatchObject({ status: "pending", error: cnameError("links.acme.com") })
    expect(proven.records).toEqual([
      { type: "CNAME", name: "links.acme.com", value: "customers.yourapp.com", purpose: "routing", found: false },
      {
        type: "TXT",
        name: "_local-hostname.links.acme.com",
        value: "token-links.acme.com",
        purpose: "prevalidation",
        found: false
      }
    ])
    expect(provider.hostnames.size).toBe(1)
    await expect(api.lookup({ hostname: "links.acme.com" })).resolves.toMatchObject({ orgId: "acme", verified: false })
    // The other organization finds no record of its own, so it gets nothing.
    await expect(api.check({ domainId: squatter.id }, as("gus"))).resolves.toMatchObject({
      status: "pending",
      error: proveError("links.acme.com")
    })
    await expect(api.lookup({ hostname: "links.acme.com" })).resolves.toMatchObject({ orgId: "acme" })
  })

  it("becomes ready once traffic reaches the provider", async () => {
    const t = setup()
    const domain = await addReady(t, "ada", "links.acme.com")
    expect(domain).toMatchObject({
      status: "active",
      certificate: "active",
      primary: true,
      error: null,
      verifiedAt: later(start, 10_000),
      nextCheckAt: later(start, 10_000 + recheckMs)
    })
    expect(domain.records.map((record) => [record.purpose, record.found])).toEqual([
      ["routing", true],
      ["prevalidation", false]
    ])
    expect(t.events().map((event) => event.type)).toEqual([
      "domain.added",
      "domain.status.changed",
      "domain.verified",
      "primary.changed"
    ])
    expect(t.events("domain.status.changed")[0]?.data).toMatchObject({ from: "pending", domain: { status: "active" } })
    await expect(t.api.lookup({ hostname: "links.acme.com" })).resolves.toMatchObject({ verified: true })
  })

  it("isn't proven by a CNAME another organization left behind", async () => {
    const t = setup()
    const { api, as, provider } = t
    const first = await addReady(t, "ada", "links.acme.com")
    await api.remove({ domainId: first.id }, as("ada"))
    provider.dns.unpublish("_verify.links.acme.com", "TXT")
    const taker = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("gus"))
    const checked = await api.check({ domainId: taker.id }, as("gus"))
    expect(checked).toMatchObject({ status: "pending", error: proveError("links.acme.com") })
    expect(checked.records.map((record) => record.found)).toEqual([true, false])
    expect(provider.hostnames.size).toBe(0)
    await expect(api.lookup({ hostname: "links.acme.com" })).resolves.toBeNull()
  })

  it("passes to an organization that proves it owns a hostname its holder no longer does", async () => {
    const t = setup()
    const { api, as, provider, events } = t
    const old = await addReady(t, "ada", "links.acme.com")
    const [registered] = [...provider.hostnames.keys()]
    // The domain changed hands, and Acme's record went with it.
    provider.dns.unpublish("_verify.links.acme.com", "TXT")
    const taker = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("gus"))
    t.prove(taker)
    await expect(api.check({ domainId: taker.id }, as("gus"))).resolves.toMatchObject({
      status: "active",
      primary: true
    })
    expect([...provider.hostnames.keys()]).toEqual([registered])
    const [acme] = (await api.list(undefined, as("ada"))).domains
    expect(acme).toMatchObject({ status: "failed", primary: false, error: evictedError, nextCheckAt: null })
    expect(acme?.records.map((record) => record.purpose)).toEqual(["routing", "ownership"])
    await expect(api.lookup({ hostname: "links.acme.com" })).resolves.toMatchObject({
      orgId: "globex",
      verified: true
    })
    await expect(api.getPrimary({ orgId: "acme" })).resolves.toBeNull()
    expect(events("domain.status.changed").map((event) => event.data)).toContainEqual({
      domain: expect.objectContaining({ id: old.id, status: "failed" }),
      from: "active"
    })
    expect(events("primary.changed").map((event) => event.data)).toContainEqual({ orgId: "acme", domain: null })
    // The provider's hostname is the new holder's, so removing the old domain leaves it.
    await api.remove({ domainId: old.id }, as("ada"))
    expect(provider.hostnames.size).toBe(1)
  })

  it("stays with its holder while the holder's own record is in place", async () => {
    const t = setup()
    const { api, as } = t
    await addReady(t, "ada", "links.acme.com")
    const rival = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("gus"))
    t.prove(rival)
    const checked = await api.check({ domainId: rival.id }, as("gus"))
    expect(checked).toMatchObject({
      status: "pending",
      error:
        "Another organization's TXT record for _verify.links.acme.com is still in place. Remove it, then check again."
    })
    expect(checked.records.at(-1)?.found).toBe(true)
    await expect(api.lookup({ hostname: "links.acme.com" })).resolves.toMatchObject({ orgId: "acme", verified: true })
  })

  it("can't be proven while the DNS can't be read", async () => {
    const t = setup()
    const added = await t.api.add({ kind: "custom", hostname: "links.acme.com" }, t.as("ada"))
    t.prove(added)
    t.provider.dns.resolve = async () => {
      throw new Error("DNS is down")
    }
    const checked = await t.api.check({ domainId: added.id }, t.as("ada"))
    expect(checked).toMatchObject({ status: "pending", error: lookupError })
    expect(checked.records.map((record) => record.found)).toEqual([null, null])
  })
})

describe("check", () => {
  it("can't run again within 10 seconds", async () => {
    const { api, as } = setup()
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    await api.check({ domainId: added.id }, as("ada"))
    await expect(api.check({ domainId: added.id }, as("ada"))).rejects.toMatchObject({ code: "RATE_LIMITED" })
    advance()
    await expect(api.check({ domainId: added.id }, as("ada"))).resolves.toMatchObject({ status: "pending" })
  })

  it("finds a routing record that flattened DNS answers with addresses", async () => {
    const t = setup()
    const added = await t.api.add({ kind: "custom", hostname: "acme.com" }, t.as("ada"))
    t.prove(added)
    t.provider.dns.publish("acme.com", "A", "192.0.2.10")
    t.provider.dns.publish("customers.yourapp.com", "A", "192.0.2.10")
    const checked = await t.api.check({ domainId: added.id }, t.as("ada"))
    expect(checked).toMatchObject({ error: waiting })
    expect(checked.records[0]?.found).toBe(true)
    advance()
    await expect(t.api.check({ domainId: added.id }, t.as("ada"))).resolves.toMatchObject({ status: "active" })
  })

  it("trusts the provider serving a domain where DNS hides its CNAME", async () => {
    const t = setup()
    const added = await t.api.add({ kind: "custom", hostname: "links.acme.com" }, t.as("ada"))
    t.prove(added)
    const proven = await t.api.check({ domainId: added.id }, t.as("ada"))
    // The customer's DNS proxies the hostname, so lookups see its own addresses instead of the CNAME, and the
    // provider verified it through its own record.
    const prevalidation = t.recordOf(proven, "prevalidation")
    t.provider.dns.publish(prevalidation.name, "TXT", prevalidation.value)
    advance()
    const ready = await t.api.check({ domainId: added.id }, t.as("ada"))
    expect(ready).toMatchObject({ status: "active", error: null })
    expect(ready.records[0]?.found).toBe(false)
  })

  it("checks routing records a provider asks for by address", async () => {
    const local = localHostnames({ target: "customers.yourapp.com" })
    const provider: HostnameProvider = {
      ...local,
      routing: (hostname) => [{ type: "A", name: hostname, value: "192.0.2.1", purpose: "routing" }]
    }
    const { api, as } = setup({ custom: { provider }, dns: local.dns })
    const added = await api.add({ kind: "custom", hostname: "acme.com" }, as("ada"))
    expect(added.records[0]).toMatchObject({ type: "A", name: "acme.com", value: "192.0.2.1" })
    local.dns.publish("_verify.acme.com", "TXT", added.records[1]?.value as string)
    await expect(api.check({ domainId: added.id }, as("ada"))).resolves.toMatchObject({
      error: "Add an A record for acme.com with the address 192.0.2.1."
    })
    local.dns.publish("acme.com", "A", "192.0.2.1")
    advance()
    const routed = await api.check({ domainId: added.id }, as("ada"))
    expect(routed).toMatchObject({ error: waiting })
    expect(routed.records[0]?.found).toBe(true)
  })

  it("says when a CNAME points elsewhere, and when DNS can't be read", async () => {
    const t = setup()
    const added = await t.api.add({ kind: "custom", hostname: "links.acme.com" }, t.as("ada"))
    t.prove(added)
    t.provider.dns.publish("links.acme.com", "CNAME", "other.example.net.")
    const checked = await t.api.check({ domainId: added.id }, t.as("ada"))
    expect(checked).toMatchObject({ error: cnameError("links.acme.com") })
    expect(checked.records[0]?.found).toBe(false)
    t.provider.dns.resolve = async () => {
      throw new Error("DNS is down")
    }
    advance()
    const failed = await t.api.check({ domainId: added.id }, t.as("ada"))
    expect(failed.records[0]?.found).toBeNull()
    expect(failed.error).toBe(lookupError)
  })

  it("waits for the certificate, and asks for it again when it failed", async () => {
    const t = setup()
    const added = await t.api.add({ kind: "custom", hostname: "links.acme.com" }, t.as("ada"))
    t.prove(added)
    t.route("links.acme.com")
    await t.api.check({ domainId: added.id }, t.as("ada"))
    t.provider.holdCertificate("links.acme.com", "pending")
    advance()
    await expect(t.api.check({ domainId: added.id }, t.as("ada"))).resolves.toMatchObject({
      status: "pending",
      certificate: "pending",
      error: "The domain is verified. Its certificate is being issued, which can take a few minutes."
    })
    t.provider.holdCertificate("links.acme.com", "failed")
    advance()
    await expect(t.api.check({ domainId: added.id }, t.as("ada"))).resolves.toMatchObject({
      status: "pending",
      error: waiting
    })
  })

  it("restarts validation of a hostname that moved", async () => {
    const t = setup()
    const added = await addReady(t, "ada", "links.acme.com")
    t.provider.dns.unpublish("links.acme.com", "CNAME")
    advance()
    const moved = await t.api.check({ domainId: added.id }, t.as("ada"))
    expect(moved).toMatchObject({
      status: "pending",
      primary: true,
      error: cnameError("links.acme.com"),
      nextCheckAt: later(start, 20_000 + 60_000)
    })
    t.route("links.acme.com")
    advance()
    await expect(t.api.check({ domainId: added.id }, t.as("ada"))).resolves.toMatchObject({ status: "active" })
  })

  it("registers a hostname again when the provider lost it", async () => {
    const t = setup()
    const added = await addReady(t, "ada", "links.acme.com")
    const [first] = [...t.provider.hostnames.keys()]
    await t.provider.remove(first as string)
    advance()
    await expect(t.api.check({ domainId: added.id }, t.as("ada"))).resolves.toMatchObject({ error: waiting })
    expect([...t.provider.hostnames.values()].map((entry) => entry.hostname)).toEqual(["links.acme.com"])
  })

  it("keeps the hostname the provider already has, as after a check that stopped before saving its id", async () => {
    const t = setup()
    const added = await t.api.add({ kind: "custom", hostname: "links.acme.com" }, t.as("ada"))
    t.prove(added)
    const early = await t.provider.create("links.acme.com")
    await t.api.check({ domainId: added.id }, t.as("ada"))
    expect([...t.provider.hostnames.keys()]).toEqual([early.id])
  })

  it("fails a blocked hostname, and its schedule stops", async () => {
    const t = setup()
    const added = await t.api.add({ kind: "custom", hostname: "links.acme.com" }, t.as("ada"))
    t.prove(added)
    await t.api.check({ domainId: added.id }, t.as("ada"))
    t.provider.block("links.acme.com")
    advance()
    await expect(t.api.check({ domainId: added.id }, t.as("ada"))).resolves.toMatchObject({
      status: "failed",
      error: "The provider blocked this hostname.",
      nextCheckAt: null
    })
    vi.setSystemTime(minutes(2))
    await t.app.deliverEvents()
    expect(t.scheduled()).toEqual([])
  })

  it("fails a domain the provider refuses to register again", async () => {
    const t = setup()
    const added = await t.api.add({ kind: "custom", hostname: "links.acme.com" }, t.as("ada"))
    t.prove(added)
    await t.api.check({ domainId: added.id }, t.as("ada"))
    await t.provider.remove([...t.provider.hostnames.keys()][0] as string)
    t.provider.failNext("create", new HostnameProviderError("INVALID_HOSTNAME", "Not allowed."))
    advance()
    const response = await t.post("check", { domainId: added.id }, "ada")
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: "failed", error: "Not allowed." })
  })

  it("answers 502 when the provider can't be reached, and 500 for the app's own errors", async () => {
    const t = setup()
    const added = await t.api.add({ kind: "custom", hostname: "links.acme.com" }, t.as("ada"))
    t.prove(added)
    await t.api.check({ domainId: added.id }, t.as("ada"))
    advance()
    t.provider.failNext("get", new HostnameProviderError("UNAVAILABLE", "Down."))
    expect((await t.post("check", { domainId: added.id }, "ada")).status).toBe(502)
    t.provider.failNext("get", new Error("Bad token"))
    expect((await t.post("check", { domainId: added.id }, "ada")).status).toBe(500)
  })
})

describe("scheduled rechecks", () => {
  it("back off while a domain is pending, and check it daily once it's ready", async () => {
    const t = setup()
    const { api, as, app, scheduled } = t
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    const domain = async () => (await api.list(undefined, as("ada"))).domains[0]
    // Not due yet: the event waits for the next run.
    await app.deliverEvents()
    expect(await domain()).toMatchObject({ lastCheckedAt: null, nextCheckAt: minutes(1) })
    vi.setSystemTime(minutes(1))
    await app.deliverEvents()
    expect(await domain()).toMatchObject({ lastCheckedAt: minutes(1), nextCheckAt: minutes(3) })
    vi.setSystemTime(minutes(3))
    await app.deliverEvents()
    expect(await domain()).toMatchObject({ lastCheckedAt: minutes(3), nextCheckAt: minutes(8) })
    t.prove(added)
    t.route("links.acme.com")
    vi.setSystemTime(minutes(8))
    await app.deliverEvents()
    expect(await domain()).toMatchObject({ status: "pending", error: waiting, nextCheckAt: minutes(18) })
    vi.setSystemTime(minutes(18))
    await app.deliverEvents()
    const daily = later(minutes(18), recheckMs)
    expect(await domain()).toMatchObject({ status: "active", primary: true, nextCheckAt: daily })
    expect(scheduled()).toEqual([{ domainId: added.id, token: expect.any(String), dueAt: daily.toISOString() }])
    vi.setSystemTime(daily)
    await app.deliverEvents()
    expect(await domain()).toMatchObject({
      status: "active",
      lastCheckedAt: daily,
      nextCheckAt: later(daily, recheckMs)
    })
    expect(scheduled()).toHaveLength(1)
  })

  it("fail a ready domain that stopped pointing at the app for 7 days", async () => {
    const t = setup()
    const { api, as, app, provider } = t
    await addReady(t, "ada", "links.acme.com")
    const domain = async () => (await api.list(undefined, as("ada"))).domains[0]
    provider.dns.unpublish("links.acme.com", "CNAME")
    const recheck = later(new Date(Date.now()), recheckMs)
    vi.setSystemTime(recheck)
    await app.deliverEvents()
    expect(await domain()).toMatchObject({ status: "pending", primary: true, nextCheckAt: later(recheck, 60_000) })
    await expect(api.lookup({ hostname: "links.acme.com" })).resolves.toMatchObject({ verified: false })
    vi.setSystemTime(later(recheck, checkWindowMs))
    await app.deliverEvents()
    expect(await domain()).toMatchObject({ status: "failed", error: expiredError, nextCheckAt: null })
    // It stops holding a hostname at the provider, and keeps its hostname in the app.
    expect(provider.hostnames.size).toBe(0)
    await expect(api.lookup({ hostname: "links.acme.com" })).resolves.toMatchObject({ orgId: "acme", verified: false })
  })

  it("fail a domain still pending after 7 days", async () => {
    const { api, as, app, scheduled } = setup()
    await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    vi.setSystemTime(minutes(7 * 24 * 60))
    await app.deliverEvents()
    const [domain] = (await api.list(undefined, as("ada"))).domains
    expect(domain).toMatchObject({ status: "failed", error: expiredError, nextCheckAt: null })
    expect(scheduled()).toEqual([])
  })

  it("stop the older schedule when someone checks now", async () => {
    const { api, as, app, scheduled } = setup()
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    await api.check({ domainId: added.id }, as("ada"))
    expect(scheduled()).toHaveLength(2)
    vi.setSystemTime(minutes(2))
    await app.deliverEvents()
    expect(scheduled()).toHaveLength(1)
  })

  it("leave a check the provider couldn't make in the outbox", async () => {
    const t = setup()
    const added = await t.api.add({ kind: "custom", hostname: "links.acme.com" }, t.as("ada"))
    t.prove(added)
    await t.api.check({ domainId: added.id }, t.as("ada"))
    t.provider.failNext("get", new HostnameProviderError("UNAVAILABLE", "Down."))
    vi.setSystemTime(minutes(1))
    expect(await t.app.deliverEvents()).toMatchObject({ failed: 1 })
  })

  it("pass on a check delivered again after its domain was checked", async () => {
    const { api, as, app, database, scheduled } = setup()
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    vi.setSystemTime(minutes(1))
    await app.deliverEvents()
    // As though the run stopped after saving the check but before the outbox heard: the event is still the old one.
    const [event] = scheduled()
    database.sqlite
      .prepare("UPDATE betterAppsEvent SET data = ? WHERE type = 'check.scheduled'")
      .run(JSON.stringify({ ...event, dueAt: minutes(1).toISOString() }))
    vi.setSystemTime(minutes(2))
    await app.deliverEvents()
    expect((await api.list(undefined, as("ada"))).domains[0]).toMatchObject({ lastCheckedAt: minutes(1) })
    expect(scheduled()).toEqual([{ domainId: added.id, token: event?.token, dueAt: minutes(3).toISOString() }])
  })

  it("stop for a domain that was removed", async () => {
    const { api, as, app, scheduled } = setup()
    const added = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    await api.remove({ domainId: added.id }, as("ada"))
    vi.setSystemTime(minutes(1))
    await app.deliverEvents()
    expect(scheduled()).toEqual([])
  })
})

describe("remove", () => {
  it("removes the domain from the provider, and its primary place", async () => {
    const t = setup()
    const added = await addReady(t, "ada", "links.acme.com")
    await expect(t.api.remove({ domainId: added.id }, t.as("ada"))).resolves.toEqual({ removed: true })
    expect(t.provider.hostnames.size).toBe(0)
    expect(t.events("domain.removed")).toHaveLength(1)
    expect(t.events("primary.changed").at(-1)?.data).toEqual({ orgId: "acme", domain: null })
    await expect(t.api.getPrimary({ orgId: "acme" })).resolves.toBeNull()
    await expect(t.api.remove({ domainId: added.id }, t.as("ada"))).resolves.toEqual({ removed: false })
    expect(t.events("domain.removed")).toHaveLength(1)
  })

  it("tells only one of two removals at once that it removed the domain", async () => {
    const { api, as, events } = setup()
    const added = await api.add({ kind: "subdomain", label: "acme" }, as("ada"))
    const results = await Promise.all([
      api.remove({ domainId: added.id }, as("ada")),
      api.remove({ domainId: added.id }, as("ada"))
    ])
    expect(results.map((result) => result.removed).sort()).toEqual([false, true])
    expect(events("domain.removed")).toHaveLength(1)
    expect(events("primary.changed").map((event) => event.data)).toEqual([
      expect.objectContaining({ orgId: "acme" }),
      { orgId: "acme", domain: null }
    ])
  })

  it("keeps the domain when the provider fails", async () => {
    const t = setup()
    const added = await addReady(t, "ada", "links.acme.com")
    t.provider.failNext("remove", new HostnameProviderError("UNAVAILABLE", "Down."))
    await expect(t.api.remove({ domainId: added.id }, t.as("ada"))).rejects.toMatchObject({ code: "PROVIDER_ERROR" })
    expect((await t.api.list(undefined, t.as("ada"))).domains).toHaveLength(1)
  })

  it("removes every domain of an organization, from the provider too", async () => {
    const t = setup()
    const { api, as, provider, events } = t
    await api.add({ kind: "subdomain", label: "acme" }, as("ada"))
    await addReady(t, "ada", "links.acme.com")
    await api.add({ kind: "custom", hostname: "links.globex.com" }, as("gus"))
    await expect(api.removeAll({ orgId: "acme" })).resolves.toEqual({ removed: 2 })
    expect((await api.list(undefined, as("ada"))).domains).toEqual([])
    expect((await api.list(undefined, as("gus"))).domains).toHaveLength(1)
    expect(provider.hostnames.size).toBe(0)
    await expect(api.getPrimary({ orgId: "acme" })).resolves.toBeNull()
    expect(events("domain.removed")).toHaveLength(2)
  })
})

describe("setPrimary", () => {
  it("moves the primary place to another active domain, or clears it", async () => {
    const t = setup()
    const { api, as, events } = t
    const subdomain = await api.add({ kind: "subdomain", label: "acme" }, as("ada"))
    vi.setSystemTime(minutes(0.5))
    const pending = await api.add({ kind: "custom", hostname: "links.acme.com" }, as("ada"))
    await expect(api.setPrimary({ domainId: pending.id }, as("ada"))).rejects.toMatchObject({ code: "CONFLICT" })
    await api.remove({ domainId: pending.id }, as("ada"))
    const custom = await addReady(t, "ada", "links.acme.com")
    expect(custom.primary).toBe(false)
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

  it("goes to one domain when two become ready at once", async () => {
    const t = setup()
    const { api, as } = t
    const added = await Promise.all(
      ["a.acme.com", "b.acme.com"].map((hostname) => api.add({ kind: "custom", hostname }, as("ada")))
    )
    for (const domain of added) {
      t.prove(domain)
      t.route(domain.hostname)
      await api.check({ domainId: domain.id }, as("ada"))
    }
    advance()
    await Promise.all(added.map((domain) => api.check({ domainId: domain.id }, as("ada"))))
    const { domains: listed } = await api.list(undefined, as("ada"))
    expect(listed.map((domain) => domain.status)).toEqual(["active", "active"])
    expect(listed.filter((domain) => domain.primary)).toHaveLength(1)
    expect(t.events("primary.changed")).toHaveLength(1)
  })
})

describe("lookup", () => {
  it("finds the organization holding a hostname, ignoring case and port", async () => {
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

  it("reports a held custom domain that isn't ready as unverified", async () => {
    const t = setup()
    const added = await t.api.add({ kind: "custom", hostname: "links.acme.com" }, t.as("ada"))
    t.prove(added)
    await t.api.check({ domainId: added.id }, t.as("ada"))
    await expect(t.api.lookup({ hostname: "links.acme.com." })).resolves.toMatchObject({
      verified: false,
      status: "pending"
    })
  })

  it("isn't reachable over HTTP, with getPrimary and removeAll", async () => {
    const { post } = setup()
    expect((await post("lookup", { hostname: "acme.yourapp.com" }, "ada")).status).toBe(404)
    expect((await post("getPrimary", { orgId: "acme" }, "ada")).status).toBe(404)
    expect((await post("removeAll", { orgId: "acme" }, "ada")).status).toBe(404)
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
