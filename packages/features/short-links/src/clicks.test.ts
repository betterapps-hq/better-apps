import { describe, expect, it } from "vite-plus/test"
import { cookieOf, expectCode, options, setup } from "../test/app.js"
import { clickModel, shortLinks, shortLinksSchema, type LinkRules, type ShortLink } from "./index.js"

const inv1 = { subjectType: "invoice", subjectId: "inv-1" } as const
const docs = { url: "https://docs.test/start" }

type ClickRowRead = {
  linkId: string
  clickedAt: number
  slot: number
  host: string | null
  country: string | null
  referrer: string | null
  outcome: string
}

/** The click rows a test app holds, oldest first. */
function clickRows(t: ReturnType<typeof setup>): ClickRowRead[] {
  return t.database.sqlite
    .prepare(
      `SELECT "linkId", "clickedAt", "slot", "host", "country", "referrer", "outcome" FROM "${clickModel}" ORDER BY "clickedAt"`
    )
    .all() as ClickRowRead[]
}

/** Opens a link on a host and waits for its click to be written, with Cloudflare's country when given one. */
async function openOn(
  t: ReturnType<typeof setup>,
  url: string,
  cookie?: string,
  { country, referer }: { country?: string; referer?: string } = {}
) {
  const kept: Promise<unknown>[] = []
  const headers = new Headers(cookie ? { cookie } : {})
  if (referer !== undefined) {
    headers.set("referer", referer)
  }
  const request = Object.assign(new Request(url, { headers }), country === undefined ? {} : { cf: { country } })
  const response = await t.app.handler(request, { waitUntil: (promise) => kept.push(promise) })
  await Promise.all(kept)
  return response
}

const clicks = (...times: string[]) => times.map((time) => ({ at: new Date(time) }))

