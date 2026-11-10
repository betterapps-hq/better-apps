import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import { cookieOf, setup } from "../test/app.js"
import { shortLinks, type LinkHosts } from "./index.js"

const inv1 = { subjectType: "invoice", subjectId: "inv-1" } as const
const docs = { url: "https://docs.test/start" }
const hour = 60 * 60_000

/** The app answers on app.test, and each organization's domain opens its own links. */
const hosts: LinkHosts = {
  resolve: ({ hostname }) => {
    if (hostname === "app.test") {
      return "app"
    }
    const orgId = { "links.acme.test": "acme", "links.globex.test": "globex" }[hostname]
    return orgId === undefined ? null : { orgId }
  },
  origin: ({ orgId }) => (orgId === null ? null : `https://links.${orgId}.test`)
}

/** Opens a link on a host and waits for the click and its events to be written and delivered. */
async function openOn(
  t: ReturnType<typeof setup>,
  host: string,
  code: string,
  { cookie, referer, method = "GET" }: { cookie?: string; referer?: string; method?: string } = {}
) {
  const kept: Promise<unknown>[] = []
  const headers = { ...(cookie ? { cookie } : {}), ...(referer ? { referer } : {}) }
  const response = await t.app.handler(new Request(`https://${host}/s/${code}`, { method, headers }), {
    waitUntil: (promise) => kept.push(promise)
  })
  await Promise.all(kept)
  return response
}

const dataOf = (t: ReturnType<typeof setup>, type: string) => t.events(type).map((event) => event.data)

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("link.clicked", () => {
  it("is emitted for each GET after the response, with the link, the host and the time, and HEAD emits nothing", async () => {
    const t = setup()
    const link = await t.api.create({ target: inv1 }, t.as("ada"))
    await openOn(t, "app.test", link.code)
    expect(dataOf(t, "link.clicked")).toEqual([
      {
        linkId: link.id,
        owner: { type: "org", id: "acme" },
        orgId: "acme",
        subject: inv1,
        host: "app.test",
        outcome: "opened",
        forwardedTo: null,
        country: null,
        referrer: null,
        clickedAt: expect.any(String),
        sampleRate: 1
      }
    ])
    const delivered = t.events().length
    expect((await openOn(t, "app.test", link.code, { method: "HEAD" })).status).toBe(302)
    expect(await openOn(t, "app.test", "missing1", { method: "HEAD" })).toHaveProperty("status", 404)
    expect(t.events()).toHaveLength(delivered)
    expect((await t.api.get({ code: link.code }, t.as("ada"))).clicks).toBe(1)
  })

  it("carries the visitor's country from Cloudflare and the site they came from, without the page", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    const kept: Promise<unknown>[] = []
    const request = new Request(`https://app.test/s/${link.code}`, {
      headers: { referer: "https://news.example/story/42?ref=front" }
    })
    Object.assign(request, { cf: { country: "DE" } })
    await t.app.handler(request, { waitUntil: (promise) => kept.push(promise) })
    await Promise.all(kept)
    for (const referer of ["android-app://com.example", "not a url"]) {
      await openOn(t, "app.test", link.code, { referer })
    }
    expect(dataOf(t, "link.clicked")).toEqual([
      expect.objectContaining({ country: "DE", referrer: "https://news.example" }),
      expect.objectContaining({ country: null, referrer: null }),
      expect.objectContaining({ country: null, referrer: null })
    ])
  })

  it("is sampled by clickRate, while every click still counts", async () => {
    const none = setup({ events: { clickRate: 0 } })
    const link = await none.api.create({ target: docs }, none.as("ada"))
    await openOn(none, "app.test", link.code)
    await openOn(none, "app.test", link.code)
    expect(none.events("link.clicked")).toEqual([])
    expect((await none.api.get({ code: link.code }, none.as("ada"))).clicks).toBe(2)

    const some = setup({ events: { clickRate: 0.25 } })
    const sampled = await some.api.create({ target: docs }, some.as("ada"))
    const random = vi.spyOn(Math, "random")
    for (const roll of [0.1, 0.5, 0.24, 0.9]) {
      random.mockReturnValueOnce(roll)
      await openOn(some, "app.test", sampled.code)
    }
    expect(dataOf(some, "link.clicked")).toEqual([
      expect.objectContaining({ sampleRate: 0.25 }),
      expect.objectContaining({ sampleRate: 0.25 })
    ])
    expect((await some.api.get({ code: sampled.code }, some.as("ada"))).clicks).toBe(4)
  })

  it("says when a link that grants access sent the visitor on to another host, which counts the click", async () => {
    const t = setup({
      baseUrl: "https://app.test",
      hosts,
      subjects: {
        invoice: {
          url: ({ subjectId }) => `https://app.test/invoices/${subjectId}`,
          grantView: true
        }
      }
    })
    const link = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    await openOn(t, "links.acme.test", link.code)
    await openOn(t, "app.test", link.code)
    expect(dataOf(t, "link.clicked")).toEqual([
      expect.objectContaining({ host: "links.acme.test", outcome: "hopped", forwardedTo: "app.test" }),
      expect.objectContaining({ host: "app.test", outcome: "granted", forwardedTo: null })
    ])
    expect((await t.api.get({ code: link.code }, t.as("ada"))).clicks).toBe(1)
  })
})

