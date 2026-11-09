// A browser's view of the test app: a Better Apps client whose fetch goes straight to `app.handler`, signed in as one of
// the test users, and the attachments client on top of it, whose uploads go to the feature's routes or to storage.
import { createBetterAppsClient } from "better-apps/client"
import { createAttachmentsClient, type TransportRequest } from "../src/client.js"
import type { AttachmentsOptions } from "../src/index.js"
import { setup, type UserId } from "./app.js"

export function browser(
  userId: UserId | null = "bob",
  extra: Partial<AttachmentsOptions> = {},
  { signedUploads = false } = {}
) {
  const server = setup(extra, { signedUploads })
  const { app, identity } = server
  const requests: string[] = []
  // Calls to a held action wait until it's let go, so a test can make the server answer late.
  const held = new Map<string, Promise<void>>()
  const client = createBetterAppsClient<typeof app>({
    baseURL: "https://app.test",
    fetch: async (url, init) => {
      const action = url.slice(url.lastIndexOf("/") + 1)
      requests.push(action)
      await held.get(action)
      const headers = new Headers(init.headers)
      for (const [name, value] of Object.entries(userId ? identity.headers(userId) : {})) {
        headers.set(name, value)
      }
      return app.handler(new Request(url, { ...init, headers }))
    }
  })
  const progress: number[] = []
  // Bytes go where the server said, half then all of them, so progress shows. A stalled send waits until it's aborted.
  let stall = false
  const transport = async (request: TransportRequest) => {
    request.onProgress(Math.floor(request.body.size / 2))
    progress.push(Math.floor(request.body.size / 2))
    if (stall) {
      await new Promise((_, reject) =>
        request.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
      )
    }
    const response = await server.send(
      { url: request.url, headers: request.headers },
      new Uint8Array(await request.body.arrayBuffer())
    )
    request.onProgress(request.body.size)
    return { status: response.status }
  }
  const hold = (action: string) => {
    let release: () => void = () => undefined
    held.set(
      action,
      new Promise<void>((resolve) => {
        release = resolve
      })
    )
    return () => {
      held.delete(action)
      release()
    }
  }
  return {
    ...server,
    client,
    attachments: createAttachmentsClient(client, { transport }),
    requests,
    progress,
    hold,
    stallUploads: (on: boolean) => {
      stall = on
    }
  }
}

/** A file as a browser's file picker gives it. */
export function pick(body: string, name = "notes.txt", type = "text/plain"): File {
  return new File([body], name, { type })
}