describe("click events", () => {
  it("are written one per GET alongside the counter, holding the link, the time and where it was opened", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    const before = Date.now()
    await openOn(t, `https://app.test/s/${link.code}`)
    await openOn(t, `https://app.test/s/${link.code.toUpperCase()}`)
    const head = t.open(link.code, { method: "HEAD" })
    await head.response
    expect(head.kept).toHaveLength(0)
    const rows = clickRows(t)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.linkId).toBe(link.id)
      expect(row.clickedAt).toBeGreaterThanOrEqual(before)
      expect(row.slot % (15 * 60_000)).toBe(0)
      expect(row.clickedAt - row.slot).toBeLessThan(15 * 60_000)
    }
    // Nothing about who opened it is kept.
    expect(Object.keys(shortLinksSchema[clickModel]?.fields ?? {})).toEqual([
      "linkId",
      "clickedAt",
      "host",
      "country",
      "referrer",
      "outcome",
      "slot"
    ])
    const read = await t.api.get({ id: link.id }, t.as("ada"))
    expect(read.clicks).toBe(2)
    expect(read.lastClickedAt?.getTime()).toBe(rows[1]?.clickedAt)
  })

  it("keep the host, Cloudflare's country, the referring site and how the open went", async () => {
    const t = setup()
    const plain = await t.api.create({ target: docs }, t.as("ada"))
    const granting = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    await openOn(t, `https://App.Test./s/${plain.code}`, undefined, {
      country: "DE",
      referer: "https://news.example/story?id=7#top"
    })
    // A country Cloudflare doesn't give, and a referrer that isn't a web page, are left out.
    await openOn(t, `https://app.test/s/${granting.code}`, undefined, {
      country: "Germany",
      referer: "android-app://x"
    })
    expect(clickRows(t).map(({ host, country, referrer, outcome }) => ({ host, country, referrer, outcome }))).toEqual([
      { host: "app.test", country: "DE", referrer: "https://news.example", outcome: "opened" },
      { host: "app.test", country: null, referrer: null, outcome: "granted" }
    ])
  })

  it("count the hop of a link that grants access to the record's host once, where the cookie is set", async () => {
    const t = setup({
      baseUrl: "https://app.test",
      hosts: {
        resolve: ({ hostname }) => {
          if (hostname === "app.test") {
            return "app"
          }
          return hostname === "links.acme.test" ? { orgId: "acme" } : null
        }
      },
      subjects: {
        ...options.subjects,
        invoice: { ...options.subjects.invoice, url: ({ subjectId }) => `https://app.test/invoices/${subjectId}` }
      },
      source: { param: "via", grants: true }
    })
    const link = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    const hop = await openOn(t, `https://links.acme.test/s/${link.code}`)
    // The hop goes to the same link on the app's host, without the code as a source, since that link adds it.
    expect(hop.headers.get("location")).toBe(`https://app.test/s/${link.code}`)
    expect(clickRows(t)).toHaveLength(0)
    const there = await openOn(t, `https://app.test/s/${link.code}`)
    expect(there.headers.get("location")).toBe(`https://app.test/invoices/inv-1?via=${link.code}`)
    expect(cookieOf(there)).toBe(`better-apps-links=${link.code}`)
    expect(clickRows(t).map(({ host, outcome }) => ({ host, outcome }))).toEqual([
      { host: "app.test", outcome: "granted" }
    ])
    expect((await t.api.get({ id: link.id }, t.as("ada"))).clicks).toBe(1)
  })

  it("go with their link, whether it's removed alone, with its record or with its owner", async () => {
    const t = setup()
    const one = await t.api.create({ target: docs }, t.as("ada"))
    const record = await t.api.create({ target: inv1 }, t.as("ada"))
    const mine = await t.api.create({ target: docs, owner: "user" }, t.as("bob"))
    const kept = await t.api.create({ target: docs }, t.as("gus"))
    for (const link of [one, record, mine, kept]) {
      await t.api.recordClicks({ id: link.id, clicks: clicks("2026-01-01T12:00:00Z", "2026-01-02T12:00:00Z") })
    }
    expect(clickRows(t)).toHaveLength(8)
    await t.api.remove({ id: one.id }, t.as("ada"))
    expect(clickRows(t)).toHaveLength(6)
    await t.api.removeSubject(inv1)
    expect(clickRows(t)).toHaveLength(4)
    await t.api.removeOwner({ owner: { type: "user", id: "bob" } })
    expect(clickRows(t).map((row) => row.linkId)).toEqual([kept.id, kept.id])
  })
})

