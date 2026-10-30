// React bindings for anchors, with no UI: apps draw their own pins.
import { useEffect, useMemo, useState, type RefObject } from "react"
import { resolveAnchor, type Anchored, type AnchorResolution } from "./dom.js"

/**
 * Where an anchored record, such as a comment thread, sits inside `root`, kept current as the page resizes, scrolls or
 * changes. `version` is the content version on screen; a different one marks the anchor `outdated`.
 */
export function useAnchorPosition(
  anchored: Anchored | undefined,
  root: RefObject<Element | null>,
  version?: string | null
): AnchorResolution | null {
  const [resolution, setResolution] = useState<AnchorResolution | null>(null)
  const anchorKey = anchored ? JSON.stringify([anchored.anchorKind, anchored.anchor, anchored.anchorVersion]) : ""
  const current = useMemo(
    () => (anchorKey === "" ? undefined : (JSON.parse(anchorKey) as [string | null, unknown, string | null])),
    [anchorKey]
  )
  useEffect(() => {
    const element = root.current
    const view = element?.ownerDocument.defaultView
    if (!current || !element || !view) {
      return
    }
    const [anchorKind, anchor, anchorVersion] = current
    const measure = () => setResolution(resolveAnchor({ anchorKind, anchor, anchorVersion }, element, version))
    // Measured after layout, then again whenever the page resizes, scrolls or changes.
    const frame = view.requestAnimationFrame(measure)
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    resized?.observe(element)
    const changed = typeof MutationObserver === "undefined" ? null : new MutationObserver(measure)
    changed?.observe(element, { childList: true, subtree: true, attributes: true })
    view.addEventListener("resize", measure)
    view.addEventListener("scroll", measure, true)
    return () => {
      view.cancelAnimationFrame(frame)
      resized?.disconnect()
      changed?.disconnect()
      view.removeEventListener("resize", measure)
      view.removeEventListener("scroll", measure, true)
    }
  }, [current, root, version])
  return current ? resolution : null
}
