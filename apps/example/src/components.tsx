import { Link, type ErrorComponentProps } from "@tanstack/react-router"
import type { Invoice } from "./db/schema"

const statusLabels: Record<Invoice["status"], string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue"
}

export interface StatusLabelProps {
  status: Invoice["status"]
}

/** An invoice's status in words, with a color that only reinforces them. */
export function StatusLabel({ status }: StatusLabelProps) {
  return <span className={`status status-${status}`}>{statusLabels[status]}</span>
}

export function NotFound() {
  return (
    <section aria-labelledby="not-found-title">
      <h1 id="not-found-title">Page not found</h1>
      <p>There’s nothing at this address.</p>
      <BackLink to="/">Go to notes</BackLink>
    </section>
  )
}

export function ErrorMessage({ error, reset }: ErrorComponentProps) {
  return (
    <section aria-labelledby="error-title" role="alert">
      <h1 id="error-title">Something went wrong</h1>
      <p>{error instanceof Error ? error.message : "The page couldn't load."}</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </section>
  )
}

export interface BackLinkProps {
  to: "/" | "/invoices"
  children: string
}

/** A link back to a list, above a page's heading. */
export function BackLink({ to, children }: BackLinkProps) {
  return (
    <p className="back-link">
      <Link to={to} activeOptions={{ exact: true }}>
        {children}
      </Link>
    </p>
  )
}