describe("recordClicks", () => {
  it("records clicks at given times and keeps the counter and last click in step", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    const recorded = await t.api.recordClicks({
      id: link.id,
      clicks: [{ at: "2026-01-03T09:00:00Z" }, { at: new Date("2026-01-01T09:00:00Z") }, { at: "2026-01-02T09:00:00Z" }]
    })
    expect(recorded).toMatchObject({ id: link.id, clicks: 3, lastClickedAt: new Date("2026-01-03T09:00:00Z") })
    // An older click doesn't move the last click back.
    const older = await t.api.recordClicks({ id: link.id, clicks: clicks("2025-12-01T09:00:00Z") })
    expect(older).toMatchObject({ clicks: 4, lastClickedAt: new Date("2026-01-03T09:00:00Z") })
    expect(clickRows(t)).toHaveLength(4)
    // More than one statement's worth of rows goes in one batch.
    const many = Array.from({ length: 45 }, (_, index) => ({ at: new Date(Date.UTC(2026, 0, 10, 0, index)) }))
    expect((await t.api.recordClicks({ id: link.id, clicks: many })).clicks).toBe(49)
    expect(clickRows(t)).toHaveLength(49)
  })

  it("records where each click was opened, keeping only the referring site", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    const granting = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    await t.api.recordClicks({
      id: link.id,
      clicks: [
        { at: "2026-01-01T09:00:00Z", host: "Links.Acme.test", country: "FR", referrer: "https://news.example/a?b=c" },
        { at: "2026-01-01T10:00:00Z" }
      ]
    })
    await t.api.recordClicks({ id: granting.id, clicks: [{ at: "2026-01-01T11:00:00Z" }] })
    expect(clickRows(t).map(({ host, country, referrer, outcome }) => ({ host, country, referrer, outcome }))).toEqual([
      { host: "links.acme.test", country: "FR", referrer: "https://news.example", outcome: "opened" },
      { host: null, country: null, referrer: null, outcome: "opened" },
      { host: null, country: null, referrer: null, outcome: "granted" }
    ])
    for (const click of [
      { at: "2026-01-01T09:00:00Z", country: "fr" },
      { at: "2026-01-01T09:00:00Z", host: "links acme" },
      { at: "2026-01-01T09:00:00Z", referrer: "" }
    ]) {
      await expectCode(t.api.recordClicks({ id: link.id, clicks: [click] }), "INVALID_INPUT")
    }
  })

  it("deletes the rows it wrote for a link removed meanwhile, where foreign keys aren't enforced", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    const { sqlite } = t.database
    sqlite.exec("PRAGMA foreign_keys = OFF")
    // The link goes just before the batch updates it, as another call removing it would.
    const prepare = sqlite.prepare.bind(sqlite)
    sqlite.prepare = ((sql: string) => {
      if (/^update "shortLink"/i.test(sql)) {
        prepare(`DELETE FROM "shortLink" WHERE "id" = ?`).run(link.id)
      }
      return prepare(sql)
    }) as typeof sqlite.prepare
    await expectCode(t.api.recordClicks({ id: link.id, clicks: clicks("2026-01-01T00:00:00Z") }), "NOT_FOUND")
    sqlite.prepare = prepare
    expect(clickRows(t)).toHaveLength(0)
  })

  it("refuses times later than now and links the caller can't manage, and is server only", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    await expectCode(
      t.api.recordClicks({ id: link.id, clicks: [{ at: new Date(Date.now() + 60 * 60_000) }] }),
      "INVALID_INPUT"
    )
    await expectCode(
      t.api.recordClicks({ id: link.id, clicks: clicks("2026-01-01T00:00:00Z") }, t.as("gus")),
      "NOT_FOUND"
    )
    await expectCode(t.api.recordClicks({ id: "missing", clicks: clicks("2026-01-01T00:00:00Z") }), "NOT_FOUND")
    await expectCode(t.api.recordClicks({ id: link.id, clicks: clicks("2010-12-31T23:59:59Z") }), "INVALID_INPUT")
    const posted = await t.post("recordClicks", { id: link.id, clicks: [{ at: "2026-01-01T00:00:00Z" }] }, "ada")
    expect(posted.ok).toBe(false)
    expect(clickRows(t)).toHaveLength(0)
    // A manager's server code may record clicks on their links.
    expect(
      (await t.api.recordClicks({ id: link.id, clicks: clicks("2026-01-01T00:00:00Z") }, t.as("ada"))).clicks
    ).toBe(1)
  })
})

