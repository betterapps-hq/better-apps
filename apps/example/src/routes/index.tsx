import { createFileRoute, redirect } from "@tanstack/react-router"

/** Invoices are the app's home. */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/invoices" })
  }
})
