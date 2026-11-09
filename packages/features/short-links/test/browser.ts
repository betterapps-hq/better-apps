// A browser's view of the test app: a Better Apps client whose fetch goes straight to `app.handler`, signed in as one of
// the test users, and the short links client on top of it.
import { createBetterAppsClient } from "better-apps/client"
import { createShortLinksClient } from "../src/client.js"
import { setup, type UserId } from "./app.js"

export function browser(userId: UserId | null = "ada") {
  const server = setup()
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
  return { ...server, client, links: createShortLinksClient(client), requests, hold }
}
