import { act, render, renderHook, screen } from "@testing-library/react"
import { createBetterAppsClient, createStore } from "better-apps/client"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { BetterAppsProvider, useBetterApps, useStore } from "./index.js"

describe("useBetterApps", () => {
  it("returns the provider's client", () => {
    const client = createBetterAppsClient({ fetch: () => Promise.resolve(Response.json("pong")) })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <BetterAppsProvider client={client}>{children}</BetterAppsProvider>
    )
    const { result } = renderHook(() => useBetterApps(), { wrapper })
    expect(result.current).toBe(client)
  })

  it("explains a missing provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    expect(() => renderHook(() => useBetterApps())).toThrow("useBetterApps needs a BetterAppsProvider above it.")
    vi.restoreAllMocks()
  })
})

describe("useStore", () => {
  it("re-renders when the store changes", () => {
    const store = createStore({ count: 0, label: "a" })
    function Count() {
      return <output>{useStore(store).count}</output>
    }
    render(<Count />)
    expect(screen.getByRole("status").textContent).toBe("0")
    act(() => store.setState((state) => ({ ...state, count: 1 })))
    expect(screen.getByRole("status").textContent).toBe("1")
  })

  it("re-renders a selection only when it changes, and caches new objects per state", () => {
    const store = createStore({ count: 0, label: "a" })
    const renders = vi.fn<() => void>()
    const { result } = renderHook(() => {
      renders()
      return useStore(
        store,
        (state) => ({ label: state.label }),
        (a, b) => a.label === b.label
      )
    })
    const first = result.current
    act(() => store.setState((state) => ({ ...state, count: 1 })))
    expect(result.current).toBe(first)
    act(() => store.setState((state) => ({ ...state, label: "b" })))
    expect(result.current).toEqual({ label: "b" })
    // The first render, then the label change; the count change selected an equal value.
    expect(renders).toHaveBeenCalledTimes(2)
  })

  it("follows a selector that changes between renders", () => {
    const store = createStore({ a: 1, b: 2 })
    const { result, rerender } = renderHook(({ key }: { key: "a" | "b" }) => useStore(store, (state) => state[key]), {
      initialProps: { key: "a" as "a" | "b" }
    })
    expect(result.current).toBe(1)
    rerender({ key: "b" })
    expect(result.current).toBe(2)
  })
})
