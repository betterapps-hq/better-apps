import { describe, expect, it } from "vitest"
import { fromDriverDate, toDriverDate } from "./date-columns.js"

const date = new Date("2026-01-02T03:04:05.678Z")

describe("toDriverDate", () => {
  it.each([
    ["Drizzle 0.x", { dataType: "string" }],
    ["Drizzle 1.x", { dataType: "string timestamp" }]
  ])("writes UTC text to %s string columns", (_, column) => {
    expect(toDriverDate(date, column, "pg")).toBe("2026-01-02T03:04:05.678Z")
    expect(toDriverDate(date, column, "mysql")).toBe("2026-01-02 03:04:05.678")
    expect(toDriverDate([date, "kept"], column, "sqlite")).toEqual(["2026-01-02T03:04:05.678Z", "kept"])
  })

  it("leaves dates for other columns to Drizzle", () => {
    expect(toDriverDate(date, { dataType: "date" }, "pg")).toBe(date)
    expect(toDriverDate(date, undefined, "pg")).toBe(date)
  })
})

describe("fromDriverDate", () => {
  it.each(["2026-01-02 03:04:05.678", "2026-01-02T03:04:05.678", "2026-01-02T03:04:05.678Z", date.getTime(), date])(
    "reads %j as UTC",
    (value) => {
      expect(fromDriverDate(value)).toEqual(date)
    }
  )
})
