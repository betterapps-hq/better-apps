import { describe, expect, it } from "vite-plus/test"
import { cookieOf, expectCode, invoices, setup } from "../test/app.js"
import { generateCode, isValidCode, linkModel, shortLinks } from "./index.js"

const inv1 = { subjectType: "invoice", subjectId: "inv-1" } as const
const docs = { url: "https://docs.test/start" }
const tomorrow = () => new Date(Date.now() + 24 * 60 * 60_000)

describe("codes", () => {
  it("are random letters and digits of the asked length", () => {
    const codes = Array.from({ length: 200 }, () => generateCode())
    expect(codes.every((code) => /^[A-Za-z0-9]{8}$/.test(code))).toBe(true)
    expect(new Set(codes).size).toBe(200)
    expect(generateCode(32)).toHaveLength(32)
    // Every character turns up, so none is left out of the alphabet.
    expect(new Set(Array.from({ length: 100 }, () => generateCode(32)).join("")).size).toBe(62)
  })

  it("allow custom codes of letters, digits, - and _", () => {
    expect(["a", "spring-sale", "Q4_report", "x".repeat(64)].every(isValidCode)).toBe(true)
    expect(["", "a b", "café", "a/b", "a.b", "x".repeat(65)].some(isValidCode)).toBe(false)
  })
})

describe("short links options", () => {
  it("refuse setups that can't work", () => {
    expect(() => shortLinks({ path: "s" })).toThrow("must start with /")
    expect(() => shortLinks({ path: "/s/" })).toThrow("trailing /")
    expect(() => shortLinks({ codeLength: 5 })).toThrow("`codeLength`")
    expect(() => shortLinks({ codeLength: 7.5 })).toThrow("`codeLength`")
    expect(() => shortLinks({ baseUrl: "go.example.com" })).toThrow("`baseUrl`")
    expect(() => shortLinks({ baseUrl: "ftp://go.example.com" })).toThrow("`baseUrl`")
    expect(() => shortLinks({ cookie: { name: "a b" } })).toThrow("cookie name")
    expect(() => shortLinks({ cookie: { maxAge: 0 } })).toThrow("`maxAge`")
  })
})

