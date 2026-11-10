import { beforeEach, describe, expect, it, vi } from "vite-plus/test"
import { cookieOf, expectCode, setup } from "../test/app.js"
import { grantCookie } from "./cookie.js"
import type { LinkHosts } from "./index.js"

// Codes the next links get, in order, before random ones.
const next = vi.hoisted(() => [] as string[])

vi.mock("./codes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./codes.js")>()
  return { ...actual, generateCode: (length?: number) => next.shift() ?? actual.generateCode(length) }
})

const docs = { url: "https://docs.test/start" }

beforeEach(() => {
  next.length = 0
})

/** Each organization's links open on its own domain and get codes of its own there. */
const domains: Record<string, string> = { acme: "links.acme.test", globex: "links.globex.test" }
const hosts: LinkHosts = {
  resolve: ({ hostname }) => {
    if (hostname === "app.test") {
      return "app"
    }
    const orgId = Object.keys(domains).find((org) => domains[org] === hostname)
    return orgId === undefined ? null : { orgId }
  },
  origin: ({ orgId }) => (orgId === null || domains[orgId] === undefined ? null : `https://${domains[orgId]}`)
}

describe("generated codes that collide", () => {
  it("are replaced with another, up to three times, then the call fails with CONFLICT", async () => {
    const { api, as, events } = setup()
    await api.create({ target: docs, code: "taken-01" }, as("ada"))
    next.push("taken-01", "taken-01", "fresh-01")
    expect((await api.create({ target: docs }, as("ada"))).code).toBe("fresh-01")
    // Each failed attempt's event went with its batch.
    expect(events("link.created").map((event) => (event.data as { link: { code: string } }).link.code)).toEqual([
      "taken-01",
      "fresh-01"
    ])
    next.push("taken-01", "taken-01", "taken-01", "fresh-02")
    await expectCode(api.create({ target: docs }, as("ada")), "CONFLICT")
    expect(next).toEqual(["fresh-02"])
  })

  it("tell a failed write apart from a taken code only within the link's scope", async () => {
    const { app, api, as } = setup({ baseUrl: "https://app.test", hosts })
    await api.create({ target: docs, code: "pricing" }, as("ada"))
    // Globex's write fails for another reason. Acme's code is in another scope, so it isn't read back as taken.
    const batch = vi.spyOn(app.db, "batch").mockRejectedValueOnce(new Error("The database is down."))
    await expect(api.create({ target: docs, code: "pricing" }, as("gus"))).rejects.toThrow("The database is down.")
    batch.mockRestore()
  })

  it("collide only within their scope", async () => {
    const { api, as } = setup({ baseUrl: "https://app.test", hosts })
    await api.create({ target: docs, code: "taken-01" }, as("ada"))
    next.push("taken-01", "fresh-01")
    // Acme has the code on its domain, so Globex's link takes it on its own at once.
    expect((await api.create({ target: docs }, as("gus"))).code).toBe("taken-01")
    expect(next).toEqual(["fresh-01"])
  })

  it("are replaced when the organization's own link has the code with the app's, which its domain opens", async () => {
    const { api, as, events } = setup({ baseUrl: "https://app.test", hosts })
    delete domains.acme
    try {
      next.push("older-01")
      expect((await api.create({ target: docs }, as("ada"))).shortUrl).toBe("https://app.test/s/older-01")
    } finally {
      domains.acme = "links.acme.test"
    }
    next.push("older-01", "fresh-01")
    expect((await api.create({ target: docs }, as("ada"))).shortUrl).toBe("https://links.acme.test/s/fresh-01")
    // No event went out for the code that was never written.
    expect(events("link.created")).toHaveLength(2)
  })
})

