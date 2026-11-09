import { createFileRoute } from "@tanstack/react-router"
import { handlers } from "../../better-apps.server"

// Short links open here, at /s/{code}, and redirect to what they point to.
export const Route = createFileRoute("/s/$")({
  server: { handlers }
})
