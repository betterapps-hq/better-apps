import type { StandardSchemaV1 } from "better-apps"

/**
 * A kind of spot inside a subject, such as an element on a page, that a feature pins things to: a comment thread or an
 * annotation. The server checks and stores the spot as JSON, with the content version it was made against; each
 * viewer's browser finds it and decides for itself whether it still fits.
 */
export interface AnchorKind<Kind extends string = string, Value = unknown> {
  kind: Kind
  /** Checks a spot before it's stored. Keep anchors small: features cap them, such as comments at 4 KB. */
  schema: StandardSchemaV1<unknown, Value>
}

/** Declares an anchor kind and keeps its kind and value types for inference. */
export function defineAnchor<const Kind extends string, Value>(
  anchor: AnchorKind<Kind, Value>
): AnchorKind<Kind, Value> {
  return anchor
}

/** A spot on a page: an element, an optional point inside it, and the viewport it was made in. */
export interface ElementAnchor {
  /** Finds the element. It may use only ids, data attributes and structural positions. */
  selector: string
  /** A point inside the element, as fractions of its width and height. */
  offset?: { x: number; y: number } | undefined
  /** The viewport the anchor was made in, in CSS pixels. */
  viewport?: { width: number; height: number } | undefined
}

const name = String.raw`[A-Za-z_][\w-]*`
const compoundPart = new RegExp(
  [
    String.raw`#${name}`,
    String.raw`\[data-[\w-]+(?:="[^"\\\]]*"|='[^'\\\]]*')?\]`,
    String.raw`:(?:nth-child|nth-of-type)\(\d{1,4}\)`,
    String.raw`:(?:first|last)-(?:child|of-type)`
  ].join("|"),
  "y"
)
const tagName = /[A-Za-z][A-Za-z0-9-]*/y
const combinator = /\s*>\s*|\s+/y

function matchAt(pattern: RegExp, text: string, index: number): string | null {
  pattern.lastIndex = index
  return pattern.exec(text)?.[0] ?? null
}

/**
 * Whether a selector uses only ids, data attributes, tag names and structural positions, joined by descendant or child
 * combinators. Matching other attribute values could probe a page's content, so it's refused.
 */
export function isSafeSelector(selector: string): boolean {
  if (selector.length === 0 || selector.length > 1024 || selector !== selector.trim()) {
    return false
  }
  let index = 0
  for (;;) {
    const start = index
    index += matchAt(tagName, selector, index)?.length ?? 0
    for (let part = matchAt(compoundPart, selector, index); part; part = matchAt(compoundPart, selector, index)) {
      index += part.length
    }
    if (index === start) {
      return false
    }
    if (index === selector.length) {
      return true
    }
    const joined = matchAt(combinator, selector, index)
    if (!joined) {
      return false
    }
    index += joined.length
  }
}

const isFraction = (value: unknown) => typeof value === "number" && value >= 0 && value <= 1
const isSize = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100_000

function readElementAnchor(value: unknown): ElementAnchor | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "An element anchor is an object."
  }
  const { selector, offset, viewport, ...rest } = value as Record<string, unknown>
  if (Object.keys(rest).length > 0) {
    return `An element anchor has no ${Object.keys(rest).join(", ")} field.`
  }
  if (typeof selector !== "string" || !isSafeSelector(selector)) {
    return "The selector may use only ids, data attributes and structural positions."
  }
  const anchor: ElementAnchor = { selector }
  if (offset !== undefined) {
    const { x, y } = (offset ?? {}) as Record<string, unknown>
    if (!isFraction(x) || !isFraction(y)) {
      return "The offset is a point inside the element, with x and y from 0 to 1."
    }
    anchor.offset = { x: x as number, y: y as number }
  }
  if (viewport !== undefined) {
    const { width, height } = (viewport ?? {}) as Record<string, unknown>
    if (!isSize(width) || !isSize(height)) {
      return "The viewport is a width and height in whole CSS pixels."
    }
    anchor.viewport = { width: width as number, height: height as number }
  }
  return anchor
}

/** Pins to an element on a page, such as a preview deploy. Each browser finds the element with `querySelector`. */
export function elementAnchor(): AnchorKind<"element", ElementAnchor> {
  return defineAnchor<"element", ElementAnchor>({
    kind: "element",
    schema: {
      "~standard": {
        version: 1,
        vendor: "better-apps",
        validate: (value) => {
          const anchor = readElementAnchor(value)
          return typeof anchor === "string" ? { issues: [{ message: anchor }] } : { value: anchor }
        }
      }
    }
  })
}