describe("clicksByDay", () => {
  it("counts a link's clicks on each day of a range, including days without any", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    const other = await t.api.create({ target: docs }, t.as("ada"))
    await t.api.recordClicks({
      id: link.id,
      clicks: clicks("2026-01-01T00:00:00Z", "2026-01-01T23:59:59Z", "2026-01-03T12:00:00Z", "2026-01-04T00:00:00Z")
    })
    await t.api.recordClicks({ id: other.id, clicks: clicks("2026-01-02T12:00:00Z") })
    const days = await t.api.clicksByDay({ id: link.id, from: "2026-01-01", to: "2026-01-03" }, t.as("ada"))
    expect(days).toEqual({
      days: [
        { date: "2026-01-01", clicks: 2 },
        { date: "2026-01-02", clicks: 0 },
        { date: "2026-01-03", clicks: 1 }
      ],
      total: 3
    })
    const one = await t.api.clicksByDay({ id: link.id, from: "2026-01-04", to: "2026-01-04" }, t.as("ada"))
    expect(one).toEqual({ days: [{ date: "2026-01-04", clicks: 1 }], total: 1 })
  })

  it("puts clicks on the day they fell on in the given zone, across offsets of 45 minutes and changes of offset", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    await t.api.recordClicks({
      id: link.id,
      clicks: clicks(
        // Kathmandu is 5:45 ahead: 23:59 on 1 January there, then midnight on the 2nd.
        "2026-01-01T18:14:00Z",
        "2026-01-01T18:15:00Z",
        // New York moves from 5 hours behind to 4 on 8 March: 23:59 on the 8th, then 00:30 on the 9th.
        "2026-03-09T03:59:00Z",
        "2026-03-09T04:30:00Z",
        // 00:00 on 8 March in New York, still 5 hours behind.
        "2026-03-08T05:00:00Z"
      )
    })
    const kathmandu = await t.api.clicksByDay(
      { id: link.id, from: "2026-01-01", to: "2026-01-02", timeZone: "Asia/Kathmandu" },
      t.as("ada")
    )
    expect(kathmandu.days).toEqual([
      { date: "2026-01-01", clicks: 1 },
      { date: "2026-01-02", clicks: 1 }
    ])
    const newYork = await t.api.clicksByDay(
      { id: link.id, from: "2026-03-08", to: "2026-03-09", timeZone: "America/New_York" },
      t.as("ada")
    )
    expect(newYork.days).toEqual([
      { date: "2026-03-08", clicks: 2 },
      { date: "2026-03-09", clicks: 1 }
    ])
    // The range's edges are the zone's midnights: the 7th in New York ends at 05:00 UTC on the 8th.
    const before = await t.api.clicksByDay(
      { id: link.id, from: "2026-03-07", to: "2026-03-07", timeZone: "America/New_York" },
      t.as("ada")
    )
    expect(before.total).toBe(0)
  })

  it("starts a day at its first midnight where midnight happens twice, and gives a skipped day no clicks", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    // Amman turned its clocks back from 01:00 to 00:00 on 25 October 2019: 21:30 UTC was 00:30 there, the first time.
    // Samoa skipped 30 December 2011, going from the 29th straight to the 31st.
    await t.api.recordClicks({
      id: link.id,
      clicks: clicks("2019-10-24T21:30:00Z", "2011-12-30T09:59:00Z", "2011-12-30T10:00:00Z")
    })
    const amman = await t.api.clicksByDay(
      { id: link.id, from: "2019-10-25", to: "2019-10-25", timeZone: "Asia/Amman" },
      t.as("ada")
    )
    expect(amman.total).toBe(1)
    const samoa = await t.api.clicksByDay(
      { id: link.id, from: "2011-12-29", to: "2011-12-31", timeZone: "Pacific/Apia" },
      t.as("ada")
    )
    expect(samoa.days).toEqual([
      { date: "2011-12-29", clicks: 1 },
      { date: "2011-12-30", clicks: 0 },
      { date: "2011-12-31", clicks: 1 }
    ])
    const skipped = await t.api.clicksByDay(
      { id: link.id, from: "2011-12-30", to: "2011-12-30", timeZone: "Pacific/Apia" },
      t.as("ada")
    )
    expect(skipped).toEqual({ days: [{ date: "2011-12-30", clicks: 0 }], total: 0 })
  })

  it("starts a day where the clocks skip from 23:00 to midnight", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    // Nuuk went from 23:00 on 28 March 2026 straight to 00:00 on the 29th, at 01:00 UTC, so the 29th starts then.
    await t.api.recordClicks({ id: link.id, clicks: clicks("2026-03-29T00:59:00Z", "2026-03-29T01:00:00Z") })
    const nuuk = await t.api.clicksByDay(
      { id: link.id, from: "2026-03-28", to: "2026-03-29", timeZone: "America/Nuuk" },
      t.as("ada")
    )
    expect(nuuk.days).toEqual([
      { date: "2026-03-28", clicks: 1 },
      { date: "2026-03-29", clicks: 1 }
    ])
    const only = await t.api.clicksByDay(
      { id: link.id, from: "2026-03-29", to: "2026-03-29", timeZone: "America/Nuuk" },
      t.as("ada")
    )
    expect(only.total).toBe(1)
  })

  it("is for the link's managers", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    const range = { id: link.id, from: "2026-01-01", to: "2026-01-02" }
    await expectCode(t.api.clicksByDay(range, t.as("gus")), "NOT_FOUND")
    await expectCode(t.api.clicksByDay(range, t.as("cy")), "NOT_FOUND")
    expect((await t.post("clicksByDay", range)).status).toBe(401)
    expect((await t.api.clicksByDay(range)).total).toBe(0)
    const posted = await t.post("clicksByDay", range, "bob")
    expect(await posted.json()).toMatchObject({ total: 0 })
  })

  it("refuses ranges and zones that don't work", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    const ask = (range: { from: string; to: string; timeZone?: string }) =>
      t.api.clicksByDay({ id: link.id, ...range }, t.as("ada"))
    for (const range of [
      { from: "2026-1-1", to: "2026-01-02" },
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-01-02", to: "2026-01-01" },
      { from: "2025-01-01", to: "2026-01-02" },
      { from: "2026-01-01", to: "2026-01-02", timeZone: "Mars/Olympus" },
      { from: "2026-01-01", to: "2026-01-02", timeZone: "+05:07" },
      // Until November 2010, St. John's clocks went back at 00:01, in the middle of a slot.
      { from: "2007-11-03", to: "2007-11-04", timeZone: "America/St_Johns" },
      { from: "2010-12-31", to: "2011-01-01" },
      { from: "9998-12-31", to: "9999-12-31" }
    ]) {
      await expectCode(ask(range), "INVALID_INPUT")
    }
    // A whole year, leap day and all, is allowed.
    expect((await ask({ from: "2027-03-01", to: "2028-02-29" })).days).toHaveLength(366)
  })
})

