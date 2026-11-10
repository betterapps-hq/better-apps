import { useAttachments } from "@better-apps/attachments/react"
import { BetterAppsProvider } from "@better-apps/react"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vite-plus/test"
import { inv1, pick, setup } from "../test/app.js"
import { useAttachmentsUploader, useDraftUploader } from "./react.js"

function rendered() {
  const view = setup()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BetterAppsProvider client={view.client}>{children}</BetterAppsProvider>
  )
  // Uploads don't wait for the network check or retry, so tests settle at once.
  const options = { transport: view.transport, network: false, retry: { retries: 0 } } as const
  return { ...view, wrapper, options }
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 20))

describe("useAttachmentsUploader", () => {
  it("checks files against the record's limits, and hands finished files to its list", async () => {
    const { wrapper, options } = rendered()
    const { result } = renderHook(
      () => ({ uploader: useAttachmentsUploader(inv1, options), list: useAttachments(inv1) }),
      { wrapper }
    )
    await waitFor(() =>
      expect(result.current.uploader.getOptions()).toMatchObject({
        accept: ["image/*", "text/plain"],
        maxSize: 1000,
        maxFiles: 3
      })
    )
    await act(() => result.current.uploader.add([pick("hello")]))
    await waitFor(() => expect(result.current.list.files.map((file) => file.name)).toEqual(["notes.txt"]))
    await waitFor(() => expect(result.current.uploader.getState().items).toEqual([]))
    expect(result.current.uploader.getOptions().maxFiles).toBe(2)
  })

  it("refuses a file the record doesn't take before asking the server", async () => {
    const { wrapper, options, calls } = rendered()
    const { result } = renderHook(() => useAttachmentsUploader(inv1, options), { wrapper })
    await waitFor(() => expect(result.current.getOptions().accept).toBeDefined())
    const [item] = await act(() => result.current.add([pick("%PDF", "contract.pdf", "application/pdf")]))
    expect(result.current.getItem(item?.id as string)?.status).toBe("rejected")
    expect(calls).not.toContain("createUpload")
  })

  it("keeps a file on its own in the queue, with its FileInfo as the result", async () => {
    const { wrapper, options } = rendered()
    const { result } = renderHook(() => useAttachmentsUploader({ owner: "user" }, options), { wrapper })
    await act(() => result.current.add([pick("hello")]))
    await waitFor(() => expect(result.current.getState().items[0]?.status).toBe("success"))
    expect(result.current.getState().items[0]?.result).toMatchObject({ name: "notes.txt", owner: "user:bob" })
  })
})

describe("useDraftUploader", () => {
  it("puts finished drafts on the saved record, then empties the queue", async () => {
    const { wrapper, options, app, calls, liveFiles } = rendered()
    const { result } = renderHook(() => useDraftUploader("comment", options), { wrapper })
    await act(() => result.current.uploader.add([pick("one", "one.txt"), pick("two", "two.txt")]))
    expect(result.current.busy).toBe(true)
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(result.current.uploader.getState().items.map((item) => item.status)).toEqual(["success", "success"])
    await act(() => result.current.attachTo("c-1"))
    expect(result.current.uploader.getState().items).toEqual([])
    const listed = await app.api.attachments.listFiles({ subjectType: "comment", subjectIds: ["c-1"] })
    expect(listed["c-1"]?.map((file) => file.name).sort()).toEqual(["one.txt", "two.txt"])
    await pause()
    expect(calls).not.toContain("deleteFile")
    expect(liveFiles()).toBe(2)
  })

  it("deletes a finished draft that's removed, and stops those still uploading when cleared", async () => {
    const { wrapper, options, liveFiles, stallSends, sends } = rendered()
    const { result } = renderHook(() => useDraftUploader("comment", options), { wrapper })
    const [first] = await act(() => result.current.uploader.add([pick("one", "one.txt")]))
    await waitFor(() => expect(result.current.busy).toBe(false))
    act(() => result.current.uploader.remove(first?.id))
    await waitFor(() => expect(liveFiles()).toBe(0))
    stallSends(true)
    await act(() => result.current.uploader.add([pick("two", "two.txt")]))
    await waitFor(() => expect(sends).toHaveLength(2))
    act(() => result.current.clear())
    expect(result.current.uploader.getState().items).toEqual([])
    expect(result.current.busy).toBe(false)
    await waitFor(() => expect(liveFiles()).toBe(0))
  })

  it("keeps drafts picked while the record saved, for the next one", async () => {
    const { wrapper, options, liveFiles, holdAnswer } = rendered()
    const { result } = renderHook(() => useDraftUploader("comment", options), { wrapper })
    await act(() => result.current.uploader.add([pick("one", "one.txt")]))
    await waitFor(() => expect(result.current.busy).toBe(false))
    const release = holdAnswer("attach")
    let attaching: Promise<void> = Promise.resolve()
    act(() => {
      attaching = result.current.attachTo("c-1")
    })
    await act(() => result.current.uploader.add([pick("two", "two.txt")]))
    await waitFor(() => expect(result.current.busy).toBe(false))
    release()
    await act(() => attaching)
    expect(result.current.uploader.getState().items.map((item) => item.name)).toEqual(["two.txt"])
    await pause()
    expect(liveFiles()).toBe(2)
  })

  it("leaves nothing to attach when no draft finished, and takes as many drafts as the record does", async () => {
    const { wrapper, options, calls } = rendered()
    const { result } = renderHook(() => useDraftUploader("invoice", options), { wrapper })
    await waitFor(() => expect(result.current.uploader.getOptions().maxFiles).toBe(3))
    await act(() => result.current.attachTo("c-1"))
    expect(calls).not.toContain("attach")
  })
})
