// @vitest-environment happy-dom
import { BetterAppsProvider } from "@better-apps/react"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createBetterAppsClient } from "better-apps/client"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import { setup } from "../test/app.js"
import { browser } from "../test/browser.js"
import {
  countKey,
  useComments,
  useCreateThread,
  useDeleteThread,
  useReply,
  useResolveThread,
  useSuggestMentions,
  useThread,
  useThreadCounts,
  useThreads
} from "./react.js"

const onInvoice = { subjectType: "invoice", subjectId: "inv-1" } as const

function rendered(userId: "ada" | "bob" | "gus" = "bob") {
  const view = browser(userId)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BetterAppsProvider client={view.client}>{children}</BetterAppsProvider>
  )
  return { ...view, wrapper }
}

describe("comments hooks", () => {
  it("share one comments client per Better Apps client", () => {
    const { wrapper } = rendered()
    const { result } = renderHook(() => [useComments(), useComments()], { wrapper })
    expect(result.current[0]).toBe(result.current[1])
  })

  it("load a subject's threads, and show a new one at once", async () => {
    const { api, as, wrapper } = rendered()
    await api.createThread({ ...onInvoice, body: "Existing" }, as("ada"))
    const { result } = renderHook(() => ({ list: useThreads(onInvoice), create: useCreateThread() }), { wrapper })
    expect(result.current.list.state).toBe("loading")
    await waitFor(() => expect(result.current.list.state).toBe("ready"))
    expect(result.current.list.threads).toHaveLength(1)
    expect(result.current.list.users.ada?.name).toBe("Ada Lovelace")
    expect(result.current.list.hasMore).toBe(false)
    let writing: Promise<unknown> = Promise.resolve()
    act(() => {
      writing = result.current.create.mutate({ ...onInvoice, body: "New" })
    })
    expect(result.current.list.threads).toHaveLength(2)
    expect(result.current.create.status).toBe("pending")
    await act(async () => {
      await writing
    })
    expect(result.current.create.status).toBe("success")
    await act(async () => {
      await result.current.list.refresh()
      await result.current.list.loadMore()
    })
    expect(result.current.list.threads).toHaveLength(2)
  })

  it("report a refused write on the mutation, then reset", async () => {
    const { wrapper } = rendered()
    const { result } = renderHook(() => useCreateThread(), { wrapper })
    await act(async () => {
      await result.current
        .mutate({ subjectType: "invoice", subjectId: "inv-locked", body: "Hi" })
        .catch(() => undefined)
    })
    expect(result.current.status).toBe("error")
    expect(result.current.error).toMatchObject({ code: "FORBIDDEN" })
    act(() => result.current.reset())
    expect(result.current).toMatchObject({ status: "idle", error: null })
  })

  it("show a write a reset cancelled as never having run", async () => {
    const { wrapper } = rendered()
    const { result } = renderHook(() => ({ create: useCreateThread(), comments: useComments() }), { wrapper })
    let writing: Promise<unknown> = Promise.resolve()
    act(() => {
      writing = result.current.create.mutate({ ...onInvoice, body: "Hi" }).catch((error: unknown) => error)
    })
    expect(result.current.create.status).toBe("pending")
    await act(async () => {
      result.current.comments.reset()
      expect(await writing).toMatchObject({ code: "ABORTED" })
    })
    expect(result.current.create).toMatchObject({ status: "idle", error: null })
  })

  it("describe only the latest run, ignoring one that settles after a reset", async () => {
    const { wrapper } = rendered()
    const { result } = renderHook(() => useCreateThread(), { wrapper })
    let writing: Promise<unknown> = Promise.resolve()
    act(() => {
      writing = result.current.mutate({ ...onInvoice, body: "Hi" })
    })
    act(() => result.current.reset())
    await act(async () => {
      await writing
    })
    expect(result.current).toMatchObject({ status: "idle", error: null })
  })

  it("keep the newer run's state when an older one settles after it", async () => {
    const { app, identity } = setup()
    const held: (() => void)[] = []
    const client = createBetterAppsClient<typeof app>({
      baseURL: "https://app.test",
      headers: identity.headers("bob"),
      fetch: async (url, init) => {
        await new Promise<void>((resolve) => held.push(resolve))
        return app.handler(new Request(url, init))
      }
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <BetterAppsProvider client={client}>{children}</BetterAppsProvider>
    )
    const { result } = renderHook(() => useCreateThread(), { wrapper })
    let older: Promise<unknown> = Promise.resolve()
    let newer: Promise<unknown> = Promise.resolve()
    act(() => {
      older = result.current
        .mutate({ subjectType: "invoice", subjectId: "inv-locked", body: "Refused" })
        .catch((error: unknown) => error)
    })
    act(() => {
      newer = result.current.mutate({ ...onInvoice, body: "Saved" })
    })
    await waitFor(() => expect(held).toHaveLength(2))
    await act(async () => {
      held[1]?.()
      await newer
    })
    expect(result.current).toMatchObject({ status: "success", error: null })
    await act(async () => {
      held[0]?.()
      expect(await older).toMatchObject({ code: "FORBIDDEN" })
    })
    expect(result.current).toMatchObject({ status: "success", error: null })
  })

  it("load a thread with its comments, and reply", async () => {
    const { api, as, wrapper } = rendered()
    const { thread } = await api.createThread({ ...onInvoice, body: "First" }, as("ada"))
    const { result } = renderHook(
      () => ({ view: useThread(thread.id), reply: useReply(), resolve: useResolveThread(), none: useThread(null) }),
      { wrapper }
    )
    expect(result.current.none.state).toBe("idle")
    await waitFor(() => expect(result.current.view.state).toBe("ready"))
    expect(result.current.view.thread?.id).toBe(thread.id)
    expect(result.current.view.comments.map((comment) => comment.body)).toEqual(["First"])
    let writing: Promise<{ comment: { id: string } }> | undefined
    act(() => {
      writing = result.current.reply.mutate({ threadId: thread.id, body: "Second" })
    })
    const pendingId = result.current.view.comments.at(-1)?.id ?? ""
    expect(result.current.view.isPending(pendingId)).toBe(true)
    await act(async () => {
      await writing
      await result.current.resolve.mutate({ threadId: thread.id })
      await result.current.view.loadMore()
      await result.current.none.loadMore()
    })
    expect(result.current.view.isPending(pendingId)).toBe(false)
    expect(result.current.view.thread?.status).toBe("resolved")
    expect(result.current.view.hasMore).toBe(false)
  })

  it("count threads for many subjects and keep the counts current", async () => {
    const { api, as, wrapper } = rendered()
    await api.createThread({ ...onInvoice, body: "Hi" }, as("bob"))
    const { result } = renderHook(
      () => ({
        counts: useThreadCounts("invoice", ["inv-1", "inv-2"]),
        create: useCreateThread(),
        remove: useDeleteThread()
      }),
      { wrapper }
    )
    await waitFor(() =>
      expect(result.current.counts).toEqual({ "inv-1": { open: 1, total: 1 }, "inv-2": { open: 0, total: 0 } })
    )
    await act(async () => {
      await result.current.create.mutate({ subjectType: "invoice", subjectId: "inv-2", body: "More" })
    })
    expect(result.current.counts["inv-2"]).toEqual({ open: 1, total: 1 })
  })

  it("load counts again when a reset overtakes them", async () => {
    const { api, as, wrapper, requests } = rendered()
    await api.createThread({ ...onInvoice, body: "Hi" }, as("bob"))
    const { result } = renderHook(() => ({ counts: useThreadCounts("invoice", ["inv-1"]), comments: useComments() }), {
      wrapper
    })
    // The first request is still out when the reset comes, so its answer is ignored and a second one is made.
    expect(requests).toEqual(["countThreads"])
    act(() => result.current.comments.reset())
    await waitFor(() => expect(result.current.counts).toEqual({ "inv-1": { open: 1, total: 1 } }))
    expect(requests).toEqual(["countThreads", "countThreads"])
  })

  it("load failed counts again when the list mounts", async () => {
    const { wrapper, comments } = rendered()
    comments.store.setState((state) => ({
      ...state,
      counts: { [countKey("invoice", "inv-1")]: { open: 0, total: 0, state: "error" } }
    }))
    const { result } = renderHook(() => useThreadCounts("invoice", ["inv-1"]), { wrapper })
    await waitFor(() => expect(result.current).toEqual({ "inv-1": { open: 0, total: 0 } }))
  })

  it("clear mention suggestions when the store is reset", async () => {
    const { wrapper } = rendered()
    const { result } = renderHook(() => ({ mentions: useSuggestMentions(onInvoice), comments: useComments() }), {
      wrapper
    })
    await act(async () => {
      await result.current.mentions.search("ada")
    })
    expect(result.current.mentions.suggestions).toHaveLength(1)
    act(() => result.current.comments.reset())
    expect(result.current.mentions.suggestions).toEqual([])
  })

  it("suggest mentions as the viewer types", async () => {
    const { wrapper } = rendered()
    const { result } = renderHook(() => useSuggestMentions(onInvoice), { wrapper })
    await act(async () => {
      await result.current.search("ada")
    })
    expect(result.current.suggestions.map((user) => user.id)).toEqual(["ada"])
    const refused = renderHook(() => useSuggestMentions({ subjectType: "invoice", subjectId: "inv-locked" }), {
      wrapper
    })
    await act(async () => {
      expect(await refused.result.current.search("a")).toEqual([])
    })
    expect(refused.result.current.error).toMatchObject({ code: "FORBIDDEN" })
  })
})
