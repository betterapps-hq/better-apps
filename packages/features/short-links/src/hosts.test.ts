import { describe, expect, it } from "vite-plus/test"
import { cookieOf, expectCode, options, setup } from "../test/app.js"
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
  return { response, clicks: kept.length }
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
    // The link's code is Acme's, so the app's own host, whose codes are the app's, doesn't open it.
    expect((await openOn(t, "app.test", link.code)).response.status).toBe(404)
    // A host with a trailing dot is the same host.
    expect((await openOn(t, "links.acme.test.", link.code)).response.status).toBe(302)
    expect(seen.hosts).toEqual(["links.acme.test", "app.test", "links.acme.test"])
    await t.api.create({ target: { url: "https://docs.test/two" } }, t.as("ada"))
    seen.orgs.length = 0
    const { links } = await t.api.list({}, t.as("ada"))
    expect(links.map((entry) => new URL(entry.shortUrl ?? "").host)).toEqual(["links.acme.test", "links.acme.test"])
    expect(seen.orgs).toEqual(["acme"])
    expect((await t.api.get({ id: link.id }, t.as("ada"))).clicks).toBe(2)
  })

  it("answer another organization's link, and any link on a host they don't know, as a missing one", async () => {
    const t = setup({ baseUrl: "https://app.test", hosts: hostsFor() })
    const link = await t.api.create({ target: docs }, t.as("ada"))
    const missing = await openOn(t, "links.globex.test", "missing1")
    const wrongOrg = await openOn(t, "links.globex.test", link.code)
    const unknown = await openOn(t, "pending.acme.test", link.code)
    for (const { response, clicks } of [wrongOrg, unknown]) {
      expect(response.status).toBe(404)
      expect(clicks).toBe(0)
      expect(await response.text()).toBe(await missing.response.clone().text())
    }
    expect((await t.api.get({ id: link.id }, t.as("ada"))).clicks).toBe(0)
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

  it("make a link that grants access in the app's scope when the cookie can't reach the record from the domain", async () => {
    const t = setup({
      baseUrl: "https://app.test",
      hosts: hostsFor(),
      subjects: { ...options.subjects, invoice: onApp }
    })
    const link = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    expect(link.shortUrl).toBe(`https://app.test/s/${link.code}`)
    // Its code is the app's, so Acme's domain doesn't open it, and the app's host sets the cookie.
    expect((await openOn(t, "links.acme.test", link.code)).response.status).toBe(404)
    const onAppHost = await openOn(t, "app.test", link.code)
    expect(onAppHost.response.headers.get("location")).toBe("https://app.test/invoices/inv-1")
    expect(cookieOf(onAppHost.response)).toBe(`better-apps-links=${link.code}`)
    // Records the domain serves itself are reached from it, so such links are shared there.
    const local = setup({ baseUrl: "https://app.test", hosts: hostsFor() })
    const there = await local.api.create({ target: inv1, grantsView: true }, local.as("ada"))
    expect(there.shortUrl).toBe(`https://links.acme.test/s/${there.code}`)
    const opened = await openOn(local, "links.acme.test", there.code)
    expect(opened.response.headers.get("location")).toBe("https://links.acme.test/invoices/inv-1")
    expect(cookieOf(opened.response)).toBe(`better-apps-links=${there.code}~${btoa("acme").replace(/=+$/, "")}`)
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
  })

  it("send a link in the app's scope from another of the app's hosts to baseUrl, one hop and no further", async () => {
    // A workspace's domain in an app without organizations opens the app's links, but no cookie domain covers it.
    const t = setup({
      baseUrl: "https://app.test",
      cookie: { domain: "app.test" },
      subjects: { ...options.subjects, invoice: onApp },
      hosts: { resolve: ({ hostname }) => (["app.test", "go.workspace.test"].includes(hostname) ? "app" : null) }
    })
    const link = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    expect(link.shortUrl).toBe(`https://app.test/s/${link.code}`)
    const hop = await openOn(t, "go.workspace.test", link.code)
    expect(hop.response.headers.get("location")).toBe(`https://app.test/s/${link.code}`)
    expect(hop.response.headers.get("set-cookie")).toBeNull()
    expect(hop.clicks).toBe(0)
    const landed = await openOn(t, "app.test", link.code)
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
          ({
            "app.test": "app" as const,
            "billing.acme.test": { orgId: "acme" },
            "links.acme.test": { orgId: "acme" },
            "links.globex.test": { orgId: "globex" }
          })[hostname] ?? null,
        origin: ({ orgId }) => origins[orgId ?? ""] ?? null
      }
    })
    const link = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    expect(link.shortUrl).toBe(`https://billing.acme.test/s/${link.code}`)
    const opened = await openOn(t, "billing.acme.test", link.code)
    expect(opened.response.headers.get("location")).toBe("https://billing.acme.test/invoices/inv-1")
    expect(opened.response.headers.get("set-cookie")).toContain(link.code)
    // Opened on Acme's other domain, which can't reach the billing domain, it goes to the same link there.
    const onOther = await openOn(t, "links.acme.test", link.code)
    expect(onOther.response.headers.get("location")).toBe(`https://billing.acme.test/s/${link.code}`)
    expect(onOther.clicks).toBe(0)
    // The app's host doesn't open Acme's codes.
    expect((await openOn(t, "app.test", link.code)).response.status).toBe(404)
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
          ({ "go.example.test": "app" as const, "go.workspace.test": "app" as const })[hostname] ?? null
      }
    })
    const link = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    expect(link.shortUrl).toBe(`https://go.example.test/s/${link.code}`)
    const hop = await openOn(t, "go.workspace.test", link.code)
    expect(hop.response.headers.get("location")).toBe(`https://go.example.test/s/${link.code}`)
    expect((await openOn(t, "app.example.test", link.code)).response.status).toBe(404)
    const landed = await openOn(t, "go.example.test", link.code)
    expect(landed.response.headers.get("location")).toBe("https://app.example.test/invoices/inv-1")
    expect(landed.response.headers.get("set-cookie")).toContain("; Domain=example.test;")
  })

  it("ask each record's url once per call when writing short URLs, and none for links in an organization's scope", async () => {
    const asked: string[] = []
    const asking = (rules: LinkRules): LinkRules => ({
      ...rules,
      url: (args) => {
        asked.push(args.subjectId)
        return rules.url(args)
      }
    })
    const t = setup({
      baseUrl: "https://app.test",
      // Links outside any organization are shared on a host of the app's when the cookie reaches the record from there.
      hosts: {
        ...hostsFor(),
        origin: ({ orgId }) => (orgId === null ? "https://app.test" : `https://${domainOf[orgId] ?? ""}`)
      },
      subjects: {
        ...options.subjects,
        invoice: asking(options.subjects.invoice),
        document: asking(options.subjects.document)
      }
    })
    for (const target of [inv1, inv1, { subjectType: "invoice", subjectId: "inv-2" } as const]) {
      await t.api.create({ target, grantsView: true }, t.as("ada"))
    }
    const doc = { subjectType: "document", subjectId: "doc-1" } as const
    for (const target of [doc, doc]) {
      await t.api.create({ target, grantsView: true }, t.as("solo"))
    }
    asked.length = 0
    expect((await t.api.list({}, t.as("ada"))).links).toHaveLength(3)
    expect(asked).toEqual([])
    expect((await t.api.list({}, t.as("solo"))).links).toHaveLength(2)
    expect(asked).toEqual(["doc-1"])
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

/** Hosts whose organizations' domains can change while a test runs, the way they do when one is set up or removed. */
function changingHosts(domains: Record<string, string>): LinkHosts {
  return {
    resolve: ({ hostname }) => {
      if (hostname === "app.test") {
        return "app"
      }
      const orgId = Object.keys(domains).find((org) => domains[org] === hostname)
      return orgId === undefined ? null : { orgId }
    },
    origin: ({ orgId }) => {
      const domain = orgId === null ? undefined : domains[orgId]
      return domain === undefined ? null : `https://${domain}`
    }
  }
}

const pricing = (url: string) => ({ target: { url }, code: "pricing" })

describe("codes on organizations' domains", () => {
  it("let two organizations have the same code, each on its own domain", async () => {
    const t = setup({ baseUrl: "https://app.test", hosts: hostsFor() })
    const acmes = await t.api.create(pricing("https://acme.test/pricing"), t.as("ada"))
    const globexs = await t.api.create(pricing("https://globex.test/pricing"), t.as("gus"))
    expect([acmes.shortUrl, globexs.shortUrl]).toEqual([
      "https://links.acme.test/s/pricing",
      "https://links.globex.test/s/pricing"
    ])
    const onAcme = await openOn(t, "links.acme.test", "Pricing")
    expect(onAcme.response.headers.get("location")).toBe("https://acme.test/pricing")
    const onGlobex = await openOn(t, "links.globex.test", "pricing")
    expect(onGlobex.response.headers.get("location")).toBe("https://globex.test/pricing")
    expect((await t.api.get({ id: acmes.id }, t.as("ada"))).clicks).toBe(1)
    expect((await t.api.get({ id: globexs.id }, t.as("gus"))).clicks).toBe(1)
  })

  it("say a code is taken only within the caller's scope", async () => {
    const t = setup({ baseUrl: "https://app.test", hosts: hostsFor() })
    await t.api.create(pricing("https://acme.test/pricing"), t.as("ada"))
    // Taken among Acme's codes, in any case.
    await expectCode(t.api.create(pricing("https://acme.test/again"), t.as("ada")), "CONFLICT")
    await expectCode(t.api.create({ target: docs, code: "PRICING" }, t.as("ada")), "CONFLICT")
    // Acme's code tells Globex and the app's own scope nothing.
    await t.api.create(pricing("https://globex.test/pricing"), t.as("gus"))
    const solos = await t.api.create(pricing("https://solo.test/pricing"), t.as("solo"))
    expect(solos.shortUrl).toBe("https://app.test/s/pricing")
    // A member's own link is in the app's scope, where Solo has the code.
    await expectCode(t.api.create(pricing("https://acme.test/mine"), t.as("cy")), "CONFLICT")
  })

  it("open only the app's codes on the app's host", async () => {
    const t = setup({ baseUrl: "https://app.test", hosts: hostsFor() })
    await t.api.create(pricing("https://acme.test/pricing"), t.as("ada"))
    const missing = await openOn(t, "app.test", "missing1")
    const acmes = await openOn(t, "app.test", "pricing")
    expect(acmes.response.status).toBe(404)
    expect(acmes.clicks).toBe(0)
    expect(await acmes.response.text()).toBe(await missing.response.text())
    await t.api.create(pricing("https://solo.test/pricing"), t.as("solo"))
    const solos = await openOn(t, "app.test", "pricing")
    expect(solos.response.headers.get("location")).toBe("https://solo.test/pricing")
    // And a domain opens only its organization's codes, not the app's.
    expect((await openOn(t, "links.globex.test", "pricing")).response.status).toBe(404)
  })

  it("keep links made before an organization's domain was ready on the app's host", async () => {
    const domains: Record<string, string> = {}
    const t = setup({ baseUrl: "https://app.test", hosts: changingHosts(domains) })
    const before = await t.api.create(pricing("https://acme.test/before"), t.as("ada"))
    expect(before.shortUrl).toBe("https://app.test/s/pricing")
    domains.acme = "links.acme.test"
    // The link keeps its code and its short URL, and the app's host still opens it, but the new domain doesn't.
    expect((await t.api.get({ id: before.id }, t.as("ada"))).shortUrl).toBe("https://app.test/s/pricing")
    expect((await openOn(t, "app.test", "pricing")).response.headers.get("location")).toBe("https://acme.test/before")
    expect((await openOn(t, "links.acme.test", "pricing")).response.status).toBe(404)
    // A new link goes on the domain, where the code is free, and each host opens its own.
    const after = await t.api.create(pricing("https://acme.test/after"), t.as("ada"))
    expect(after.shortUrl).toBe("https://links.acme.test/s/pricing")
    expect((await openOn(t, "links.acme.test", "pricing")).response.headers.get("location")).toBe(
      "https://acme.test/after"
    )
    expect((await openOn(t, "app.test", "pricing")).response.headers.get("location")).toBe("https://acme.test/before")
  })

  it("open an organization's links nowhere while it has no ready domain, and on whichever it has next", async () => {
    const domains: Record<string, string> = { acme: "links.acme.test" }
    const t = setup({ baseUrl: "https://app.test", hosts: changingHosts(domains) })
    const link = await t.api.create(pricing("https://acme.test/pricing"), t.as("ada"))
    delete domains.acme
    expect((await t.api.get({ id: link.id }, t.as("ada"))).shortUrl).toBeNull()
    expect((await openOn(t, "links.acme.test", "pricing")).response.status).toBe(404)
    expect((await openOn(t, "app.test", "pricing")).response.status).toBe(404)
    // Meanwhile Acme's new links go in the app's scope, where the code is free too.
    const meanwhile = await t.api.create(pricing("https://acme.test/meanwhile"), t.as("ada"))
    expect(meanwhile.shortUrl).toBe("https://app.test/s/pricing")
    domains.acme = "go.acme.test"
    expect((await t.api.get({ id: link.id }, t.as("ada"))).shortUrl).toBe("https://go.acme.test/s/pricing")
    expect((await openOn(t, "go.acme.test", "pricing")).response.headers.get("location")).toBe(
      "https://acme.test/pricing"
    )
    expect((await openOn(t, "app.test", "pricing")).response.headers.get("location")).toBe(
      "https://acme.test/meanwhile"
    )
  })

  it("let one person manage two links with the same code, by their ids", async () => {
    const t = setup({ baseUrl: "https://app.test", hosts: hostsFor() })
    const orgs = await t.api.create(pricing("https://acme.test/pricing"), t.as("ada"))
    const own = await t.api.create({ ...pricing("https://ada.test/pricing"), owner: "user" }, t.as("ada"))
    expect([orgs.shortUrl, own.shortUrl]).toEqual(["https://links.acme.test/s/pricing", "https://app.test/s/pricing"])
    expect((await t.api.list({}, t.as("ada"))).links.map((link) => link.id).sort()).toEqual([orgs.id, own.id].sort())
    await t.api.update({ id: own.id, enabled: false }, t.as("ada"))
    expect((await t.api.get({ id: orgs.id }, t.as("ada"))).enabled).toBe(true)
    expect((await openOn(t, "links.acme.test", "pricing")).response.status).toBe(302)
    expect((await openOn(t, "app.test", "pricing")).response.status).toBe(404)
    expect(await t.api.remove({ id: orgs.id }, t.as("ada"))).toEqual({ removed: true })
    expect((await t.api.get({ id: own.id }, t.as("ada"))).code).toBe("pricing")
  })

  it("keep every code unique across the app, and open it on every host, without hosts", async () => {
    const t = setup({ baseUrl: "https://app.test" })
    const acmes = await t.api.create(pricing("https://acme.test/pricing"), t.as("ada"))
    expect(acmes.shortUrl).toBe("https://app.test/s/pricing")
    await expectCode(t.api.create(pricing("https://globex.test/pricing"), t.as("gus")), "CONFLICT")
    for (const host of ["app.test", "links.acme.test", "links.globex.test"]) {
      expect((await openOn(t, host, "pricing")).response.headers.get("location")).toBe("https://acme.test/pricing")
    }
  })
})
