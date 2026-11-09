// @vitest-environment happy-dom
import { BetterAppsProvider } from "@better-apps/react"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vite-plus/test"
import { browser } from "../test/browser.js"
import { useReactionSettings, useReactions, useReactors, useSubjectReactions } from "./react.js"

const inv1 = { subjectType: "invoice", subjectId: "inv-1" } as const

function rendered(userId: "ada" | "bob" | "gus" = "bob") {
  const view = browser(userId)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BetterAppsProvider client={view.client}>{children}</BetterAppsProvider>
  )
  return { ...view, wrapper }
}

describe("reactions hooks", () => {
  it("share one reactions client per Better Apps client", () => {
    const { wrapper } = rendered()
    const { result } = renderHook(() => [useReactions(), useReactions()], { wrapper })
    expect(result.current[0]).toBe(result.current[1])
  })

  it("load records that mount together in one call, and toggle at once", async () => {
    const { api, as, requests, wrapper } = rendered()
    await api.react({ ...inv1, emoji: "👍" }, as("ada"))
    const { result } = renderHook(
      () => ({
        first: useSubjectReactions(inv1),
        second: useSubjectReactions({ subjectType: "invoice", subjectId: "inv-2" })
      }),
      { wrapper }
    )
    expect(result.current.first.state).toBe("loading")
    await waitFor(() => expect(result.current.first.state).toBe("ready"))
    expect(requests.filter((name) => name !== "getSettings")).toEqual(["listReactions"])
    expect(result.current.first.reactions).toEqual([{ emoji: "👍", count: 1, reacted: false }])
    let toggling: Promise<void> = Promise.resolve()
    act(() => {
      toggling = result.current.first.toggle("👍")
    })
    expect(result.current.first.reactions).toEqual([{ emoji: "👍", count: 2, reacted: true }])
    expect(result.current.first.isPending("👍")).toBe(true)
    await act(async () => {
      await toggling
    })
    expect(result.current.first.isPending("👍")).toBe(false)
    expect(result.current.first.writeError).toBeNull()
  })

  it("report a refused toggle until the next one, and not one a reset cancelled", async () => {
    const { reactions, wrapper } = rendered()
    const locked = { subjectType: "invoice", subjectId: "inv-locked" } as const
    const { result } = renderHook(() => useSubjectReactions(locked), { wrapper })
    await waitFor(() => expect(result.current.state).toBe("ready"))
    await act(async () => {
      await result.current.toggle("👍")
    })
    expect(result.current.writeError).toMatchObject({ code: "FORBIDDEN" })
    expect(result.current.reactions).toEqual([])
    await act(async () => {
      const toggling = result.current.toggle("👍")
      reactions.reset()
      await toggling
    })
    expect(result.current.writeError).toBeNull()
  })

  it("load who reacted with an emoji", async () => {
    const { api, as, wrapper } = rendered()
    await api.react({ ...inv1, emoji: "🎉" }, as("ada"))
    const { result } = renderHook(() => useReactors(inv1, "🎉"), { wrapper })
    expect(result.current.state).toBe("loading")
    await waitFor(() => expect(result.current.state).toBe("ready"))
    expect(result.current.userIds).toEqual(["ada"])
    expect(result.current.users.ada?.name).toBe("Ada Lovelace")
    expect(result.current.hasMore).toBe(false)
    await act(async () => {
      await result.current.loadMore()
    })
    expect(result.current.error).toBeNull()
  })
})

describe("useReactionSettings", () => {
  it("loads how reactions work on a record, or the error", async () => {
    const { wrapper } = rendered()
    const { result } = renderHook(() => useReactionSettings(inv1), { wrapper })
    expect(result.current.settings).toBeNull()
    await waitFor(() => expect(result.current.settings).toMatchObject({ maxPerUser: 20, emojis: null }))
    const hidden = renderHook(() => useReactionSettings({ subjectType: "invoice", subjectId: "inv-globex" }), {
      wrapper
    })
    await waitFor(() => expect(hidden.result.current.error).toMatchObject({ code: "NOT_FOUND" }))
  })
})