describe("create", () => {
  it("makes a link to a URL, owned by the actor's organization, with a short URL from the request", async () => {
    const { api, as, post, events } = setup()
    const link = await api.create({ target: docs }, as("ada"))
    expect(link).toMatchObject({
      owner: { type: "org", id: "acme" },
      orgId: "acme",
      createdBy: "ada",
      target: { type: "url", url: "https://docs.test/start" },
      grantsView: false,
      enabled: true,
      expiresAt: null,
      clicks: 0,
      lastClickedAt: null,
      shortUrl: `/s/${link.code}`
    })
    expect(link.code).toMatch(/^[A-Za-z0-9]{8}$/)
    expect(events("link.created")[0]?.data).toMatchObject({ link: { code: link.code } })

    const response = await post("create", { target: docs, owner: "user" }, "bob")
    const mine = (await response.json()) as { shortUrl: string; owner: unknown; code: string }
    expect(mine.owner).toEqual({ type: "user", id: "bob" })
    expect(mine.shortUrl).toBe(`https://app.test/s/${mine.code}`)
  })

  it("belongs to its maker outside any organization, and uses baseUrl and path for short URLs", async () => {
    const { api, as } = setup({ baseUrl: "https://go.test/", path: "/l" })
    const link = await api.create({ target: docs }, as("solo"))
    expect(link).toMatchObject({ owner: { type: "user", id: "solo" }, orgId: null })
    expect(link.shortUrl).toBe(`https://go.test/l/${link.code}`)
    await expectCode(api.create({ target: docs, owner: "org" }, as("solo")), "INVALID_INPUT")
  })

  it("needs someone signed in, even from server code", async () => {
    const { api, post } = setup()
    await expectCode(api.create({ target: docs }), "UNAUTHENTICATED")
    expect((await post("create", { target: docs })).status).toBe(401)
  })

  it("lets only managers make an organization's links", async () => {
    const { api, as } = setup()
    await expectCode(api.create({ target: docs }, as("cy")), "FORBIDDEN")
    expect((await api.create({ target: docs, owner: "user" }, as("cy"))).owner).toEqual({ type: "user", id: "cy" })
  })

  it("checks URLs: full ones only, no unsafe schemes, and what validateUrl says", async () => {
    const { api, as } = setup({
      validateUrl: ({ url }) => url.hostname !== "evil.test" && (url.protocol === "https:" || "Links must use https.")
    })
    await expectCode(api.create({ target: { url: "/relative" } }, as("ada")), "INVALID_INPUT")
    await expectCode(api.create({ target: { url: "javascript:alert(1)" } }, as("ada")), "INVALID_INPUT")
    await expectCode(api.create({ target: { url: "data:text/html,hi" } }, as("ada")), "INVALID_INPUT")
    await expectCode(api.create({ target: { url: "https://evil.test/" } }, as("ada")), "INVALID_INPUT")
    await expect(api.create({ target: { url: "http://docs.test/" } }, as("ada"))).rejects.toThrow(
      "Links must use https."
    )
    await expect(api.create({ target: { url: "https://evil.test/" } }, as("ada"))).rejects.toThrow(
      "That URL isn't allowed here."
    )
    const link = await api.create({ target: { url: "HTTPS://Docs.Test/a b" } }, as("ada"))
    expect(link.target).toEqual({ type: "url", url: "https://docs.test/a%20b" })
  })

  it("allows any URL but unsafe schemes without validateUrl", async () => {
    const { api, as } = setup()
    for (const url of ["mailto:ada@acme.test", "myapp://open/inv-1", "ftp://files.test/a"]) {
      expect((await api.create({ target: { url } }, as("ada"))).target).toEqual({ type: "url", url })
    }
    await expectCode(api.create({ target: { url: "vbscript:x" } }, as("ada")), "INVALID_INPUT")
    await expectCode(api.create({ target: { url: "file:///etc/passwd" } }, as("ada")), "INVALID_INPUT")
    await expectCode(
      api.create({ target: { url: `https://docs.test/${"a".repeat(2048)}` } }, as("ada")),
      "INVALID_INPUT"
    )
  })

  it("links to records the actor can see and may share", async () => {
    const { api, as } = setup()
    const link = await api.create({ target: inv1 }, as("bob"))
    expect(link.target).toEqual({ type: "subject", ...inv1 })
    await expectCode(api.create({ target: inv1 }, as("gus")), "NOT_FOUND")
    await expectCode(
      api.create({ target: { subjectType: "invoice", subjectId: "inv-locked" } }, as("ada")),
      "FORBIDDEN"
    )
    await expectCode(
      api.create({ target: { subjectType: "order" as "page", subjectId: "o-1" } }, as("ada")),
      "INVALID_INPUT"
    )
    // A page belongs to no organization, so anyone's organization may link to it.
    const page = await api.create({ target: { subjectType: "page", subjectId: "intro" } }, as("gus"))
    expect(page.owner).toEqual({ type: "org", id: "globex" })
  })

  it("takes a custom code, refusing malformed ones and ones that are taken", async () => {
    const { api, as } = setup()
    expect((await api.create({ target: docs, code: "spring-sale" }, as("ada"))).code).toBe("spring-sale")
    await expectCode(api.create({ target: docs, code: "spring-sale" }, as("bob")), "CONFLICT")
    await expectCode(api.create({ target: docs, code: "Spring sale" }, as("ada")), "INVALID_INPUT")
    // Codes are case-sensitive.
    expect((await api.create({ target: docs, code: "Spring-Sale" }, as("ada"))).code).toBe("Spring-Sale")
  })

  it("refuses an expiry that has passed", async () => {
    const { api, as } = setup()
    await expectCode(api.create({ target: docs, expiresAt: new Date(Date.now() - 1000) }, as("ada")), "INVALID_INPUT")
    const later = tomorrow()
    expect((await api.create({ target: docs, expiresAt: later.toISOString() }, as("ada"))).expiresAt).toEqual(later)
  })

  it("lets links grant access only to records, where the rules allow it, with codes too long to guess", async () => {
    const { api, as } = setup()
    const link = await api.create({ target: inv1, grantsView: true }, as("bob"))
    expect(link.grantsView).toBe(true)
    await expectCode(api.create({ target: docs, grantsView: true }, as("ada")), "INVALID_INPUT")
    await expectCode(api.create({ target: inv1, grantsView: true, owner: "user" }, as("cy")), "FORBIDDEN")
    await expectCode(api.create({ target: inv1, grantsView: true, code: "short" }, as("ada")), "INVALID_INPUT")
    expect((await api.create({ target: inv1, grantsView: true, code: "long-enough" }, as("ada"))).code).toBe(
      "long-enough"
    )
    await expectCode(
      api.create({ target: { subjectType: "page", subjectId: "intro" }, grantsView: true }, as("ada")),
      "FORBIDDEN"
    )
  })

  it("makes generated codes of links that grant access at least 8 characters", async () => {
    const { api, as } = setup({ codeLength: 6 })
    expect((await api.create({ target: docs }, as("ada"))).code).toHaveLength(6)
    expect((await api.create({ target: inv1, grantsView: true }, as("ada"))).code).toHaveLength(8)
  })
})