describe("grant cookies", () => {
  it("never grant a link in one scope with the same code as a link in another", async () => {
    const { app, api, as } = setup({ baseUrl: "https://app.test", hosts })
    next.push("samecode1234", "samecode1234")
    const acmes = await api.create(
      { target: { subjectType: "invoice", subjectId: "inv-1" }, grantsView: true },
      as("ada")
    )
    const globexs = await api.create(
      { target: { subjectType: "invoice", subjectId: "inv-globex" }, grantsView: true },
      as("gus")
    )
    expect([acmes.code, globexs.code]).toEqual(["samecode1234", "samecode1234"])
    // A visitor opens Acme's link, and the cookie remembers its code with Acme's scope.
    const opened = await app.handler(new Request("https://links.acme.test/s/samecode1234"))
    const cookie = cookieOf(opened)
    expect(cookie).toBe(`better-apps-links=samecode1234~${btoa("acme").replace(/=+$/, "")}`)
    const holding = (value: string) => new Request("https://app.test/invoices", { headers: { cookie: value } })
    const acmeInvoice = { subjectType: "invoice", subjectId: "inv-1" }
    const globexInvoice = { subjectType: "invoice", subjectId: "inv-globex" }
    expect(await app.subjects.canView(null, acmeInvoice, { request: holding(cookie) })).toBe(true)
    expect(await app.subjects.canView(null, globexInvoice, { request: holding(cookie) })).toBe(false)
    // The code alone is in the app's scope, where neither link is.
    for (const ref of [acmeInvoice, globexInvoice]) {
      expect(await app.subjects.canView(null, ref, { request: holding("better-apps-links=samecode1234") })).toBe(false)
    }
    // In one batch, two visitors of the same record: one holds Acme's entry for the code, the other Globex's.
    const globexEntry = `better-apps-links=samecode1234~${btoa("globex").replace(/=+$/, "")}`
    expect(
      await app.subjects.canViewMany([
        { actor: null, ...globexInvoice, request: holding(cookie) },
        { actor: null, ...globexInvoice, request: holding(globexEntry) },
        { actor: null, ...acmeInvoice, request: holding(globexEntry) },
        { actor: null, ...acmeInvoice, request: holding(cookie) }
      ])
    ).toEqual([false, true, false, true])
    // Read by record, as when many visitors hold more codes than reading by code would take in a query.
    const reads = vi.spyOn(app.db, "findMany")
    // Each visitor holds 19 other codes, so five of them hold more than 90 between them.
    const filler = (visitor: number) =>
      Array.from({ length: 19 }, (_, index) => `filler${visitor}${String(index).padStart(4, "0")}`).join(".")
    const entries = [cookie, globexEntry, ...[2, 3, 4].map(() => "better-apps-links=")]
    expect(
      await app.subjects.canViewMany(
        entries.map((held, visitor) => {
          const [name, value] = held.split("=")
          return { actor: null, ...globexInvoice, request: holding(`${name}=${filler(visitor)}.${value ?? ""}`) }
        })
      )
    ).toEqual([false, true, false, false, false])
    const linkReads = reads.mock.calls.filter(([query]) => query.model === "shortLink")
    expect(linkReads).toHaveLength(1)
    expect(linkReads[0]?.[0].where?.[0]?.field).toBe("subjectType")
    reads.mockRestore()
    // Globex's own link grants its invoice, read by record or by code alike.
    const both = `better-apps-links=samecode1234~${btoa("globex").replace(/=+$/, "")}.${cookie.split("=")[1] ?? ""}`
    expect(
      await app.subjects.canViewMany([
        { actor: null, ...globexInvoice, request: holding(both) },
        { actor: null, ...acmeInvoice, request: holding(both) }
      ])
    ).toEqual([true, true])
  })

  it("keep another scope's entry with the same code when a link is opened", async () => {
    const { app, api, as } = setup({ baseUrl: "https://app.test", hosts })
    next.push("samecode1234", "samecode1234")
    await api.create({ target: { subjectType: "invoice", subjectId: "inv-1" }, grantsView: true }, as("ada"))
    await api.create({ target: { subjectType: "invoice", subjectId: "inv-globex" }, grantsView: true }, as("gus"))
    const globexEntry = `samecode1234~${btoa("globex").replace(/=+$/, "")}`
    const opened = await app.handler(
      new Request("https://links.acme.test/s/samecode1234", { headers: { cookie: `better-apps-links=${globexEntry}` } })
    )
    const cookie = cookieOf(opened)
    expect(cookie).toBe(`better-apps-links=${globexEntry}.samecode1234~${btoa("acme").replace(/=+$/, "")}`)
    const holding = new Request("https://app.test/invoices", { headers: { cookie } })
    expect(
      await app.subjects.canViewMany([
        { actor: null, subjectType: "invoice", subjectId: "inv-1", request: holding },
        { actor: null, subjectType: "invoice", subjectId: "inv-globex", request: holding }
      ])
    ).toEqual([true, true])
  })

  it("drop entries that aren't codes and scopes, and the oldest when long scopes would make the cookie too long", () => {
    const longOrg = "o".repeat(200)
    const scope = btoa(longOrg).replace(/=+$/, "")
    // 19 links held already, each with a long scope, beside entries that can't be read.
    const held = Array.from({ length: 19 }, (_, index) => `held${String(index).padStart(8, "0")}~${scope}`)
    const request = new Request("https://links.long.test/s/newest123456", {
      headers: { cookie: `better-apps-links=${["bad~%%%", "bad~_w", "", ...held].join(".")}` }
    })
    const header = grantCookie(
      request,
      { name: "better-apps-links", maxAge: 60, domain: undefined },
      { code: "newest123456", scope: longOrg }
    )
    const entries = header.split(";")[0]?.split("=")[1]?.split(".") ?? []
    expect(entries.at(-1)).toBe(`newest123456~${scope}`)
    expect(entries.join(".").length).toBeLessThanOrEqual(3800)
    expect(entries.length).toBeLessThan(20)
    expect(entries.every((entry) => entry.startsWith("held") || entry.startsWith("newest"))).toBe(true)
  })
})
