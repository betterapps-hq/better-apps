import { describe, expect, it } from "vite-plus/test"
import { cookieOf, options, setup } from "../test/app.js"
import { shortLinks, type LinkHosts, type LinkRules } from "./index.js"

const inv1 = { subjectType: "invoice", subjectId: "inv-1" } as const
const docs = { url: "https://docs.test/start" }

/** Each organization's verified domain, as an app would read it from the domains feature. */
const domainOf: Record<string, string> = { acme: "links.acme.test", globex: "links.globex.test" }

/** The app answers on app.test; each organization's domain opens its own links, and other hosts open none. */
function hostsFor(asked: string[] = []): LinkHosts {
  return {
    resolve: ({ hostname }) => {
      if (hostname === "app.test") {
        return "app"
      }
      const orgId = Object.keys(domainOf).find((org) => domainOf[org] === hostname)
      return orgId === undefined ? null : { orgId }
    },
    origin: ({ owner }) => {
      asked.push(`${owner.type}:${owner.id}`)
      const domain = owner.type === "org" ? domainOf[owner.id] : undefined
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
    const asked: string[] = []
    const t = setup({ baseUrl: "https://app.test", hosts: hostsFor(asked) })
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
    await t.api.create({ target: { url: "https://docs.test/two" } }, t.as("ada"))
    asked.length = 0
    const { links } = await t.api.list({}, t.as("ada"))
    expect(links.map((entry) => new URL(entry.shortUrl).host)).toEqual(["links.acme.test", "links.acme.test"])
    expect(asked).toEqual(["org:acme"])
    expect((await t.api.get({ code: link.code }, t.as("ada"))).clicks).toBe(2)
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
    expect((await t.api.get({ code: link.code }, t.as("ada"))).clicks).toBe(0)
  })

  it("keep a person's links on the app's host", async () => {
    const t = setup({ baseUrl: "https://app.test", hosts: hostsFor() })
    // Cy is a member who doesn't manage Acme's links, so this one is Cy's own. Solo isn't in any organization.
    const member = await t.api.create({ target: docs }, t.as("cy"))
    const solo = await t.api.create({ target: docs }, t.as("solo"))
    for (const link of [member, solo]) {
      expect(link.owner.type).toBe("user")
      expect(link.shortUrl).toBe(`https://app.test/s/${link.code}`)
      expect((await openOn(t, "links.acme.test", link.code)).response.status).toBe(404)
      expect((await openOn(t, "app.test", link.code)).response.status).toBe(302)
    }
  })

  it("open a link that grants access on the record's host when the cookie can't reach it from the domain", async () => {
    const onApp: LinkRules = {
      ...options.subjects.invoice,
      url: ({ subjectId }) => `https://app.test/invoices/${subjectId}`
    }
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
    expect(onDomain.clicks).toBe(0)
    const onApp2 = await openOn(t, "app.test", link.code)
    expect(onApp2.response.headers.get("location")).toBe("https://app.test/invoices/inv-1")
    expect(cookieOf(onApp2.response)).toBe(`better-apps-links=${link.code}`)
    // Records the domain serves itself are reached from it, so such links are shared there.
    const local = setup({ baseUrl: "https://app.test", hosts: hostsFor() })
    const there = await local.api.create({ target: inv1, grantsView: true }, local.as("ada"))
    expect(there.shortUrl).toBe(`https://links.acme.test/s/${there.code}`)
    const opened = await openOn(local, "links.acme.test", there.code)
    expect(opened.response.headers.get("location")).toBe("https://links.acme.test/invoices/inv-1")
    expect(opened.response.headers.get("set-cookie")).toContain(there.code)
  })

  it("share a link that grants access on a subdomain whose cookie domain reaches the app's host", async () => {
    const onApp: LinkRules = {
      ...options.subjects.invoice,
      url: ({ subjectId }) => `https://app.test/invoices/${subjectId}`
    }
    const t = setup({
      subjects: { ...options.subjects, invoice: onApp },
      cookie: { domain: "app.test" },
      hosts: {
        resolve: ({ hostname }) =>
          ({ "app.test": "app" as const, "acme.app.test": { orgId: "acme" } })[hostname] ?? null,
        origin: ({ owner }) =>
          owner.type === "org" && owner.id === "acme" ? "https://acme.app.test/ignored/path" : null
      }
    })
    const link = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    expect(link.shortUrl).toBe(`https://acme.app.test/s/${link.code}`)
    const opened = await openOn(t, "acme.app.test", link.code)
    expect(opened.response.headers.get("location")).toBe("https://app.test/invoices/inv-1")
    expect(opened.response.headers.get("set-cookie")).toContain("; Domain=app.test;")
  })

  it("open every link on every host without hosts", async () => {
    const t = setup({ baseUrl: "https://app.test" })
    const link = await t.api.create({ target: docs }, t.as("ada"))
    expect(link.shortUrl).toBe(`https://app.test/s/${link.code}`)
    expect((await openOn(t, "links.acme.test", link.code)).response.status).toBe(302)
    expect((await openOn(t, "anything.test", link.code)).response.status).toBe(302)
  })

  it("refuse a setup without resolve, and an origin that isn't one", async () => {
    expect(() => shortLinks({ hosts: {} as LinkHosts })).toThrow("`hosts.resolve` must be a function")
    const t = setup({ hosts: { resolve: () => "app", origin: () => "links.acme.test" } })
    await expect(t.api.create({ target: docs }, t.as("ada"))).rejects.toThrow("isn't an http or https origin")
  })
})
