import { describe, expect, it, vi } from "vite-plus/test"
import { browser } from "../test/browser.js"
import { createDomainsClient } from "./client.js"

describe("domains client", () => {
  it("is one store per Better Apps client", () => {
    const { client, domains } = browser()
    expect(createDomainsClient(client)).toBe(domains)
  })

  it("loads the organization's domains with their dates", async () => {
    const { api, as, domains } = browser()
    await api.add({ kind: "subdomain", label: "acme" }, as("ada"))
    expect(domains.store.getSnapshot().state).toBe("idle")
    const loading = domains.load()
    expect(domains.store.getSnapshot().state).toBe("loading")
    await loading
    const { state, list } = domains.store.getSnapshot()
    expect(state).toBe("ready")
    expect(list).toMatchObject({ canManage: true, subdomainZone: "yourapp.com", customDomains: true, maxPerOrg: 10 })
    expect(list?.domains[0]?.createdAt).toBeInstanceOf(Date)
    expect(list?.domains[0]?.verifiedAt).toBeInstanceOf(Date)
    expect(list?.domains[0]?.lastCheckedAt).toBeNull()
  })

  it("shares a load under way", async () => {
    const { domains, requests } = browser()
    await Promise.all([domains.load(), domains.load()])
    expect(requests).toEqual(["list"])
    await domains.load()
    expect(requests).toEqual(["list", "list"])
  })

  it("keeps a failed load's error", async () => {
    const { domains } = browser(null)
    await expect(domains.load()).rejects.toMatchObject({ code: "UNAUTHENTICATED" })
    expect(domains.store.getSnapshot()).toMatchObject({ state: "error", error: { code: "UNAUTHENTICATED" } })
  })

  it("adds, checks, makes primary and removes domains", async () => {
    const { domains } = browser()
    await domains.load()
    const subdomain = await domains.add({ kind: "subdomain", label: "acme" })
    const custom = await domains.add({ kind: "custom", hostname: "links.acme.com" })
    const shown = () => domains.store.getSnapshot().list?.domains ?? []
    expect(shown().map((domain) => [domain.hostname, domain.status, domain.primary])).toEqual([
      ["acme.yourapp.com", "active", true],
      ["links.acme.com", "pending", false]
    ])
    // Adding checked it a moment ago, so checking again waits, and the domain isn't left busy.
    await expect(domains.check(custom.id)).rejects.toMatchObject({ code: "RATE_LIMITED" })
    expect(domains.store.getSnapshot().calls).toEqual({})
    await domains.setPrimary(subdomain.id)
    await domains.setPrimary(null)
    expect(shown().map((domain) => domain.primary)).toEqual([false, false])
    await domains.setPrimary(subdomain.id)
    expect(shown().map((domain) => domain.primary)).toEqual([true, false])
    await expect(domains.remove(custom.id)).resolves.toEqual({ removed: true })
    expect(shown().map((domain) => domain.hostname)).toEqual(["acme.yourapp.com"])
  })

  it("shows what a check found", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      const { domains } = browser()
      await domains.load()
      const custom = await domains.add({ kind: "custom", hostname: "links.acme.com" })
      vi.setSystemTime(Date.now() + 11_000)
      await expect(domains.check(custom.id)).resolves.toMatchObject({ status: "active", primary: true })
      expect(domains.store.getSnapshot().list?.domains).toMatchObject([{ id: custom.id, status: "active" }])
    } finally {
      vi.useRealTimers()
    }
  })

  it("marks a domain busy while its call is under way", async () => {
    const { domains, hold } = browser()
    await domains.load()
    const added = await domains.add({ kind: "subdomain", label: "acme" })
    const release = hold("remove")
    const removing = domains.remove(added.id)
    expect(domains.store.getSnapshot().calls).toEqual({ [added.id]: "remove" })
    release()
    await removing
    expect(domains.store.getSnapshot().calls).toEqual({})
  })

  it("drops answers for the person before a reset", async () => {
    const { domains, hold } = browser()
    await domains.load()
    const release = hold("add")
    const adding = domains.add({ kind: "subdomain", label: "acme" })
    domains.reset()
    release()
    await adding
    expect(domains.store.getSnapshot()).toEqual({ state: "idle", error: null, list: null, calls: {} })
    const releaseList = hold("list")
    const loading = domains.load()
    domains.reset()
    releaseList()
    await loading
    expect(domains.store.getSnapshot().state).toBe("idle")
  })

  it("adds to nothing before the list loads", async () => {
    const { domains } = browser()
    await domains.add({ kind: "subdomain", label: "acme" })
    expect(domains.store.getSnapshot().list).toBeNull()
  })
})
