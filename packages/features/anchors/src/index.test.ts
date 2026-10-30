import { describe, expect, it } from "vitest"
import { defineAnchor, elementAnchor, isSafeSelector } from "./index.js"

describe("element anchors", () => {
  it("allow ids, data attributes, tag names and structural positions", () => {
    for (const selector of [
      "#total",
      "[data-row]",
      '[data-row="42"]',
      "[data-row='a b']",
      "main > section:nth-of-type(2) p:nth-child(3)",
      "li:first-child",
      "table#lines tr:last-of-type > td"
    ]) {
      expect({ selector, safe: isSafeSelector(selector) }).toEqual({ selector, safe: true })
    }
  })

  it("refuse classes, other attributes and anything that could probe a page", () => {
    for (const selector of [
      "",
      " #total",
      ".price",
      '[href^="https"]',
      '[data-x="]"]',
      "input[value=secret]",
      "div:has(> input)",
      "a, b",
      "p + p",
      "#a >",
      "x".repeat(1025)
    ]) {
      expect({ selector, safe: isSafeSelector(selector) }).toEqual({ selector, safe: false })
    }
  })

  it("checks the anchor's shape", async () => {
    const validate = (value: unknown) => elementAnchor().schema["~standard"].validate(value)
    const anchor = { selector: "#total", offset: { x: 0.5, y: 1 }, viewport: { width: 1280, height: 800 } }
    expect(await validate(anchor)).toEqual({ value: anchor })
    expect(await validate({ selector: "#total" })).toEqual({ value: { selector: "#total" } })
    for (const [value, message] of [
      [null, "An element anchor is an object."],
      [[], "An element anchor is an object."],
      [{ selector: "#a", extra: 1 }, "An element anchor has no extra field."],
      [{ selector: ".a" }, "The selector may use only ids, data attributes and structural positions."],
      [
        { selector: "#a", offset: { x: 2, y: 0 } },
        "The offset is a point inside the element, with x and y from 0 to 1."
      ],
      [{ selector: "#a", offset: null }, "The offset is a point inside the element, with x and y from 0 to 1."],
      [
        { selector: "#a", viewport: { width: 1.5, height: 2 } },
        "The viewport is a width and height in whole CSS pixels."
      ],
      [{ selector: "#a", viewport: null }, "The viewport is a width and height in whole CSS pixels."]
    ] as const) {
      expect(await validate(value)).toEqual({ issues: [{ message }] })
    }
  })
})

describe("defineAnchor", () => {
  it("returns the kind as declared", () => {
    const schema = elementAnchor().schema
    expect(defineAnchor({ kind: "spot", schema })).toEqual({ kind: "spot", schema })
  })
})
