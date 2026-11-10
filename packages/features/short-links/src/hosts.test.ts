import { describe, expect, it } from "vite-plus/test"
import { cookieOf, options, setup } from "../test/app.js"
import { shortLinks, type LinkHosts, type LinkRules, type ShortLink } from "./index.js"

const inv1 = { subjectType: "invoice", subjectId: "inv-1" } as const
const docs = { url: "https://docs.test/start" }

/** Each organization's verified domain, as an app would read it from the domains feature. */
const domainOf: Record<string, string> = { acme: "links.acme.test", globex: "links.globex.test" }

/** Invoices on the app's own host, where people are signed in, rather than on the host that opens the link. */
const onApp: LinkRules = {
  ...options.subjects.invoice,
  url: ({ subjectId }) => `https://app.test/invoices/${subjectId}`
}

/**
 * The app answers on app.test; each organization's domain opens its own links, and other hosts open none. `seen` gets
 * each host `resolve` is asked about and each organization `origin` is asked about.
 */
function hostsFor(seen: { hosts: string[]; orgs: (string | null)[] } = { hosts: [], orgs: [] }): LinkHosts {
  return {
    resolve: ({ hostname }) => {
      seen.hosts.push(hostname)
      if (hostname === "app.test") {
        return "app"
      }
      const orgId = Object.keys(domainOf).find((org) => domainOf[org] === hostname)
      return orgId === undefined ? null : { orgId }
    },
    origin: ({ orgId }) => {
      seen.orgs.push(orgId)
      const domain = orgId === null ? undefined : domainOf[orgId]
      return domain === undefined ? null : `https://${domain}`
    }
  }
}

/** Opens a link on a host, the way a browser does, with the cookie it holds. */
async function openOn(t: ReturnType<typeof setup>, host: string, code: string, cookie?: string) {
  const kept: Promise<unknown>[] = []
  const response = await t.app.handler(
    new Request(`https://${host}/s/${code}`, { headers: cookie ? { cookie } : {} }),
    { waitUntil: (promise) => kept.push(promise) }
  )
  await Promise.all(kept)
  return { response }
}

