import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import { setup as setupApp } from "../test/app.js"
import { domainHosts, type Domain, type DomainHostsApi, type DomainKind, type DomainStatus } from "./index.js"

interface Held {
  orgId: string | null
  hostname: string
  kind: DomainKind
  status: DomainStatus
  primary?: boolean
}

/** Domains' server calls over a list of domains, recording the hostnames looked up. */
function fakeDomains(held: Held[]): DomainHostsApi & { lookups: string[] } {
  const lookups: string[] = []
  const toDomain = (entry: Held): Domain => ({
    id: entry.hostname,
    hostname: entry.hostname,
    kind: entry.kind,
    status: entry.status,
    certificate: "active",
    primary: entry.primary ?? false,
    records: [],
    error: null,
    createdAt: new Date(0),
    lastCheckedAt: null,
    nextCheckAt: null,
    verifiedAt: null
  })
  return {
    lookups,
    async lookup({ hostname }) {
      lookups.push(hostname)
      const entry = held.find((domain) => domain.hostname === hostname)
      return entry
        ? {
            domainId: entry.hostname,
            orgId: entry.orgId,
            hostname: entry.hostname,
            kind: entry.kind,
            status: entry.status,
            verified: entry.status === "active",
            primary: entry.primary ?? false
          }
        : null
    },
    async getPrimary({ orgId }) {
      const entry = held.find((domain) => domain.orgId === orgId && domain.primary)
      return entry ? toDomain(entry) : null
    }
  }
}

const held: Held[] = [
  { orgId: "acme", hostname: "acme.yourapp.localhost", kind: "subdomain", status: "active", primary: true },
  { orgId: "acme", hostname: "go.acme.com", kind: "custom", status: "active" },
  { orgId: "globex", hostname: "links.globex.com", kind: "custom", status: "active", primary: true },
  { orgId: "initech", hostname: "go.initech.com", kind: "custom", status: "pending", primary: true }
]

