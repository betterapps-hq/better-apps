// Where an anchored record sits on the page in front of a viewer. Each browser works this out for itself and reports
// nothing back, because viewers of different deploys or layouts would disagree.
import { isSafeSelector, type ElementAnchor } from "./index.js"

/** Where an anchor is on this page. */
export type AnchorResolution =
  | {
      /** `outdated` means the spot was found, but the content version differs from the one the anchor was made on. */
      status: "attached" | "outdated"
      element: Element
      /** The pin's position, in CSS pixels from the root's top left corner. */
      x: number
      y: number
    }
  /** The spot isn't on this page, so the UI lists the record separately rather than losing it. */
  | { status: "detached" }

/** A record pinned to a spot, such as a comment thread, with the anchor as it's stored. */
export interface Anchored {
  /** `null` for a record on the whole subject. */
  anchorKind: string | null
  anchor: unknown
  /** The content version the anchor was made against, such as a deploy. */
  anchorVersion: string | null
}

/**
 * Finds an anchored record's spot inside `root`, the element that holds the subject's content. Returns `null` for a
 * record on the whole subject. `version` is the content version on screen, such as the deploy being viewed.
 */
export function resolveAnchor(anchored: Anchored, root: Element, version?: string | null): AnchorResolution | null {
  if (anchored.anchorKind === null) {
    return null
  }
  const anchor = anchored.anchor as ElementAnchor | null
  // Stored anchors are data: only a selector the server would accept is ever queried, and it's never inserted as HTML.
  if (anchored.anchorKind !== "element" || typeof anchor?.selector !== "string" || !isSafeSelector(anchor.selector)) {
    return { status: "detached" }
  }
  const element = root.querySelector(anchor.selector)
  if (!element) {
    return { status: "detached" }
  }
  const box = element.getBoundingClientRect()
  const frame = root.getBoundingClientRect()
  const outdated = Boolean(version && anchored.anchorVersion && version !== anchored.anchorVersion)
  return {
    status: outdated ? "outdated" : "attached",
    element,
    x: box.left - frame.left + root.scrollLeft + (anchor.offset?.x ?? 0) * box.width,
    y: box.top - frame.top + root.scrollTop + (anchor.offset?.y ?? 0) * box.height
  }
}

const plainName = /^[A-Za-z_][\w-]*$/

function unique(root: Element, selector: string, element: Element): boolean {
  const matches = root.querySelectorAll(selector)
  return matches.length === 1 && matches[0] === element
}

/**
 * A selector that finds `element` inside `root`, using only ids, data attributes and structural positions: its own id
 * or a data attribute when either is unique, else its position under the nearest uniquely identified ancestor.
 */
export function selectorFor(element: Element, root: Element): string {
  const own = ownSelector(element, root)
  if (own) {
    return own
  }
  const steps: string[] = []
  let current: Element | null = element
  while (current && current !== root) {
    const parent: Element | null = current.parentElement
    const tag = current.tagName.toLowerCase()
    const sameTag = parent ? Array.from(parent.children).filter((child) => child.tagName === current?.tagName) : []
    steps.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(current) + 1})` : tag)
    const anchor = parent && parent !== root ? ownSelector(parent, root) : null
    if (anchor) {
      steps.unshift(anchor)
      break
    }
    current = parent
  }
  return steps.join(" > ")
}

function ownSelector(element: Element, root: Element): string | null {
  if (element.id && plainName.test(element.id) && unique(root, `#${element.id}`, element)) {
    return `#${element.id}`
  }
  for (const { name, value } of Array.from(element.attributes)) {
    if (!name.startsWith("data-") || !/^data-[\w-]+$/.test(name) || /["\\\]]/.test(value)) {
      continue
    }
    const selector = `[${name}="${value}"]`
    if (isSafeSelector(selector) && unique(root, selector, element)) {
      return selector
    }
  }
  return null
}

/**
 * Builds an element anchor for a spot a viewer picked, such as by clicking: the element's selector, the point inside it
 * when given, and the viewport size.
 */
export function elementAnchorFor(
  element: Element,
  root: Element,
  point?: { clientX: number; clientY: number }
): ElementAnchor {
  const anchor: ElementAnchor = { selector: selectorFor(element, root) }
  if (point) {
    const box = element.getBoundingClientRect()
    const fraction = (offset: number, size: number) => (size > 0 ? Math.min(1, Math.max(0, offset / size)) : 0)
    anchor.offset = {
      x: Math.round(fraction(point.clientX - box.left, box.width) * 1000) / 1000,
      y: Math.round(fraction(point.clientY - box.top, box.height) * 1000) / 1000
    }
  }
  const view = element.ownerDocument.defaultView
  if (view) {
    anchor.viewport = { width: Math.round(view.innerWidth), height: Math.round(view.innerHeight) }
  }
  return anchor
}