describe("organizations' domains", () => {
  it("open an organization's links, which are shared on its domain", async () => {
    const seen = { hosts: [] as string[], orgs: [] as (string | null)[] }
    const t = setup({ baseUrl: "https://app.test", hosts: hostsFor(seen) })
    const link = await t.api.create({ target: docs }, t.as("ada"))
    expect(link).toMatchObject({
      owner: { type: "org", id: "acme" },
      shortUrl: `https://links.acme.test/s/${link.code}`
    })
    expect(t.events("link.created")[0]?.data).toMatchObject({ link: { shortUrl: link.shortUrl } })
    const onDomain = await openOn(t, "links.acme.test", link.code)
    expect(onDomain.response.status).toBe(302)
    expect(onDomain.response.headers.get("location")).toBe(docs.url)
    // The app's own host opens every link, such as ones shared before the domain was set up.
    expect((await openOn(t, "app.test", link.code)).response.status).toBe(302)
    // A host with a trailing dot is the same host.
    expect((await openOn(t, "links.acme.test.", link.code)).response.status).toBe(302)
    expect(seen.hosts).toEqual(["links.acme.test", "app.test", "links.acme.test"])
    await t.api.create({ target: { url: "https://docs.test/two" } }, t.as("ada"))
    seen.orgs.length = 0
    const { links } = await t.api.list({}, t.as("ada"))
    expect(links.map((entry) => new URL(entry.shortUrl).host)).toEqual(["links.acme.test", "links.acme.test"])
    expect(seen.orgs).toEqual(["acme"])
    expect((await t.api.get({ code: link.code }, t.as("ada"))).clicks).toBe(3)
  })

  it("answer another organization's link, and any link on a host they don't know, as a missing one", async () => {
    const t = setup({ baseUrl: "https://app.test", hosts: hostsFor() })
    const link = await t.api.create({ target: docs }, t.as("ada"))
    const missing = await openOn(t, "links.globex.test", "missing1")
    const wrongOrg = await openOn(t, "links.globex.test", link.code)
    const unknown = await openOn(t, "pending.acme.test", link.code)
    for (const { response } of [wrongOrg, unknown]) {
      expect(response.status).toBe(404)
      expect(await response.text()).toBe(await missing.response.clone().text())
    }
    expect((await t.api.get({ code: link.code }, t.as("ada"))).clicks).toBe(0)
  })

  it("keep a person's links on the app's host, even when an action is called from a domain", async () => {
    const seen = { hosts: [] as string[], orgs: [] as (string | null)[] }
    const t = setup({ baseUrl: "https://app.test", hosts: hostsFor(seen) })
    // Cy is a member who doesn't manage Acme's links, so this one is Cy's own, and `origin` isn't asked about it.
    const member = await t.api.create({ target: docs }, t.as("cy"))
    expect(seen.orgs).toEqual([])
    // Solo isn't in any organization, so `origin` is asked about links outside any.
    const solo = await t.api.create({ target: docs }, t.as("solo"))
    expect(seen.orgs).toEqual([null])
    for (const link of [member, solo]) {
      expect(link.owner.type).toBe("user")
      expect(link.shortUrl).toBe(`https://app.test/s/${link.code}`)
      expect((await openOn(t, "links.acme.test", link.code)).response.status).toBe(404)
      expect((await openOn(t, "app.test", link.code)).response.status).toBe(302)
    }
    // Made through Acme's domain, Cy's link is still shared on the app's host, which opens it, and Ada's on the domain.
    const fromDomain = (userId: "cy" | "ada") =>
      t.app.handler(
        new Request("https://links.acme.test/api/apps/shortLinks/create", {
          method: "POST",
          headers: { "content-type": "application/json", ...t.identity.headers(userId) },
          body: JSON.stringify({ target: docs })
        })
      )
    const cys = (await (await fromDomain("cy")).json()) as ShortLink
    expect(cys.shortUrl).toBe(`https://app.test/s/${cys.code}`)
    const adas = (await (await fromDomain("ada")).json()) as ShortLink
    expect(adas.shortUrl).toBe(`https://links.acme.test/s/${adas.code}`)
  })

  it("open a link that grants access on the record's host when the cookie can't reach it from the domain", async () => {
    const t = setup({
      baseUrl: "https://app.test",
      hosts: hostsFor(),
      subjects: { ...options.subjects, invoice: onApp }
    })
    const link = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    expect(link.shortUrl).toBe(`https://app.test/s/${link.code}`)
    // Opened on the domain anyway, it goes to the same link on the app's host, which sets the cookie there.
    const onDomain = await openOn(t, "links.acme.test", link.code)
    expect(onDomain.response.headers.get("location")).toBe(`https://app.test/s/${link.code}`)
    expect(onDomain.response.headers.get("set-cookie")).toBeNull()
    const onAppHost = await openOn(t, "app.test", link.code)
    // The click counts once, where the cookie was set.
    expect((await t.api.get({ code: link.code }, t.as("ada"))).clicks).toBe(1)
    expect(onAppHost.response.headers.get("location")).toBe("https://app.test/invoices/inv-1")
    expect(cookieOf(onAppHost.response)).toBe(`better-apps-links=${link.code}`)
    // Records the domain serves itself are reached from it, so such links are shared there.
    const local = setup({ baseUrl: "https://app.test", hosts: hostsFor() })
    const there = await local.api.create({ target: inv1, grantsView: true }, local.as("ada"))
    expect(there.shortUrl).toBe(`https://links.acme.test/s/${there.code}`)
    const opened = await openOn(local, "links.acme.test", there.code)
    expect(opened.response.headers.get("location")).toBe("https://links.acme.test/invoices/inv-1")
    expect(opened.response.headers.get("set-cookie")).toContain(there.code)
  })

  it("share a link that grants access on a subdomain whose cookie domain reaches the app's host", async () => {
    const t = setup({
      baseUrl: "https://app.test",
      subjects: { ...options.subjects, invoice: onApp },
      cookie: { domain: "app.test" },
      hosts: {
        resolve: ({ hostname }) =>
          ({ "app.test": "app" as const, "acme.app.test": { orgId: "acme" } })[hostname] ?? null,
        origin: ({ orgId }) => (orgId === "acme" ? "https://acme.app.test/ignored/path" : null)
      }
    })
    const link = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    expect(link.shortUrl).toBe(`https://acme.app.test/s/${link.code}`)
    const opened = await openOn(t, "acme.app.test", link.code)
    expect(opened.response.headers.get("location")).toBe("https://app.test/invoices/inv-1")
    expect(opened.response.headers.get("set-cookie")).toContain("; Domain=app.test;")
  })

  it("set the cookie for a domain outside the cookie domain on that host alone, without sending it in circles", async () => {
    const t = setup({ baseUrl: "https://app.test", cookie: { domain: "app.test" }, hosts: hostsFor() })
    // The invoice's page is a path, so Acme's own domain serves it, and the link is shared there.
    const local = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    expect(local.shortUrl).toBe(`https://links.acme.test/s/${local.code}`)
    const onDomain = await openOn(t, "links.acme.test", local.code)
    expect(onDomain.response.headers.get("location")).toBe("https://links.acme.test/invoices/inv-1")
    expect(onDomain.response.headers.get("set-cookie")).toContain(local.code)
    expect(onDomain.response.headers.get("set-cookie")).not.toContain("Domain=")
    const onAppHost = await openOn(t, "app.test", local.code)
    expect(onAppHost.response.headers.get("set-cookie")).toContain("; Domain=app.test;")
    // A record on the app's host is one hop away from the domain, and no further.
    const remote = setup({
      baseUrl: "https://app.test",
      cookie: { domain: "app.test" },
      hosts: hostsFor(),
      subjects: { ...options.subjects, invoice: onApp }
    })
    const link = await remote.api.create({ target: inv1, grantsView: true }, remote.as("ada"))
    expect(link.shortUrl).toBe(`https://app.test/s/${link.code}`)
    const hop = await openOn(remote, "links.acme.test", link.code)
    expect(hop.response.headers.get("location")).toBe(`https://app.test/s/${link.code}`)
    const landed = await openOn(remote, "app.test", link.code)
    expect(landed.response.headers.get("location")).toBe("https://app.test/invoices/inv-1")
    expect(landed.response.headers.get("set-cookie")).toContain("; Domain=app.test;")
  })

  it("share a link that grants access on an organization's domain that serves the record itself", async () => {
    // A white-label app: each organization's invoices are on its own billing domain, which no cookie domain covers.
    const billing: LinkRules = {
      ...options.subjects.invoice,
      url: ({ subjectId, orgId }) => `https://billing.${orgId ?? "app"}.test/invoices/${subjectId}`
    }
    const origins: Record<string, string> = { acme: "https://billing.acme.test", globex: "https://links.globex.test" }
    const t = setup({
      baseUrl: "https://app.test",
      subjects: { ...options.subjects, invoice: billing },
      hosts: {
        resolve: ({ hostname }) =>
          ({ "app.test": "app" as const, "billing.acme.test": { orgId: "acme" } })[hostname] ?? null,
        origin: ({ orgId }) => origins[orgId ?? ""] ?? null
      }
    })
    const link = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    expect(link.shortUrl).toBe(`https://billing.acme.test/s/${link.code}`)
    const opened = await openOn(t, "billing.acme.test", link.code)
    expect(opened.response.headers.get("location")).toBe("https://billing.acme.test/invoices/inv-1")
    expect(opened.response.headers.get("set-cookie")).toContain(link.code)
    // Opened on the app's host, which can't reach the billing domain, it goes to the same link there.
    const onApp = await openOn(t, "app.test", link.code)
    expect(onApp.response.headers.get("location")).toBe(`https://billing.acme.test/s/${link.code}`)
    // Globex's links are shared on a domain that doesn't serve its invoices, and the app's host doesn't either, so a link
    // that grants access is refused.
    const refused = t.api.create(
      { target: { subjectType: "invoice", subjectId: "inv-globex" }, grantsView: true },
      t.as("gus")
    )
    await expect(refused).rejects.toMatchObject({ code: "INVALID_INPUT" })
  })

  it("send a visitor on to baseUrl when it reaches the record and the record's host doesn't open links", async () => {
    // Links open on go.example.test, records are on app.example.test, and the cookie domain covers both.
    const t = setup({
      baseUrl: "https://go.example.test",
      cookie: { domain: "example.test" },
      subjects: {
        ...options.subjects,
        invoice: { ...onApp, url: ({ subjectId }) => `https://app.example.test/invoices/${subjectId}` }
      },
      hosts: {
        resolve: ({ hostname }) =>
          ({ "go.example.test": "app" as const, "links.acme.test": { orgId: "acme" } })[hostname] ?? null,
        origin: ({ orgId }) => (orgId === "acme" ? "https://links.acme.test" : null)
      }
    })
    const link = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    expect(link.shortUrl).toBe(`https://go.example.test/s/${link.code}`)
    const hop = await openOn(t, "links.acme.test", link.code)
    expect(hop.response.headers.get("location")).toBe(`https://go.example.test/s/${link.code}`)
    expect((await openOn(t, "app.example.test", link.code)).response.status).toBe(404)
    const landed = await openOn(t, "go.example.test", link.code)
    expect(landed.response.headers.get("location")).toBe("https://app.example.test/invoices/inv-1")
    expect(landed.response.headers.get("set-cookie")).toContain("; Domain=example.test;")
  })

  it("ask each record's url once per call when writing short URLs", async () => {
    const asked: string[] = []
    const invoice: LinkRules = {
      ...options.subjects.invoice,
      url: ({ subjectId }) => {
        asked.push(subjectId)
        return `/invoices/${subjectId}`
      }
    }
    const t = setup({ baseUrl: "https://app.test", hosts: hostsFor(), subjects: { ...options.subjects, invoice } })
    for (const target of [inv1, inv1, inv1, { subjectType: "invoice", subjectId: "inv-2" } as const]) {
      await t.api.create({ target, grantsView: true }, t.as("ada"))
    }
    asked.length = 0
    const { links } = await t.api.list({}, t.as("ada"))
    expect(links).toHaveLength(4)
    expect([...asked].sort()).toEqual(["inv-1", "inv-2"])
  })

  it("open every link on every host without hosts", async () => {
    const t = setup({ baseUrl: "https://app.test" })
    const link = await t.api.create({ target: docs }, t.as("ada"))
    expect(link.shortUrl).toBe(`https://app.test/s/${link.code}`)
    expect((await openOn(t, "links.acme.test", link.code)).response.status).toBe(302)
    expect((await openOn(t, "anything.test", link.code)).response.status).toBe(302)
  })

  it("refuse a setup without resolve or baseUrl, and an origin that isn't one", async () => {
    expect(() => shortLinks({ baseUrl: "https://app.test", hosts: {} as LinkHosts })).toThrow(
      "`hosts.resolve` must be a function"
    )
    expect(() => shortLinks({ hosts: hostsFor() })).toThrow("need `baseUrl`")
    const t = setup({ baseUrl: "https://app.test", hosts: { resolve: () => "app", origin: () => "links.acme.test" } })
    await expect(t.api.create({ target: docs }, t.as("ada"))).rejects.toThrow("isn't an http or https origin")
    // Checked as baseUrl is, so an http URL without its slashes isn't taken as one.
    const slashless = setup({
      baseUrl: "https://app.test",
      hosts: { resolve: () => "app", origin: () => "http:links.acme.test" }
    })
    await expect(slashless.api.create({ target: docs }, slashless.as("ada"))).rejects.toThrow(
      "isn't an http or https origin"
    )
  })
})
