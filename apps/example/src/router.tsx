import { createCommentsClient } from "@better-apps/comments/client"
import { BetterAppsProvider } from "@better-apps/react"
import { createRouter } from "@tanstack/react-router"
import { createBetterAppsClient } from "better-apps/client"
import type { App } from "./app-types"
import { ErrorMessage, NotFound } from "./components"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  // A client and comments store per router. The server makes a router for each request, so one viewer's comments never
  // reach another viewer's page.
  const client = createBetterAppsClient<App>()
  const comments = createCommentsClient(client)
  return createRouter({
    routeTree,
    context: { comments },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultErrorComponent: ErrorMessage,
    defaultNotFoundComponent: NotFound,
    // Comments loaded for the server render reach the browser with the router's own state, so the first paint has them.
    dehydrate: () => ({ comments: comments.dehydrate() }),
    hydrate: (dehydrated) => comments.hydrate(dehydrated.comments),
    Wrap: ({ children }) => <BetterAppsProvider client={client}>{children}</BetterAppsProvider>
  })
}
