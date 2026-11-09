// @vitest-environment happy-dom
import { BetterAppsProvider } from "@better-apps/react"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vite-plus/test"
import { browser } from "../test/browser.js"
import { useLinks, useShortLinks } from "./react.js"

const inv1 = { subjectType: "invoice", subjectId: "inv-1" } as const

function rendered() {
  const view = browser("ada")
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BetterAppsProvider client={view.client}>{children}</BetterAppsProvider>
  )
  return { ...view, wrapper }
}

describe("short links hooks", () => {
  it("share one short links client per Better Apps client", () => {
    const { wrapper } = rendered()
    const { result } = renderHook(() => [useShortLinks(), useShortLinks()], { wrapper })
    expect(result.current[0]).toBe(result.current[1])
  })

  it("load a record's links on first use, once, and show links made through the client", async () => {
    const { api, as, requests, wrapper } = rendered()
    await api.create({ target: inv1 }, as("ada"))
    const { result } = renderHook(() => ({ first: useLinks(inv1), second: useLinks(inv1) }), { wrapper })
    await waitFor(() => expect(result.current.first.state).toBe("ready"))
    expect(requests).toEqual(["list"])
    expect(result.current.second.links).toHaveLength(1)
    await act(async () => {
      await result.current.first.client.create({ target: inv1 })
    })
    expect(result.current.second.links).toHaveLength(2)
    await act(async () => {
      await result.current.first.loadMore()
    })
    expect(requests).toEqual(["list", "create"])
  })
})