describe("link.granted", () => {
  it("is emitted when a link sets its access cookie for a visitor whose cookie didn't hold it", async () => {
    const t = setup()
    const link = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    const first = await openOn(t, "app.test", link.code)
    await openOn(t, "app.test", link.code, { cookie: cookieOf(first) })
    await openOn(t, "app.test", link.code)
    expect(dataOf(t, "link.granted")).toEqual([
      {
        linkId: link.id,
        owner: { type: "org", id: "acme" },
        orgId: "acme",
        subject: inv1,
        host: "app.test",
        grantedAt: expect.any(String)
      },
      expect.objectContaining({ linkId: link.id })
    ])
    expect(dataOf(t, "link.clicked")).toEqual(
      Array.from({ length: 3 }, () => expect.objectContaining({ outcome: "granted" }))
    )
  })
})

describe("link.notFound", () => {
  it("is the same for unknown, turned off and expired codes, and says nothing about the link", async () => {
    const t = setup()
    const off = await t.api.create({ target: docs }, t.as("ada"))
    await t.api.update({ code: off.code, enabled: false }, t.as("ada"))
    const expired = await t.api.create({ target: docs, expiresAt: new Date(Date.now() + hour) }, t.as("ada"))
    t.database.sqlite.prepare("UPDATE shortLink SET expiresAt = ? WHERE code = ?").run(Date.now() - 1000, expired.code)
    for (const code of ["missing1", off.code, expired.code]) {
      await openOn(t, "app.test", code)
    }
    expect(dataOf(t, "link.notFound")).toEqual(
      ["missing1", off.code, expired.code].map((code) => ({
        host: "app.test",
        orgId: null,
        code,
        requestedAt: expect.any(String)
      }))
    )
  })

  it("doesn't tell another organization's code from one that doesn't exist", async () => {
    const t = setup({ baseUrl: "https://app.test", hosts })
    const acmes = await t.api.create({ target: docs, owner: "org" }, t.as("ada"))
    await openOn(t, "links.globex.test", acmes.code)
    await openOn(t, "links.globex.test", "nosuch12")
    // A host that opens no links emits nothing.
    await openOn(t, "pending.acme.test", acmes.code)
    const [other, unknown] = dataOf(t, "link.notFound") as { code: string }[]
    expect(dataOf(t, "link.notFound")).toHaveLength(2)
    const blank = { code: "", requestedAt: "" }
    expect({ ...other, ...blank }).toEqual({ ...unknown, ...blank })
    expect(other).toEqual({
      host: "links.globex.test",
      orgId: "globex",
      code: acmes.code,
      requestedAt: expect.any(String)
    })
  })

  it("is limited per host each minute, so guessing codes can't flood the outbox", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-10T12:00:10Z"))
    const t = setup({ baseUrl: "https://app.test", hosts, events: { notFoundPerMinute: 2 } })
    for (const code of ["guess1", "guess2", "guess3"]) {
      await openOn(t, "app.test", code)
    }
    await openOn(t, "links.acme.test", "guess4")
    vi.setSystemTime(new Date("2026-11-10T12:01:00Z"))
    await openOn(t, "app.test", "guess5")
    expect(dataOf(t, "link.notFound").map((data) => (data as { code: string }).code)).toEqual([
      "guess1",
      "guess2",
      "guess4",
      "guess5"
    ])
    // Codes longer than any link's are cut short.
    await openOn(t, "links.globex.test", "x".repeat(300))
    expect(dataOf(t, "link.notFound").at(-1)).toMatchObject({ code: "x".repeat(64) })

    const quiet = setup({ events: { notFoundPerMinute: 0 } })
    await openOn(quiet, "app.test", "missing1")
    expect(quiet.events("link.notFound")).toEqual([])
  })
})