describe("clickTotals", () => {
  it("counts each link's clicks over a range, for the links the caller manages, in the order asked", async () => {
    const t = setup()
    const first = await t.api.create({ target: docs }, t.as("ada"))
    const second = await t.api.create({ target: docs }, t.as("ada"))
    const quiet = await t.api.create({ target: docs }, t.as("ada"))
    const globex = await t.api.create({ target: docs }, t.as("gus"))
    await t.api.recordClicks({ id: first.id, clicks: clicks("2026-01-01T10:00:00Z", "2026-01-05T10:00:00Z") })
    await t.api.recordClicks({ id: second.id, clicks: clicks("2026-01-02T10:00:00Z", "2026-01-03T10:00:00Z") })
    await t.api.recordClicks({ id: globex.id, clicks: clicks("2026-01-02T10:00:00Z") })
    const totals = await t.api.clickTotals(
      {
        ids: [second.id, first.id, quiet.id, globex.id, "missing", first.id],
        from: "2026-01-01",
        to: "2026-01-03"
      },
      t.as("ada")
    )
    expect(totals).toEqual({
      links: [
        { id: second.id, clicks: 2 },
        { id: first.id, clicks: 1 },
        { id: quiet.id, clicks: 0 }
      ],
      total: 3
    })
    // Trusted server code reads any link's.
    const all = await t.api.clickTotals({ ids: [globex.id], from: "2026-01-01", to: "2026-01-31" })
    expect(all.links).toEqual([{ id: globex.id, clicks: 1 }])
    expect((await t.post("clickTotals", { ids: [first.id], from: "2026-01-01", to: "2026-01-02" })).status).toBe(401)
  })
})