describe("opening a link", () => {
  it("redirects to a URL, temporarily and uncached, and counts the click after the response", async () => {
    const { api, as, open } = setup()
    const link = await api.create({ target: docs }, as("ada"))
    const { response, kept } = open(link.code)
    const answer = await response
    expect(answer.status).toBe(302)
    expect(answer.headers.get("location")).toBe("https://docs.test/start")
    expect(answer.headers.get("cache-control")).toBe("private, no-store")
    expect(answer.headers.get("set-cookie")).toBeNull()
    expect(kept).toHaveLength(1)
    await Promise.all(kept)
    const again = open(link.code)
    await again.response
    await Promise.all(again.kept)
    const clicked = await api.get({ code: link.code }, as("ada"))
    expect(clicked.clicks).toBe(2)
    expect(clicked.lastClickedAt).toBeInstanceOf(Date)
  })

  it("counts every click at the same moment, but not HEAD requests", async () => {
    const { api, as, open } = setup()
    const link = await api.create({ target: docs }, as("ada"))
    const opened = Array.from({ length: 5 }, () => open(link.code))
    await Promise.all(
      opened.map(async ({ response, kept }) => {
        await response
        await Promise.all(kept)
      })
    )
    const head = open(link.code, { method: "HEAD" })
    expect((await head.response).status).toBe(302)
    expect(head.kept).toHaveLength(0)
    expect((await api.get({ code: link.code }, as("ada"))).clicks).toBe(5)
  })

  it("sends a record link to the record's page, resolved against the link's address", async () => {
    const { api, as, open } = setup()
    const invoice = await api.create({ target: inv1 }, as("ada"))
    expect((await open(invoice.code).response).headers.get("location")).toBe("https://app.test/invoices/inv-1")
    const page = await api.create({ target: { subjectType: "page", subjectId: "intro" } }, as("ada"))
    expect((await open(page.code).response).headers.get("location")).toBe("https://docs.test/pages/intro")
  })

  it("answers 404 for links that don't exist, are off or have expired, without saying which", async () => {
    const { api, as, open, database } = setup()
    const off = await api.create({ target: docs }, as("ada"))
    await api.update({ code: off.code, enabled: false }, as("ada"))
    const expired = await api.create({ target: docs, expiresAt: tomorrow() }, as("ada"))
    database.sqlite.prepare("UPDATE shortLink SET expiresAt = ? WHERE code = ?").run(Date.now() - 1000, expired.code)
    const bodies = new Set<string>()
    for (const code of ["missing1", off.code, expired.code, "bad%20code"]) {
      const { response, kept } = open(code)
      const answer = await response
      expect(answer.status).toBe(404)
      expect(kept).toHaveLength(0)
      bodies.add(await answer.text())
    }
    expect(bodies.size).toBe(1)
  })

  it("lets the app answer links that don't open", async () => {
    const { open } = setup({ notFound: ({ code }) => new Response(`No ${code} here`, { status: 410 }) })
    const answer = await open("missing1").response
    expect(answer.status).toBe(410)
    expect(await answer.text()).toBe("No missing1 here")
  })
})

