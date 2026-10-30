// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react"
import { useRef } from "react"
import { describe, expect, it, vi } from "vitest"
import { useAnchorPosition } from "./react.js"

describe("useAnchorPosition", () => {
  it("tracks an anchored record's position on the page", async () => {
    const root = document.createElement("main")
    root.innerHTML = '<p id="total">Total</p>'
    document.body.replaceChildren(root)
    const thread = { anchorKind: "element", anchor: { selector: "#total" }, anchorVersion: "v1" }
    const { result, rerender } = renderHook(
      ({ version, target }: { version: string; target: typeof thread | undefined }) => {
        const ref = useRef<Element | null>(root)
        return useAnchorPosition(target, ref, version)
      },
      { initialProps: { version: "v1", target: thread as typeof thread | undefined } }
    )
    await waitFor(() => expect(result.current).toMatchObject({ status: "attached" }))
    const spy = vi.fn<() => void>()
    window.addEventListener("resize", spy)
    act(() => {
      window.dispatchEvent(new Event("resize"))
    })
    rerender({ version: "v2", target: thread })
    await waitFor(() => expect(result.current).toMatchObject({ status: "outdated" }))
    rerender({ version: "v2", target: undefined })
    await waitFor(() => expect(result.current).toBeNull())
    window.removeEventListener("resize", spy)
  })
})
