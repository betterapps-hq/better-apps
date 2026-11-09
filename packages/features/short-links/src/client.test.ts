import { describe, expect, it } from "vite-plus/test"
import { browser } from "../test/browser.js"
import { listKey } from "./client.js"

const inv1 = { subjectType: "invoice", subjectId: "inv-1" } as const
const docs = { url: "https://docs.test/start" }

describe("short links client", () => {
  it("loads a record's links with their dates as Dates, sharing a load under way", async () => {
    const { api, as, links, requests } = browser()
    await api.create({ target: inv1, expiresAt: new Date(Date.now() + 60_000) }, as("ada"))
    const first = links.load(inv1)
    const second = links.load(inv1)
    expect(links.store.getSnapshot().lists[listKey(inv1)]?.state).toBe("loading")
    await Promise.all([first, second])
    expect(requests).toEqual(["list"])
    const list = links.store.getSnapshot().lists[listKey(inv1)]
    expect(list?.state).toBe("ready")
    expect(list?.links).toHaveLength(1)
    expect(list?.links[0]?.createdAt).toBeInstanceOf(Date)
    expect(list?.links[0]?.expiresAt).toBeInstanceOf(Date)
    expect(list?.links[0]?.shortUrl).toMatch(/^https:\/\/app\.test\/s\//)
  })

  it("pages through a list with loadMore", async () => {
    const { api, as, links } = browser()
    for (let index = 0; index < 22; index += 1) {
      await api.create({ target: docs }, as("ada"))
    }
    await links.load()
    expect(links.store.getSnapshot().lists[listKey()]?.links).toHaveLength(20)
    await links.loadMore()
    const list = links.store.getSnapshot().lists[listKey()]
    expect(list?.links).toHaveLength(22)
    expect(list?.cursor).toBeNull()
    // Nothing more to load.
    await links.loadMore()
    expect(links.store.getSnapshot().lists[listKey()]?.links).toHaveLength(22)
  })

  it("puts new links first in the lists they belong in, and shows changes and removals in all of them", async () => {
    const { links } = browser()
    await Promise.all([links.load(inv1), links.load(), links.load({ owner: "user" })])
    const link = await links.create({ target: inv1, grantsView: true })
    const url = await links.create({ target: docs, owner: "user" })
    const lists = () => links.store.getSnapshot().lists
    expect(lists()[listKey(inv1)]?.links.map((shown) => shown.code)).toEqual([link.code])
    expect(lists()[listKey()]?.links.map((shown) => shown.code)).toEqual([url.code, link.code])
    expect(lists()[listKey({ owner: "user" })]?.links.map((shown) => shown.code)).toEqual([url.code])

    const off = await links.update({ code: link.code, enabled: false })
    expect(off.enabled).toBe(false)
    expect(lists()[listKey(inv1)]?.links[0]?.enabled).toBe(false)
    expect(lists()[listKey()]?.links[1]?.enabled).toBe(false)

    expect(await links.remove(link.code)).toEqual({ removed: true })
    expect(lists()[listKey(inv1)]?.links).toEqual([])
    expect(lists()[listKey()]?.links.map((shown) => shown.code)).toEqual([url.code])
  })

  it("keeps a link made while the first page was on its way, though the page was read before it", async () => {
    const { links, hold } = browser()
    const release = hold("list", { answer: true })
    const loading = links.load(inv1)
    const link = await links.create({ target: inv1, grantsView: true })
    release()
    await loading
    const list = links.store.getSnapshot().lists[listKey(inv1)]
    expect(list?.state).toBe("ready")
    expect(list?.links.map((shown) => shown.code)).toEqual([link.code])
  })

  it("keeps a removed link out, and a change in, when a reload read before them answers after", async () => {
    const { api, as, links, hold } = browser()
    const gone = await api.create({ target: inv1 }, as("ada"))
    const kept = await api.create({ target: inv1 }, as("ada"))
    await links.load(inv1)
    const release = hold("list", { answer: true })
    const reloading = links.load(inv1)
    await links.remove(gone.code)
    await links.update({ code: kept.code, enabled: false })
    release()
    await reloading
    const list = links.store.getSnapshot().lists[listKey(inv1)]
    expect(list?.links.map((shown) => [shown.code, shown.enabled])).toEqual([[kept.code, false]])
    // A later load has nothing to catch up on.
    await links.load(inv1)
    expect(links.store.getSnapshot().lists[listKey(inv1)]?.links.map((shown) => shown.code)).toEqual([kept.code])
  })

  it("keeps a failed load's error, and throws it", async () => {
    const { links } = browser(null)
    await expect(links.load()).rejects.toMatchObject({ code: "UNAUTHENTICATED" })
    const list = links.store.getSnapshot().lists[listKey()]
    expect(list?.state).toBe("error")
    expect(list?.error).toMatchObject({ code: "UNAUTHENTICATED" })
  })

  it("drops what reset() cancelled, so nothing loaded for one person shows for the next", async () => {
    const { links, hold } = browser()
    const release = hold("list")
    const loading = links.load(inv1)
    links.reset()
    release()
    await expect(loading).rejects.toMatchObject({ code: "ABORTED" })
    expect(links.store.getSnapshot().lists).toEqual({})
  })
})