describe("domainHosts", () => {
  it("throws until it's connected", async () => {
    const { hosts } = domainHosts({ url: "https://app.yourapp.com" })
    await expect(hosts.resolve({ hostname: "go.acme.com" })).rejects.toThrow("connect(app.api.domains)")
    await expect(hosts.origin({ orgId: "acme" })).rejects.toThrow("connect(app.api.domains)")
  })

  it("refuses a local suffix outside localhost", () => {
    expect(() => domainHosts({ url: "https://app.yourapp.com", localSuffix: "yourapp.com" })).toThrow("localSuffix")
    expect(() => domainHosts({ url: "https://app.yourapp.com", localSuffix: "not a host" })).toThrow("localSuffix")
    expect(() => domainHosts({ url: "http://127.0.0.1:4190", localSuffix: "Yourapp.Localhost." })).not.toThrow()
  })

  it("refuses a url that isn't the app's http or https URL", () => {
    expect(() => domainHosts({ url: "localhost:3000" })).toThrow("`url`")
    expect(() => domainHosts({ url: "app.yourapp.com" })).toThrow("`url`")
    expect(() => domainHosts({ url: "ftp://app.yourapp.com" })).toThrow("`url`")
    expect(() => domainHosts({ url: new URL("https://app.yourapp.com") })).not.toThrow()
  })

  it("normalizes the url's hostname", async () => {
    const api = fakeDomains(held)
    const { hosts, connect } = domainHosts({ url: "http://App.YourApp.localhost.:3000" })
    connect(api)
    await expect(hosts.resolve({ hostname: "app.yourapp.localhost" })).resolves.toBe("app")
    expect(api.lookups).toEqual([])
    await expect(hosts.origin({ orgId: "globex" })).resolves.toBe("http://links.globex.com:3000")
  })

  it("refuses app hostnames that aren't hostnames without a port", () => {
    const url = "http://127.0.0.1:4190"
    expect(() => domainHosts({ url, hostnames: ["localhost:4190"] })).toThrow('"localhost:4190"')
    expect(() => domainHosts({ url, hostnames: ["::1"] })).toThrow('"::1"')
    expect(() => domainHosts({ url, hostnames: ["", "Local Host"] })).toThrow("hostnames")
    expect(() => domainHosts({ url, hostnames: ["[::1]", "Localhost."] })).not.toThrow()
  })

  describe("resolve", () => {
    const setup = () => {
      const api = fakeDomains(held)
      const { hosts, connect } = domainHosts({ url: "https://App.YourApp.com", hostnames: ["localhost"] })
      connect(api)
      return { api, hosts }
    }

    it("answers the app's own hostnames without a lookup", async () => {
      const { api, hosts } = setup()
      await expect(hosts.resolve({ hostname: "app.yourapp.com" })).resolves.toBe("app")
      await expect(hosts.resolve({ hostname: "localhost" })).resolves.toBe("app")
      expect(api.lookups).toEqual([])
    })

    it("normalizes the hostname as lookup does", async () => {
      const { api, hosts } = setup()
      await expect(hosts.resolve({ hostname: "App.YourApp.com." })).resolves.toBe("app")
      await expect(hosts.resolve({ hostname: "app.yourapp.com:443" })).resolves.toBe("app")
      await expect(hosts.resolve({ hostname: "localhost:4190" })).resolves.toBe("app")
      await expect(hosts.resolve({ hostname: "Go.Acme.com.:8443" })).resolves.toEqual({ orgId: "acme" })
      expect(api.lookups).toEqual(["go.acme.com"])
    })

    it("answers nobody for a host no domain could hold, without a lookup", async () => {
      const { api, hosts } = setup()
      await expect(hosts.resolve({ hostname: `${"a".repeat(250)}.com` })).resolves.toBeNull()
      await expect(hosts.resolve({ hostname: "not a host" })).resolves.toBeNull()
      expect(api.lookups).toEqual([])
    })

    it("answers an organization's ready domains of both kinds", async () => {
      const { hosts } = setup()
      await expect(hosts.resolve({ hostname: "go.acme.com" })).resolves.toEqual({ orgId: "acme" })
      await expect(hosts.resolve({ hostname: "acme.yourapp.localhost" })).resolves.toEqual({ orgId: "acme" })
    })

    it("answers nobody for a pending domain or an unknown host", async () => {
      const { hosts } = setup()
      await expect(hosts.resolve({ hostname: "go.initech.com" })).resolves.toBeNull()
      await expect(hosts.resolve({ hostname: "unknown.example.org" })).resolves.toBeNull()
    })

    it("answers the app for a ready domain in an app without organizations", async () => {
      const { hosts, connect } = domainHosts({ url: "https://app.yourapp.com" })
      connect(fakeDomains([{ orgId: null, hostname: "go.workspace.com", kind: "custom", status: "active" }]))
      await expect(hosts.resolve({ hostname: "go.workspace.com" })).resolves.toBe("app")
    })

    it("uses the domains connected last", async () => {
      const { hosts, connect } = domainHosts({ url: "https://app.yourapp.com" })
      connect(fakeDomains([]))
      connect(fakeDomains(held))
      await expect(hosts.resolve({ hostname: "go.acme.com" })).resolves.toEqual({ orgId: "acme" })
    })
  })

  describe("origin", () => {
    it("is the primary domain once it's active, on the app's scheme and port", async () => {
      const { hosts, connect } = domainHosts({ url: "http://127.0.0.1:4190" })
      connect(fakeDomains(held))
      await expect(hosts.origin({ orgId: "acme" })).resolves.toBe("http://acme.yourapp.localhost:4190")
      await expect(hosts.origin({ orgId: "globex" })).resolves.toBe("http://links.globex.com:4190")
    })

    it("leaves out the default port", async () => {
      const { hosts, connect } = domainHosts({ url: "https://app.yourapp.com:443" })
      connect(fakeDomains(held))
      await expect(hosts.origin({ orgId: "globex" })).resolves.toBe("https://links.globex.com")
    })

    it("is the app's own without an active primary domain", async () => {
      const { hosts, connect } = domainHosts({ url: "https://app.yourapp.com" })
      connect(fakeDomains(held))
      await expect(hosts.origin({ orgId: "initech" })).resolves.toBeNull()
      await expect(hosts.origin({ orgId: "hooli" })).resolves.toBeNull()
      await expect(hosts.origin({ orgId: null })).resolves.toBeNull()
    })
  })

  describe("with a local suffix", () => {
    const setup = () => {
      const api = fakeDomains(held)
      const { hosts, connect } = domainHosts({ url: "http://127.0.0.1:4190", localSuffix: "yourapp.localhost" })
      connect(api)
      return { api, hosts }
    }

    it("answers a custom domain at its alias", async () => {
      const { api, hosts } = setup()
      await expect(hosts.resolve({ hostname: "go.acme.com.yourapp.localhost" })).resolves.toEqual({ orgId: "acme" })
      expect(api.lookups).toEqual(["go.acme.com.yourapp.localhost", "go.acme.com"])
      await expect(hosts.resolve({ hostname: "go.acme.com.yourapp.localhost:4190" })).resolves.toEqual({
        orgId: "acme"
      })
      await expect(hosts.resolve({ hostname: "go.initech.com.yourapp.localhost" })).resolves.toBeNull()
    })

    it("answers a custom domain only at its alias", async () => {
      const { hosts } = setup()
      await expect(hosts.resolve({ hostname: "go.acme.com" })).resolves.toBeNull()
    })

    it("answers a subdomain as it is, with one lookup", async () => {
      const { api, hosts } = setup()
      await expect(hosts.resolve({ hostname: "acme.yourapp.localhost" })).resolves.toEqual({ orgId: "acme" })
      expect(api.lookups).toEqual(["acme.yourapp.localhost"])
    })

    it("keeps a subdomain when a custom domain's alias would name the same host", async () => {
      // The suffix `localhost` sits above the zone `yourapp.localhost`, so `acme.yourapp` would alias to the subdomain.
      const api = fakeDomains([
        ...held,
        { orgId: "globex", hostname: "acme.yourapp", kind: "custom", status: "active" }
      ])
      const { hosts, connect } = domainHosts({ url: "http://127.0.0.1:4190", localSuffix: "localhost" })
      connect(api)
      await expect(hosts.resolve({ hostname: "acme.yourapp.localhost" })).resolves.toEqual({ orgId: "acme" })
      expect(api.lookups).toEqual(["acme.yourapp.localhost"])
    })

    it("answers nobody for an unknown alias", async () => {
      const { hosts } = setup()
      await expect(hosts.resolve({ hostname: "unknown.example.org.yourapp.localhost" })).resolves.toBeNull()
      await expect(hosts.resolve({ hostname: "unknown.yourapp.localhost" })).resolves.toBeNull()
    })

    it("never answers a subdomain at an alias", async () => {
      const { hosts } = setup()
      await expect(hosts.resolve({ hostname: "acme.yourapp.localhost.yourapp.localhost" })).resolves.toBeNull()
    })

    it("shares a custom primary domain at its alias and a subdomain as it is", async () => {
      const { hosts } = setup()
      await expect(hosts.origin({ orgId: "globex" })).resolves.toBe("http://links.globex.com.yourapp.localhost:4190")
      await expect(hosts.origin({ orgId: "acme" })).resolves.toBe("http://acme.yourapp.localhost:4190")
    })
  })
})

