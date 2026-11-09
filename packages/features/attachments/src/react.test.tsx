// @vitest-environment happy-dom
import { BetterAppsProvider } from "@better-apps/react"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vite-plus/test"
import { inv1, secret } from "../test/app.js"
import { browser, pick } from "../test/browser.js"
import { useAttachmentSettings, useAttachments, useAttachmentsClient, useDraftAttachments, useUpload } from "./react.js"

function rendered(userId: "bob" | "cy" = "bob", extra: Parameters<typeof browser>[1] = {}) {
  const view = browser(userId, extra)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BetterAppsProvider client={view.client}>{children}</BetterAppsProvider>
  )
  return { ...view, wrapper }
}

describe("attachments hooks", () => {
  it("share one attachments client per Better Apps client", () => {
    const { wrapper, attachments } = rendered()
    const { result } = renderHook(() => [useAttachmentsClient(), useAttachmentsClient()], { wrapper })
    expect(result.current[0]).toBe(result.current[1])
    expect(result.current[0]).toBe(attachments)
  })

  it("load a record's files, and take one off", async () => {
    const { upload, wrapper } = rendered()
    const { file } = await upload("bob", inv1)
    const { result } = renderHook(() => useAttachments(inv1), { wrapper })
    expect(result.current.state).toBe("loading")
    await waitFor(() => expect(result.current.state).toBe("ready"))
    expect(result.current.files.map((entry) => entry.id)).toEqual([file.id])
    await act(async () => {
      await result.current.detach(file.id)
    })
    expect(result.current.files).toEqual([])
    expect(result.current.isPending(file.id)).toBe(false)
    expect(result.current.writeError).toBeNull()
  })

  it("load a record again before its signed URLs expire", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
    try {
      const { upload, wrapper, requests } = rendered("bob", { secret, downloadTtl: 120 })
      await upload("bob", inv1)
      const { result } = renderHook(() => useAttachments(inv1), { wrapper })
      const loads = () => requests.filter((name) => name === "listFiles").length
      // Moves the faked clock on a little at a time, letting the real event loop turn between steps, as signing with
      // Web Crypto needs, until the check passes or two seconds of faked time have gone by.
      const until = async (check: () => boolean) => {
        for (let step = 0; step < 400 && !check(); step += 1) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(5)
          })
          await new Promise((resolve) => setImmediate(resolve))
        }
      }
      await until(() => result.current.files.length === 1)
      const first = result.current.files[0]?.urlExpiresAt as Date
      expect(first).toBeInstanceOf(Date)
      expect(loads()).toBe(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(first.getTime() - Date.now() - 61_000)
      })
      expect(loads()).toBe(1)
      await until(() => (result.current.files[0]?.urlExpiresAt?.getTime() ?? 0) > first.getTime())
      expect(loads()).toBe(2)
      expect(result.current.files[0]?.urlExpiresAt?.getTime()).toBeGreaterThan(first.getTime())
    } finally {
      vi.useRealTimers()
    }
  })

  it("report a refused change until the next one", async () => {
    const { upload, wrapper } = rendered("cy")
    const { file } = await upload("bob", inv1)
    const { result } = renderHook(() => useAttachments(inv1), { wrapper })
    await waitFor(() => expect(result.current.state).toBe("ready"))
    await act(async () => {
      await result.current.detach(file.id)
    })
    expect(result.current.writeError).toMatchObject({ code: "FORBIDDEN" })
    await act(async () => {
      await result.current.reorder([file.id])
    })
    expect(result.current.writeError).toBeNull()
  })

  it("upload onto a record and show each upload", async () => {
    const { wrapper } = rendered()
    const { result } = renderHook(() => ({ upload: useUpload(inv1), files: useAttachments(inv1) }), { wrapper })
    await act(async () => {
      await result.current.upload.upload([pick("a"), pick("b", "b.txt")])
    })
    expect(result.current.upload.uploads.map((upload) => [upload.name, upload.state])).toEqual([
      ["notes.txt", "done"],
      ["b.txt", "done"]
    ])
    await waitFor(() => expect(result.current.files.files).toHaveLength(2))
    act(() => result.current.upload.dismiss(result.current.upload.uploads.map((upload) => upload.id)))
    expect(result.current.upload.uploads).toEqual([])
  })

  it("upload drafts, then attach them once the record is saved", async () => {
    const { wrapper, count } = rendered()
    const { result } = renderHook(
      () => ({
        drafts: useDraftAttachments("invoice"),
        files: useAttachments({ subjectType: "invoice", subjectId: "inv-2" })
      }),
      { wrapper }
    )
    await act(async () => {
      await result.current.drafts.add([pick("keep"), pick("drop", "drop.txt")])
    })
    expect(result.current.drafts.busy).toBe(false)
    const dropped = result.current.drafts.uploads[1]?.id as string
    act(() => result.current.drafts.remove(dropped))
    expect(result.current.drafts.uploads.map((upload) => upload.name)).toEqual(["notes.txt"])
    await act(async () => {
      await result.current.drafts.attachTo("inv-2")
    })
    expect(result.current.drafts.uploads).toEqual([])
    await waitFor(() => expect(result.current.files.files.map((file) => file.name)).toEqual(["notes.txt"]))
    await waitFor(() => expect(count("attachmentFile")).toBe(1))
  })

  it("clear drafts, deleting the ones that finished", async () => {
    const { wrapper, count } = rendered()
    const { result } = renderHook(() => useDraftAttachments("invoice"), { wrapper })
    await act(async () => {
      await result.current.add([pick("a")])
    })
    act(() => result.current.clear())
    expect(result.current.uploads).toEqual([])
    await waitFor(() => expect(count("attachmentFile")).toBe(0))
  })

  it("load the limits for a picker", async () => {
    const { wrapper } = rendered()
    const { result } = renderHook(() => useAttachmentSettings("invoice"), { wrapper })
    await waitFor(() => expect(result.current.settings?.maxFiles).toBe(3))
    const failed = renderHook(() => useAttachmentSettings("ticket" as "invoice"), { wrapper })
    await waitFor(() => expect(failed.result.current.error).toMatchObject({ code: "INVALID_INPUT" }))
  })
})