describe("link.milestone", () => {
  it("is emitted once for each milestone, however many clicks land at the same moment", async () => {
    const t = setup({ events: { milestones: [3, 1, 3, 5] } })
    const link = await t.api.create({ target: docs }, t.as("ada"))
    await Promise.all(Array.from({ length: 8 }, async () => openOn(t, "app.test", link.code)))
    const reached = dataOf(t, "link.milestone") as { clicks: number; link: { id: string; clicks: number } }[]
    expect(reached.map(({ clicks }) => clicks).sort((a, b) => a - b)).toEqual([1, 3, 5])
    for (const { clicks, link: shown } of reached) {
      expect(shown).toMatchObject({ id: link.id, clicks, shortUrl: `https://app.test/s/${link.code}` })
    }
    expect((await t.api.get({ code: link.code }, t.as("ada"))).clicks).toBe(8)
  })

  it("defaults to 1, 10, 100, 1,000 and 10,000 clicks, and an empty list emits none", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    for (let click = 0; click < 10; click += 1) {
      await openOn(t, "app.test", link.code)
    }
    expect(dataOf(t, "link.milestone").map((data) => (data as { clicks: number }).clicks)).toEqual([1, 10])

    const none = setup({ events: { milestones: [] } })
    const quiet = await none.api.create({ target: docs }, none.as("ada"))
    await openOn(none, "app.test", quiet.code)
    expect(none.events("link.milestone")).toEqual([])
  })

  it("refuses settings that can't work", () => {
    expect(() => shortLinks({ events: { clickRate: 1.5 } })).toThrow("`events.clickRate`")
    expect(() => shortLinks({ events: { clickRate: Number.NaN } })).toThrow("`events.clickRate`")
    expect(() => shortLinks({ events: { milestones: [0] } })).toThrow("`events.milestones`")
    expect(() => shortLinks({ events: { milestones: [2.5] } })).toThrow("`events.milestones`")
    expect(() => shortLinks({ events: { notFoundPerMinute: -1 } })).toThrow("`events.notFoundPerMinute`")
  })
})

describe("link.expired", () => {
  /** An app whose clock can move, with a link that expires in an hour. */
  async function expiring(extra: Parameters<typeof setup>[0] = {}) {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"))
    const t = setup(extra)
    const at = (hours: number) => new Date(Date.now() + hours * hour)
    const link = await t.api.create({ target: docs, expiresAt: at(1) }, t.as("ada"))
    /** Moves the clock and runs the scheduled delivery, returning the codes of the links that expired. */
    const runAt = async (time: Date) => {
      vi.setSystemTime(time)
      await t.app.deliverEvents()
      return t.events("link.expired").map((event) => (event.data as { link: { code: string } }).link.code)
    }
    return { t, link, at, runAt, start: new Date(Date.now()) }
  }
  const later = (from: Date, hours: number) => new Date(from.getTime() + hours * hour)

  it("is emitted once when expiresAt passes, without anyone opening the link", async () => {
    const { t, link, runAt, start } = await expiring()
    expect(await runAt(later(start, 0.5))).toEqual([])
    expect(await runAt(later(start, 1))).toEqual([link.code])
    expect(t.events("link.expired")[0]?.data).toMatchObject({ link: { id: link.id, expiresAt: expect.any(String) } })
    expect(await runAt(later(start, 2))).toEqual([link.code])
  })

  it("follows a changed expiry, and the old one does nothing", async () => {
    const { t, link, at, runAt, start } = await expiring()
    await t.api.update({ code: link.code, expiresAt: at(3) }, t.as("ada"))
    expect(await runAt(later(start, 2))).toEqual([])
    expect(await runAt(later(start, 3))).toEqual([link.code])

    // Moved and moved back, it still expires once.
    const back = await expiring()
    await back.t.api.update({ code: back.link.code, expiresAt: back.at(2) }, back.t.as("ada"))
    await back.t.api.update({ code: back.link.code, expiresAt: back.at(1) }, back.t.as("ada"))
    expect(await back.runAt(later(back.start, 3))).toEqual([back.link.code])
  })

  it("isn't emitted once the expiry is cleared or the link removed, and a link turned off still expires", async () => {
    const cleared = await expiring()
    await cleared.t.api.update({ code: cleared.link.code, expiresAt: null }, cleared.t.as("ada"))
    expect(await cleared.runAt(later(cleared.start, 2))).toEqual([])

    const removed = await expiring()
    await removed.t.api.remove({ code: removed.link.code }, removed.t.as("ada"))
    expect(await removed.runAt(later(removed.start, 2))).toEqual([])

    const off = await expiring()
    await off.t.api.update({ code: off.link.code, enabled: false }, off.t.as("ada"))
    expect(await off.runAt(later(off.start, 2))).toEqual([off.link.code])
  })

  it("is emitted once when a delivery of its schedule is retried", async () => {
    const { t, link, runAt, start } = await expiring()
    const [scheduled] = await t.app.db.findMany<Record<string, unknown>>({
      model: "betterAppsEvent",
      where: [{ field: "type", value: "expiry.scheduled" }]
    })
    expect(scheduled?.availableAt).toEqual(later(start, 1))
    expect(await runAt(later(start, 1))).toEqual([link.code])
    // The same schedule, delivered again, finds its token gone.
    await t.app.db.create({ model: "betterAppsEvent", data: { ...scheduled, id: crypto.randomUUID() } })
    expect(await runAt(later(start, 2))).toEqual([link.code])
  })
})
