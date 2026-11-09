import { getThemeInitScript } from "@buildkitgg/shadcn-theme"
import { createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { AppShell } from "../app-shell"
import type { Comments } from "../app-types"
import { themeOptions } from "../ui"
import { getViewer } from "../viewer.functions"
import styles from "../styles.css?url"

/** What every route's loader gets from the router. */
export interface RouterContext {
  /** The comments store, which loaders fill for the server render. */
  comments: Comments
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Who the page is for. It changes only on sign-in or sign-out, which invalidate the router.
  loader: () => getViewer(),
  staleTime: Number.POSITIVE_INFINITY,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Better Invoices" },
      { name: "description", content: "An invoicing app that runs Better Apps features." }
    ],
    links: [{ rel: "stylesheet", href: styles }],
    // Applies the saved appearance before the first paint, so a dark page never flashes light.
    scripts: [{ children: getThemeInitScript(themeOptions) }]
  }),
  shellComponent: RootDocument
})

interface RootDocumentProps {
  children: ReactNode
}

function RootDocument({ children }: RootDocumentProps) {
  return (
    // The theme script sets the theme's class and color scheme on <html> before React hydrates it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <AppShell>{children}</AppShell>
        <Scripts />
      </body>
    </html>
  )
}
