import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "@buildkitgg/shadcn-baseui-kit"
import { Link, type ErrorComponentProps } from "@tanstack/react-router"
import { FileQuestionIcon, TriangleAlertIcon } from "lucide-react"
import type { InvoiceStatus } from "./db/schema"

export const statusLabels: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  overdue: "Overdue",
  paid: "Paid"
}

export interface StatusLabelProps {
  status: InvoiceStatus
}

/** An invoice's status in words, with a color that only reinforces them. */
export function StatusLabel({ status }: StatusLabelProps) {
  return <span className={`status status-${status}`}>{statusLabels[status]}</span>
}

export function NotFound() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestionIcon />
        </EmptyMedia>
        <EmptyTitle>
          <h1>Page not found</h1>
        </EmptyTitle>
        <EmptyDescription>There’s nothing at this address.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/invoices" />} nativeButton={false}>
          Go to invoices
        </Button>
      </EmptyContent>
    </Empty>
  )
}

export function ErrorMessage({ error, reset }: ErrorComponentProps) {
  return (
    <Empty role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>
          <h1>Something went wrong</h1>
        </EmptyTitle>
        <EmptyDescription>{error instanceof Error ? error.message : "The page couldn’t load."}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={reset}>Try again</Button>
      </EmptyContent>
    </Empty>
  )
}
