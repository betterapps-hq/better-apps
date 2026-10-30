import { describe, expect, it } from "vitest"
import { checkFields, jsonBytes, stableJson } from "./content.js"
import { decodeCursor, encodeCursor } from "./cursor.js"
import { isUlid, mentionToken, textFormat, ulid } from "./index.js"

describe("ulid", () => {
  it("encodes the time first, so ids sort by creation", () => {
    const early = ulid(Date.UTC(2026, 0, 1))
    const late = ulid(Date.UTC(2026, 0, 2))
    expect(isUlid(early) && isUlid(late)).toBe(true)
    expect(early < late).toBe(true)
    expect(early.slice(0, 10)).toBe(ulid(Date.UTC(2026, 0, 1)).slice(0, 10))
    expect(ulid()).not.toBe(ulid())
  })

  it("refuses ids that aren't canonical ULIDs", () => {
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true)
    expect(isUlid("01arz3ndektsv4rrffq69g5fav")).toBe(false)
    expect(isUlid("81ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(false)
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAU")).toBe(false)
    expect(isUlid(42)).toBe(false)
  })
})

describe("cursors", () => {
  it("round-trip a time and an id", () => {
    const time = new Date("2026-05-06T07:08:09.123Z")
    expect(decodeCursor(encodeCursor(time, "01ARZ3NDEKTSV4RRFFQ69G5FAV"))).toEqual({
      time,
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV"
    })
  })

  it("refuse anything else as invalid input", () => {
    for (const cursor of ["nope", btoa("[1,2]"), btoa('["not a date","x"]')]) {
      expect(() => decodeCursor(cursor)).toThrow("That page cursor isn't valid.")
    }
  })
})

describe("textFormat", () => {
  const body = `Hi ${mentionToken("ada")} and ${mentionToken("bob")}, see \\@[user:ada] and ${mentionToken("ada")}`

  it("reads each mention once, skipping escaped ones", () => {
    expect(textFormat.mentions(body)).toEqual(["ada", "bob"])
  })

  it("keeps tokens without names, and fills in names with them", () => {
    expect(textFormat.toText(body)).toBe(body)
    expect(textFormat.toText(body, (id) => (id === "ada" ? "Ada" : undefined))).toBe(
      "Hi @Ada and @Former user, see @[user:ada] and @Ada"
    )
  })

  it("checks for text and normalizes line breaks", async () => {
    const validate = (value: unknown) => textFormat.schema["~standard"].validate(value)
    expect(await validate("  ")).toEqual({ issues: [{ message: "A text comment needs some text." }] })
    expect(await validate(3)).toHaveProperty("issues")
    expect(await validate("Hi")).toEqual({ value: "Hi" })
    expect(textFormat.sanitize?.(" a\r\nb\rc ")).toBe("a\nb\nc")
  })
})

describe("additional field checks", () => {
  const declared = {
    name: { type: "string" },
    size: { type: "number", required: false },
    done: { type: "boolean" },
    dueAt: { type: "date" },
    tags: { type: "string[]" },
    scores: { type: "number[]" },
    level: { type: ["low", "high"] },
    extra: { type: "json", required: false }
  } as const

  it("accepts each field type, including dates sent as strings", () => {
    expect(
      checkFields(declared, {
        name: "a",
        size: null,
        done: false,
        dueAt: "2026-01-02T03:04:05.000Z",
        tags: ["x"],
        scores: [1],
        level: "low",
        extra: { any: ["json"] },
        skipped: undefined
      })
    ).toEqual({
      name: "a",
      size: null,
      done: false,
      dueAt: new Date("2026-01-02T03:04:05.000Z"),
      tags: ["x"],
      scores: [1],
      level: "low",
      extra: { any: ["json"] }
    })
    expect(checkFields(declared, undefined)).toEqual({})
  })

  it("refuses values of the wrong type, and fields nobody declared", () => {
    for (const values of [
      { name: 1 },
      { name: null },
      { size: Number.NaN },
      { done: "yes" },
      { dueAt: "never" },
      { dueAt: 5 },
      { tags: [1] },
      { scores: "1" },
      { level: "urgent" },
      { color: "red" }
    ]) {
      expect(() => checkFields(declared, values)).toThrow(/field/)
    }
    expect(() => checkFields(declared, { extra: "x".repeat(5000) })).toThrow('The "extra" field is over 4 KB.')
    expect(checkFields(declared, { dueAt: new Date(0) })).toEqual({ dueAt: new Date(0) })
  })

  it("measures JSON in UTF-8 bytes and compares it with keys sorted", () => {
    expect(jsonBytes("é")).toBe(4)
    expect(jsonBytes(undefined)).toBe(0)
    expect(stableJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(stableJson({ a: [{ c: 2, d: 1 }], b: 1 }))
  })
})
