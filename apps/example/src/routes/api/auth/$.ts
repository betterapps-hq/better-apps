import { createFileRoute } from "@tanstack/react-router"
import { auth } from "../../../auth.server"

// Better Auth answers sign-in, sign-out and session requests under /api/auth.
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request)
    }
  }
})