describe("domainHosts with the domains feature", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("answers for real domains on the local provider", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const t = setupApp({ subdomains: { zone: "yourapp.localhost" } })
    const subdomain = await t.api.add({ kind: "subdomain", label: "acme" }, t.as("ada"))
    const custom = await t.api.add({ kind: "custom", hostname: "go.acme.org" }, t.as("ada"))
    t.prove(custom)
    t.route("go.acme.org")
    await t.api.check({ domainId: custom.id }, t.as("ada"))
    vi.setSystemTime(new Date(Date.now() + 10_000))
    await expect(t.api.check({ domainId: custom.id }, t.as("ada"))).resolves.toMatchObject({ status: "active" })
    await t.api.add({ kind: "custom", hostname: "links.globex.org" }, t.as("gus"))

    const { hosts, connect } = domainHosts({ url: "http://127.0.0.1:4190", localSuffix: "yourapp.localhost" })
    connect(t.api)
    await expect(hosts.resolve({ hostname: "acme.yourapp.localhost" })).resolves.toEqual({ orgId: "acme" })
    await expect(hosts.resolve({ hostname: "go.acme.org.yourapp.localhost" })).resolves.toEqual({ orgId: "acme" })
    await expect(hosts.resolve({ hostname: "go.acme.org" })).resolves.toBeNull()
    await expect(hosts.resolve({ hostname: "links.globex.org.yourapp.localhost" })).resolves.toBeNull()
    await expect(hosts.origin({ orgId: "acme" })).resolves.toBe("http://acme.yourapp.localhost:4190")

    await t.api.setPrimary({ domainId: custom.id }, t.as("ada"))
    await expect(hosts.origin({ orgId: "acme" })).resolves.toBe("http://go.acme.org.yourapp.localhost:4190")
    await t.api.setPrimary({ domainId: subdomain.id }, t.as("ada"))
    await expect(hosts.origin({ orgId: "globex" })).resolves.toBeNull()
  })
})
