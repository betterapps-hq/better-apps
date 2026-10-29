import { describe, expect, it } from "vitest"
import { fromDriverJson, toDriverJson } from "./json-columns.js"

describe("toDriverJson", () => {
  it.each([
    [{ edited: false }, '{"edited":false}'],
    [["a", "b"], '["a","b"]'],
    ["123", '"123"'],
    [123, "123"]
  ])("encodes %j for columns that store text", (value, text) => {
    expect(toDriverJson(value, { dataType: "string" })).toBe(text)
  })

  it("leaves values to columns that encode JSON", () => {
    const value = { edited: false }
    expect(toDriverJson(value, { dataType: "json" })).toBe(value)
    expect(toDriverJson("123", { dataType: "json", columnType: "MySqlJson" })).toBe("123")
    expect(toDriverJson(["a"], { dataType: "array" })).toEqual(["a"])
  })

  it("leaves null unchanged", () => {
    expect(toDriverJson(null, { dataType: "string" })).toBeNull()
  })
})

describe("fromDriverJson", () => {
  it.each([
    ['{"edited":false}', { edited: false }],
    ['"123"', "123"],
    ["123", 123]
  ])("parses %j from columns that store text", (text, value) => {
    expect(fromDriverJson(text, { dataType: "string" })).toEqual(value)
  })

  it("keeps strings that a JSON column or its driver already decoded", () => {
    expect(fromDriverJson("123", { dataType: "json", columnType: "MySqlJson" })).toBe("123")
    expect(fromDriverJson('["a"]', { dataType: "json", columnType: "SQLiteTextJson" })).toBe('["a"]')
  })

  it("returns text that isn't JSON as is", () => {
    expect(fromDriverJson("plain", { dataType: "string" })).toBe("plain")
  })
})
