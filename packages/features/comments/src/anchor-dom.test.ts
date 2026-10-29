// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { elementAnchorFor, resolveAnchor, selectorFor } from "./anchor-dom.js"

function page(html: string) {
  const root = document.createElement("main")
  root.innerHTML = html
  document.body.replaceChildren(root)
  return root
}

function place(element: Element, box: { left: number; top: number; width: number; height: number }) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => box
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("selectorFor", () => {
  it("prefers a unique id, then a unique data attribute, then a position under the nearest one", () => {
    const root = page(`
      <section id="totals"><p>Subtotal</p><p id="tax">Tax</p><p data-line="3">Total</p></section>
      <ul data-list="items"><li>One</li><li>Two</li></ul>
      <div><p>Loose</p><p>Second</p></div>
      <p id="dup">A</p><p id="dup">B</p><p id="has.dot">C</p><p data-x='a"b'>D</p>
    `)
    const pick = (selector: string, index = 0) => root.querySelectorAll(selector)[index] as Element
    expect(selectorFor(pick("#tax"), root)).toBe("#tax")
    expect(selectorFor(pick("[data-line]"), root)).toBe('[data-line="3"]')
    expect(selectorFor(pick("li", 1), root)).toBe('[data-list="items"] > li:nth-of-type(2)')
    expect(selectorFor(pick("section p"), root)).toBe("#totals > p:nth-of-type(1)")
    expect(selectorFor(pick("div p", 1), root)).toBe("div > p:nth-of-type(2)")
    // A duplicated id isn't unique, so its position is used.
    expect(selectorFor(pick("p", 6), root)).toBe("p:nth-of-type(2)")
    expect(selectorFor(pick("p", 7), root)).toBe("p:nth-of-type(3)")
    expect(selectorFor(pick("p", 8), root)).toBe("p:nth-of-type(4)")
    for (const element of [pick("li", 1), pick("section p"), pick("div p", 1)]) {
      expect(root.querySelector(selectorFor(element, root))).toBe(element)
    }
  })
})

describe("resolveAnchor", () => {
  it("places a pin inside its element, relative to the root", () => {
    const root = page('<p id="total">Total</p>')
    place(root, { left: 100, top: 50, width: 800, height: 600 })
    place(root.querySelector("#total") as Element, { left: 300, top: 150, width: 200, height: 40 })
    const thread = {
      anchorKind: "element",
      anchor: { selector: "#total", offset: { x: 0.5, y: 1 } },
      anchorVersion: "v1"
    }
    expect(resolveAnchor(thread, root, "v1")).toMatchObject({ status: "attached", x: 300, y: 140 })
    expect(resolveAnchor(thread, root)).toMatchObject({ status: "attached" })
    expect(resolveAnchor(thread, root, "v2")).toMatchObject({ status: "outdated", x: 300 })
    expect(resolveAnchor({ ...thread, anchor: { selector: "#total" } }, root)).toMatchObject({ x: 200, y: 100 })
  })

  it("reports threads it can't place, and ignores threads on the whole subject", () => {
    const root = page('<p class="total">Total</p>')
    const thread = (anchor: unknown, anchorKind = "element") => ({ anchorKind, anchor, anchorVersion: null })
    expect(resolveAnchor({ anchorKind: null, anchor: null, anchorVersion: null }, root)).toBeNull()
    expect(resolveAnchor(thread({ selector: "#gone" }), root)).toEqual({ status: "detached" })
    expect(resolveAnchor(thread({ selector: ".total" }), root)).toEqual({ status: "detached" })
    expect(resolveAnchor(thread(null), root)).toEqual({ status: "detached" })
    expect(resolveAnchor(thread({ x: 1 }, "region"), root)).toEqual({ status: "detached" })
  })
})

describe("elementAnchorFor", () => {
  it("records the element, the point inside it and the viewport", () => {
    const root = page('<p id="total">Total</p>')
    const element = root.querySelector("#total") as Element
    place(element, { left: 100, top: 100, width: 300, height: 0 })
    expect(elementAnchorFor(element, root, { clientX: 200, clientY: 500 })).toEqual({
      selector: "#total",
      offset: { x: 0.333, y: 0 },
      viewport: { width: window.innerWidth, height: window.innerHeight }
    })
    expect(elementAnchorFor(element, root, { clientX: 900, clientY: 0 }).offset).toEqual({ x: 1, y: 0 })
    expect(elementAnchorFor(element, root)).not.toHaveProperty("offset")
  })
})
