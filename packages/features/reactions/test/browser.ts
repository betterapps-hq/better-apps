// A browser's view of the test app: a Better Apps client whose fetch goes straight to `app.handler`, signed in as one of
// the test users, and the reactions client on top of it.
import { createBetterAppsClient } from "better-apps/client"
import { createReactionsClient } from "../src/client.js"
import type { ReactionsOptions } from "../src/index.js"
import { setup, type UserId } from "./app.js"

/** `reactorsPerPage` asks for that many reactors a page, so a test can page through a few. */
export function browser(
  userId: UserId | null = "bob",
  extra: Partial<ReactionsOptions> = {},
  { reactorsPerPage }: { reactorsPerPage?: number } = {}
) {
  const server = setup(extra)
  const { app, identity } = server
  const requests: string[] = []
  // Calls to a held action wait until it's let go, so a test can make the server answer late.
  const held = new Map<string, Promise<void>>()
  // Answers of an action held this way wait after the server has answered, so a test can make an answer arrive stale.
  const heldAnswers = new Map<string, Promise<void>>()
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
      const body =
        action === "listReactors" && reactorsPerPage !== undefined
          ? JSON.stringify({ ...(JSON.parse(String(init.body)) as object), limit: reactorsPerPage })
          : init.body
      const response = await app.handler(new Request(url, { ...init, headers, body }))
      await heldAnswers.get(action)
      return response
    }
  })
  const holdIn = (waiting: Map<string, Promise<void>>, action: string) => {
    const releases: (() => void)[] = []
    waiting.set(
      action,
      new Promise<void>((resolve) => {
        releases.push(resolve)
      })
    )
    return () => {
      waiting.delete(action)
      releases.forEach((release) => release())
    }
  }
  const hold = (action: string) => holdIn(held, action)
  const holdAnswer = (action: string) => holdIn(heldAnswers, action)
  return { ...server, client, reactions: createReactionsClient(client), requests, hold, holdAnswer }
}
