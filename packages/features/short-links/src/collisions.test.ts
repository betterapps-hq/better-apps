import { describe, expect, it, vi } from "vite-plus/test"
import { expectCode, setup } from "../test/app.js"

// Codes the next links get, in order, before random ones.
const next = vi.hoisted(() => [] as string[])

vi.mock("./codes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./codes.js")>()
  return { ...actual, generateCode: (length?: number) => next.shift() ?? actual.generateCode(length) }
})

const docs = { url: "https://docs.test/start" }

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
})