describe("access through a link", () => {
  const request = (cookie?: string) =>
    new Request("https://app.test/invoices/inv-1", { headers: cookie ? { cookie } : {} })

  it("lets anyone who opened the link see its record, until it's off, expired or removed", async () => {
    const { app, api, as, open } = setup()
    const link = await api.create({ target: inv1, grantsView: true }, as("ada"))
    const answer = await open(link.code).response
    const setCookie = answer.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("SameSite=Lax")
    expect(setCookie).toContain("Secure")
    expect(setCookie).toContain("Path=/")
    expect(setCookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`)
    const cookie = cookieOf(answer)
    expect(cookie).toBe(`better-apps-links=${link.code}`)

    const gus = as("gus").actor
    expect(await app.subjects.canView(null, inv1)).toBe(false)
    expect(await app.subjects.canView(null, inv1, { request: request() })).toBe(false)
    expect(await app.subjects.canView(null, inv1, { request: request(cookie) })).toBe(true)
    expect(await app.subjects.canView(gus, inv1, { request: request(cookie) })).toBe(true)
    expect(await app.subjects.canView(gus, inv1)).toBe(false)
    // Only the linked record.
    expect(await app.subjects.canView(null, { ...inv1, subjectId: "inv-2" }, { request: request(cookie) })).toBe(false)

    await api.update({ code: link.code, enabled: false }, as("ada"))
    expect(await app.subjects.canView(null, inv1, { request: request(cookie) })).toBe(false)
    await api.update({ code: link.code, enabled: true }, as("ada"))
    expect(await app.subjects.canView(null, inv1, { request: request(cookie) })).toBe(true)
    await api.remove({ code: link.code }, as("ada"))
    expect(await app.subjects.canView(null, inv1, { request: request(cookie) })).toBe(false)
  })

  it("grants nothing through links that don't grant access, have expired, or whose record moved", async () => {
    const { app, api, as, database } = setup()
    const plain = await api.create({ target: inv1 }, as("ada"))
    const expired = await api.create({ target: inv1, grantsView: true, expiresAt: tomorrow() }, as("ada"))
    database.sqlite.prepare("UPDATE shortLink SET expiresAt = ? WHERE code = ?").run(Date.now() - 1000, expired.code)
    const cookie = `better-apps-links=${plain.code}.${expired.code}`
    expect(await app.subjects.canView(null, inv1, { request: request(cookie) })).toBe(false)

    const moving = await api.create({ target: { ...inv1, subjectId: "inv-2" }, grantsView: true }, as("ada"))
    const movingRef = { subjectType: "invoice", subjectId: "inv-2" }
    const holder = request(`better-apps-links=${moving.code}`)
    expect(await app.subjects.canView(null, movingRef, { request: holder })).toBe(true)
    invoices.set("inv-2", { orgId: "globex" })
    try {
      expect(
        await app.subjects.canView(null, movingRef, { request: request(`better-apps-links=${moving.code}`) })
      ).toBe(false)
    } finally {
      invoices.set("inv-2", { orgId: "acme" })
    }
  })

  it("keeps the last 20 links opened in the cookie, without repeats, and isn't Secure over http", async () => {
    const { app, api, as } = setup()
    const link = await api.create({ target: inv1, grantsView: true }, as("ada"))
    const held = Array.from({ length: 25 }, (_, index) => `code${String(index).padStart(4, "0")}`)
    const answer = await app.handler(
      new Request(`http://app.test/s/${link.code}`, {
        headers: { cookie: `theme=dark; better-apps-links=${[...held, link.code].join(".")}` }
      })
    )
    const codes = cookieOf(answer).split("=")[1]?.split(".") ?? []
    expect(codes).toHaveLength(20)
    expect(codes.at(-1)).toBe(link.code)
    expect(codes.filter((code) => code === link.code)).toHaveLength(1)
    expect(answer.headers.get("set-cookie")).not.toContain("Secure")
  })

  it("reads the links once per request, whatever is checked", async () => {
    const { app, api, as, database } = setup()
    const link = await api.create({ target: inv1, grantsView: true }, as("ada"))
    const holder = request(`better-apps-links=${link.code}`)
    expect(await app.subjects.canView(null, inv1, { request: holder })).toBe(true)
    database.sqlite.prepare("DELETE FROM shortLink").run()
    // The same request still holds what it read.
    expect(await app.subjects.canView(null, inv1, { request: holder })).toBe(true)
    expect(await app.subjects.canView(null, inv1, { request: request(`better-apps-links=${link.code}`) })).toBe(false)
  })

  it("is off when no subject type lets links grant access", async () => {
    const feature = shortLinks({ subjects: { page: { url: () => "/" } } })
    expect(feature.grants).toBeUndefined()
  })
})

