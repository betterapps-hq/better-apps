// A browser's view of the test app: a Better Apps client whose fetch goes straight to `app.handler`, signed in as one of
// the test users, and the comments client on top of it.
import { createBetterAppsClient } from "better-apps/client"
import { createCommentsClient } from "../src/client.js"
import type { CommentsOptions } from "../src/index.js"
import { setup, type UserId } from "./app.js"

export function browser(userId: UserId | null = "bob", extra: Partial<CommentsOptions> = {}) {
  const server = setup(extra)
  const { app, identity } = server
  const requests: string[] = []
  const client = createBetterAppsClient<typeof app>({
    baseURL: "https://app.test",
    fetch: (url, init) => {
      requests.push(url.slice(url.lastIndexOf("/") + 1))
      const headers = new Headers(init.headers)
      for (const [name, value] of Object.entries(userId ? identity.headers(userId) : {})) {
        headers.set(name, value)
      }
      return app.handler(new Request(url, { ...init, headers }))
    }
  })
  return { ...server, client, comments: createCommentsClient(client), requests }
}
