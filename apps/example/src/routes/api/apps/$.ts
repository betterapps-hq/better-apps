import { createFileRoute } from "@tanstack/react-router"
import { handlers } from "../../../better-apps.server"

// Better Apps answers POST /api/apps/{feature}/{action} here.
export const Route = createFileRoute("/api/apps/$")({
  server: { handlers }
})
