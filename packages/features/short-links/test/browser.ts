// A browser's view of the test app: a Better Apps client whose fetch goes straight to `app.handler`, signed in as one of
// the test users, and the short links client on top of it.
import { createBetterAppsClient } from "better-apps/client"
import { createShortLinksClient } from "../src/client.js"
import { setup, type UserId } from "./app.js"

export function browser(userId: UserId | null = "ada") {
  const server = setup()
  const { app, identity } = server
  const requests: string[] = []
  // Calls to a held action wait until it's let go, so a test can make the server answer late: before it reads
  // anything, or, for an answer held, after it answered.
  const held = new Map<string, { gate: Promise<void>; answer: boolean }>()
  const client = createBetterAppsClient<typeof app>({
    baseURL: "https://app.test",
    fetch: async (url, init) => {
      const action = url.slice(url.lastIndexOf("/") + 1)
      requests.push(action)
      const waiting = held.get(action)
      if (waiting && !waiting.answer) {
        await waiting.gate
      }
      const headers = new Headers(init.headers)
      for (const [name, value] of Object.entries(userId ? identity.headers(userId) : {})) {
        headers.set(name, value)
      }
      const response = await app.handler(new Request(url, { ...init, headers }))
      if (waiting?.answer) {
        await waiting.gate
      }
      return response
    }
  })
  const hold = (action: string, { answer = false }: { answer?: boolean } = {}) => {
    let release: () => void = () => undefined
    held.set(action, {
      gate: new Promise<void>((resolve) => {
        release = resolve
      }),
      answer
    })
    return () => {
      held.delete(action)
      release()
    }
  }
  return { ...server, client, links: createShortLinksClient(client), requests, hold }
}