describe("managing links", () => {
  it("lists the caller's own links and their organization's, newest first, a page at a time", async () => {
    const { api, as } = setup()
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 9, 9, minute))
    const mine = await api.create({ target: docs, owner: "user" }, { ...as("cy"), createdAt: at(1) })
    const orgs = []
    for (let minute = 2; minute < 7; minute += 1) {
      orgs.push(await api.create({ target: inv1 }, { ...as("bob"), createdAt: at(minute) }))
    }
    await api.create({ target: docs, owner: "user" }, { ...as("bob"), createdAt: at(7) })
    await api.create({ target: docs }, { ...as("gus"), createdAt: at(8) })

    const first = await api.list({ limit: 4 }, as("ada"))
    expect(first.links.map((link) => link.code)).toEqual(
      orgs
        .map((link) => link.code)
        .reverse()
        .slice(0, 4)
    )
    const second = await api.list({ limit: 4, cursor: first.cursor ?? "" }, as("ada"))
    expect(second.links.map((link) => link.code)).toEqual([orgs[0]?.code])
    expect(second.cursor).toBeNull()

    // Cy manages none of the organization's links, so sees only their own.
    expect((await api.list({}, as("cy"))).links.map((link) => link.code)).toEqual([mine.code])
    expect((await api.list({ owner: "org" }, as("cy"))).links).toEqual([])
    expect((await api.list({ owner: "user" }, as("bob"))).links).toHaveLength(1)
    expect((await api.list({ ...inv1 }, as("bob"))).links).toHaveLength(5)
    expect((await api.list({ ...inv1 }, as("gus"))).links).toEqual([])
  })

  it("lets trusted server code list a record's links, and refuses incomplete filters and cursors", async () => {
    const { api, as, post } = setup()
    await api.create({ target: inv1 }, as("ada"))
    expect((await api.list({ ...inv1 })).links).toHaveLength(1)
    await expectCode(api.list({}), "INVALID_INPUT")
    await expectCode(api.list({ subjectType: "invoice" }, as("ada")), "INVALID_INPUT")
    await expectCode(api.list({ cursor: "nonsense" }, as("ada")), "INVALID_INPUT")
    expect((await post("list", {})).status).toBe(401)
  })

  it("lets only a link's managers read, change and remove it", async () => {
    const { api, as, post } = setup()
    const org = await api.create({ target: docs }, as("ada"))
    const own = await api.create({ target: docs, owner: "user" }, as("cy"))
    expect((await api.get({ code: org.code }, as("bob"))).code).toBe(org.code)
    await expectCode(api.get({ code: org.code }, as("cy")), "NOT_FOUND")
    await expectCode(api.get({ code: org.code }, as("gus")), "NOT_FOUND")
    await expectCode(api.get({ code: own.code }, as("ada")), "NOT_FOUND")
    expect((await api.get({ code: own.code }, as("cy"))).code).toBe(own.code)
    expect((await api.get({ code: own.code })).code).toBe(own.code)
    await expectCode(api.update({ code: org.code, enabled: false }, as("gus")), "NOT_FOUND")
    await expectCode(api.remove({ code: own.code }, as("bob")), "NOT_FOUND")
    expect((await post("get", { code: org.code })).status).toBe(401)
  })

  it("changes a link's URL, access, state and expiry, checking each like create", async () => {
    const { api, as, events } = setup({ validateUrl: ({ url }) => url.hostname === "docs.test" })
    const link = await api.create({ target: docs }, as("ada"))
    const moved = await api.update({ code: link.code, url: "https://docs.test/next" }, as("bob"))
    expect(moved.target).toEqual({ type: "url", url: "https://docs.test/next" })
    await expectCode(api.update({ code: link.code, url: "https://evil.test/" }, as("ada")), "INVALID_INPUT")
    await expectCode(api.update({ code: link.code, grantsView: true }, as("ada")), "INVALID_INPUT")
    const later = tomorrow()
    expect((await api.update({ code: link.code, expiresAt: later }, as("ada"))).expiresAt).toEqual(later)
    expect((await api.update({ code: link.code, expiresAt: null }, as("ada"))).expiresAt).toBeNull()
    await expectCode(api.update({ code: link.code, expiresAt: new Date(0) }, as("ada")), "INVALID_INPUT")
    expect((await api.update({ code: link.code, enabled: false }, as("ada"))).enabled).toBe(false)
    expect(events("link.updated")).toHaveLength(4)

    const record = await api.create({ target: inv1 }, as("ada"))
    await expectCode(api.update({ code: record.code, url: "https://docs.test/" }, as("ada")), "INVALID_INPUT")
    expect((await api.update({ code: record.code, grantsView: true }, as("ada"))).grantsView).toBe(true)
    expect((await api.update({ code: record.code, grantsView: false }, as("ada"))).grantsView).toBe(false)
    const short = await api.create({ target: inv1, code: "tiny" }, as("ada"))
    await expectCode(api.update({ code: short.code, grantsView: true }, as("ada")), "INVALID_INPUT")
    const cys = await api.create({ target: inv1, owner: "user" }, as("cy"))
    await expectCode(api.update({ code: cys.code, grantsView: true }, as("cy")), "FORBIDDEN")
    // Trusted server code isn't held to grantView.
    expect((await api.update({ code: cys.code, grantsView: true })).grantsView).toBe(true)
  })

  it("removes a link once, and its code is free again", async () => {
    const { api, as, events } = setup()
    const link = await api.create({ target: docs, code: "reuse-me" }, as("ada"))
    expect(await api.remove({ code: link.code }, as("ada"))).toEqual({ removed: true })
    await expectCode(api.remove({ code: link.code }, as("ada")), "NOT_FOUND")
    expect(events("link.removed")[0]?.data).toMatchObject({ link: { code: "reuse-me" } })
    expect((await api.create({ target: docs, code: "reuse-me" }, as("bob"))).code).toBe("reuse-me")
  })
})

describe("cleanup", () => {
  it("removes a record's links, and a person's or an organization's, from server code only", async () => {
    const { api, as, post, events, database } = setup()
    await api.create({ target: inv1 }, as("ada"))
    await api.create({ target: inv1, owner: "user" }, as("cy"))
    await api.create({ target: docs, owner: "user" }, as("cy"))
    await api.create({ target: docs }, as("gus"))
    expect((await post("removeSubject", inv1, "ada")).status).toBe(404)
    expect(await api.removeSubject(inv1)).toEqual({ removed: 2 })
    expect(events("subject.removed")[0]?.data).toEqual({ ...inv1, removed: 2 })
    expect(await api.removeOwner({ owner: { type: "user", id: "cy" } })).toEqual({ removed: 1 })
    expect(await api.removeOwner({ owner: { type: "org", id: "globex" } })).toEqual({ removed: 1 })
    expect(events("owner.removed").map((event) => event.data)).toEqual([
      { owner: { type: "user", id: "cy" }, removed: 1 },
      { owner: { type: "org", id: "globex" }, removed: 1 }
    ])
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM shortLink`).get()).toEqual({ count: 0 })
    expect(linkModel).toBe("shortLink")
  })
})