describe("clicksBy", () => {
  const range = { from: "2026-01-01", to: "2026-01-31" }

  it("counts the links' clicks by host, country, referring site or outcome, most first, with `null` last", async () => {
    const t = setup()
    const first = await t.api.create({ target: docs }, t.as("ada"))
    const second = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    const globex = await t.api.create({ target: docs }, t.as("gus"))
    await t.api.recordClicks({
      id: first.id,
      clicks: [
        { at: "2026-01-02T10:00:00Z", host: "links.acme.test", country: "DE", referrer: "https://news.example/a" },
        { at: "2026-01-03T10:00:00Z", host: "links.acme.test", country: "FR" },
        { at: "2026-01-04T10:00:00Z", host: "app.test", country: "DE", referrer: "https://news.example/b" },
        // Outside the range.
        { at: "2026-02-01T10:00:00Z", host: "app.test", country: "US" }
      ]
    })
    await t.api.recordClicks({
      id: second.id,
      clicks: [{ at: "2026-01-05T10:00:00Z", host: "app.test", country: "FR", referrer: "https://chat.example" }]
    })
    await t.api.recordClicks({ id: globex.id, clicks: [{ at: "2026-01-05T10:00:00Z", host: "links.globex.test" }] })
    const ids = [first.id, second.id, globex.id, "missing"]
    const by = async (dimension: "host" | "country" | "referrer" | "outcome", limit?: number) =>
      t.api.clicksBy({ ids, by: dimension, ...range, ...(limit === undefined ? {} : { limit }) }, t.as("ada"))
    // Ties go in alphabetical order. Globex's link and ids of no link are left out.
    expect(await by("host")).toEqual({
      values: [
        { value: "app.test", clicks: 2 },
        { value: "links.acme.test", clicks: 2 }
      ],
      total: 4
    })
    expect(await by("country")).toEqual({
      values: [
        { value: "DE", clicks: 2 },
        { value: "FR", clicks: 2 }
      ],
      total: 4
    })
    expect(await by("referrer")).toEqual({
      values: [
        { value: "https://news.example", clicks: 2 },
        { value: "https://chat.example", clicks: 1 },
        { value: null, clicks: 1 }
      ],
      total: 4
    })
    expect(await by("outcome")).toEqual({
      values: [
        { value: "opened", clicks: 3 },
        { value: "granted", clicks: 1 }
      ],
      total: 4
    })
    // `limit` keeps the most clicked, and the total still counts every click.
    expect(await by("referrer", 1)).toEqual({ values: [{ value: "https://news.example", clicks: 2 }], total: 4 })
    // Trusted server code reads any link's.
    const all = await t.api.clicksBy({ ids, by: "host", ...range })
    expect(all.values).toContainEqual({ value: "links.globex.test", clicks: 1 })
  })

  it("is for signed-in people and trusted server code, and checks its input", async () => {
    const t = setup()
    const link = await t.api.create({ target: docs }, t.as("ada"))
    const posted = await t.post("clicksBy", { ids: [link.id], by: "host", ...range })
    expect(posted.status).toBe(401)
    await expectCode(t.api.clicksBy({ ids: [link.id], by: "host", ...range, limit: 51 }, t.as("ada")), "INVALID_INPUT")
    await expectCode(t.api.clicksBy({ ids: [link.id], by: "city" as "host", ...range }, t.as("ada")), "INVALID_INPUT")
  })
})

describe("listing by clicks", () => {
  it("lists the most opened links first, then the newest, a page at a time", async () => {
    const t = setup()
    const made: ShortLink[] = []
    for (let index = 0; index < 5; index += 1) {
      made.push(await t.api.create({ target: docs }, t.as("ada")))
    }
    const counts = [3, 0, 7, 3, 1]
    for (const [index, link] of made.entries()) {
      const count = counts[index] ?? 0
      if (count > 0) {
        await t.api.recordClicks({
          id: link.id,
          clicks: Array.from({ length: count }, () => ({ at: new Date("2026-01-01") }))
        })
      }
    }
    const first = await t.api.list({ sort: "clicks", limit: 3 }, t.as("ada"))
    const second = await t.api.list({ sort: "clicks", limit: 3, cursor: first.cursor ?? "" }, t.as("ada"))
    expect(second.cursor).toBeNull()
    // Ties on clicks go newest first: the fourth link was made after the first.
    expect([...first.links, ...second.links].map((link) => link.code)).toEqual(
      [2, 3, 0, 4, 1].map((index) => made[index]?.code)
    )
    // A tampered cursor fails as bad input, not in the database.
    const tampered = (values: unknown[]) => btoa(JSON.stringify(values)).replace(/=+$/, "")
    for (const values of [
      [2 ** 40, "2026-01-01T00:00:00.000Z", "id"],
      [-1, "2026-01-01T00:00:00.000Z", "id"],
      [1.5, "2026-01-01T00:00:00.000Z", "id"],
      [1, "+275760-01-01T00:00:00.000Z", "id"],
      [1, "2026-01-01T00:00:00.000Z", "a\u0000b"]
    ]) {
      await expectCode(t.api.list({ sort: "clicks", cursor: tampered(values) }, t.as("ada")), "INVALID_INPUT")
    }
    // A cursor from one order isn't one for the other.
    await expectCode(t.api.list({ cursor: first.cursor ?? "" }, t.as("ada")), "INVALID_INPUT")
    const newest = await t.api.list({ limit: 2 }, t.as("ada"))
    await expectCode(t.api.list({ sort: "clicks", cursor: newest.cursor ?? "" }, t.as("ada")), "INVALID_INPUT")
  })
})

