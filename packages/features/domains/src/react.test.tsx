// @vitest-environment happy-dom
import { BetterAppsProvider } from "@better-apps/react"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vite-plus/test"
import { browser } from "../test/browser.js"
import { useDomains, useDomainsClient } from "./react.js"

function rendered() {
  const view = browser()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BetterAppsProvider client={view.client}>{children}</BetterAppsProvider>
  )
  return { ...view, wrapper }
}

describe("useDomains", () => {
  it("shares the Better Apps client's store", () => {
    const { wrapper, domains } = rendered()
    const { result } = renderHook(() => useDomainsClient(), { wrapper })
    expect(result.current).toBe(domains)
  })

  it("loads on first use and shows what changes", async () => {
    const { wrapper, requests } = rendered()
    const { result } = renderHook(() => useDomains(), { wrapper })
    expect(result.current.state).toBe("loading")
    await waitFor(() => expect(result.current.state).toBe("ready"))
    expect(requests).toEqual(["list"])
    expect(result.current.list?.subdomainZone).toBe("yourapp.com")
    await act(() => result.current.add({ kind: "subdomain", label: "acme" }))
    expect(result.current.domains.map((domain) => domain.hostname)).toEqual(["acme.yourapp.com"])
    expect(result.current.error).toBeNull()
    expect(result.current.calls).toEqual({})
  })
})
