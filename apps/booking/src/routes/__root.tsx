import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import styles from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Better Booking" }
    ],
    links: [{ rel: "stylesheet", href: styles }]
  }),
  component: () => <Outlet />,
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
})