describe("telling the page which link opened it", () => {
  const record: LinkRules = {
    ...options.subjects.invoice,
    url: ({ subjectId }) => `/invoices/${subjectId}?tab=details&q=a%20b+c;d&flag&via=old#top`
  }

  it("adds the code to record links' addresses, and to web addresses only where the app allows", async () => {
    const t = setup({ source: { param: "via" }, subjects: { ...options.subjects, invoice: record } })
    const invoice = await t.api.create({ target: inv1, code: "Spring" }, t.as("ada"))
    const response = await openOn(t, `https://app.test/s/SPRING`)
    // The rest of the query stays as written, and an old value of the parameter goes.
    expect(response.headers.get("location")).toBe(
      "https://app.test/invoices/inv-1?tab=details&q=a%20b+c;d&flag&via=spring#top"
    )
    expect(invoice.code).toBe("spring")
    // A link that lets people see the record keeps its code, a credential, out of the address unless the app opts in.
    const granting = await t.api.create({ target: inv1, grantsView: true }, t.as("ada"))
    const plain = await openOn(t, `https://app.test/s/${granting.code}`)
    expect(plain.headers.get("location")).toBe(
      "https://app.test/invoices/inv-1?tab=details&q=a%20b+c;d&flag&via=old#top"
    )
    expect(cookieOf(plain)).toBe(`better-apps-links=${granting.code}`)
    const web = await t.api.create({ target: { url: "https://docs.test/start?via=other" } }, t.as("ada"))
    expect((await openOn(t, `https://app.test/s/${web.code}`)).headers.get("location")).toBe(
      "https://docs.test/start?via=other"
    )
  })

  it("adds it to web addresses when `urls` says so, but never to other schemes", async () => {
    const all = setup({ source: { param: "ref", urls: true } })
    const web = await all.api.create({ target: { url: "https://docs.test/start?via=other" } }, all.as("ada"))
    expect((await openOn(all, `https://app.test/s/${web.code}`)).headers.get("location")).toBe(
      `https://docs.test/start?via=other&ref=${web.code}`
    )
    const mail = await all.api.create({ target: { url: "mailto:sales@docs.test" } }, all.as("ada"))
    expect((await openOn(all, `https://app.test/s/${mail.code}`)).headers.get("location")).toBe(
      "mailto:sales@docs.test"
    )
    const ours = setup({ source: { param: "ref", urls: ({ url }) => url.hostname === "app.test" } })
    const own = await ours.api.create({ target: { url: "https://app.test/pricing" } }, ours.as("ada"))
    const away = await ours.api.create({ target: docs }, ours.as("ada"))
    expect((await openOn(ours, `https://app.test/s/${own.code}`)).headers.get("location")).toBe(
      `https://app.test/pricing?ref=${own.code}`
    )
    expect((await openOn(ours, `https://app.test/s/${away.code}`)).headers.get("location")).toBe(docs.url)
  })

  it("refuses a parameter name that can't work", () => {
    expect(() => shortLinks({ source: { param: "" } })).toThrow("source parameter")
    expect(() => shortLinks({ source: { param: "a b" } })).toThrow("source parameter")
  })
})
