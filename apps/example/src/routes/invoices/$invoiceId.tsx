import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast
} from "@buildkitgg/shadcn-baseui-kit"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import {
  BanknoteIcon,
  ChevronDownIcon,
  FileQuestionIcon,
  LinkIcon,
  PrinterIcon,
  ReceiptTextIcon,
  SendIcon,
  Undo2Icon
} from "lucide-react"
import { useRef, useState, type RefObject } from "react"
import { SignInPrompt } from "../../app-shell"
import { loadInvoiceComments } from "../../comments.functions"
import { StatusLabel } from "../../components"
import type { Invoice, InvoiceLine, InvoiceStatus } from "../../db/schema"
import { formatDate, formatMoney } from "../../format"
import { AnchorPins, CommentHere, CommentsPanel, InvoiceCommentsProvider, type Detail } from "../../invoice-comments"
import { FilesPanel } from "../../invoice-files"
import { getInvoice, setInvoiceStatus } from "../../invoices.functions"
import { alerts, modals } from "../../ui"
import { useViewer } from "../../viewer"

export const Route = createFileRoute("/invoices/$invoiceId")({
  loader: async ({ params, context }) => {
    const [invoice, comments] = await Promise.all([
      getInvoice({ data: { id: params.invoiceId } }),
      // If comments fail to load here, the panel loads them again and reports what went wrong.
      loadInvoiceComments({ data: { invoiceId: params.invoiceId } }).catch(() => null)
    ])
    if (comments) {
      context.comments.hydrate(comments)
    }
    return invoice
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData ? loaderData.number : "Invoice"} – Better Invoices` }]
  }),
  component: InvoiceDetail,
  notFoundComponent: InvoiceNotFound
})

/** An invoice with what it bills for, as the loader returns it. */
type LoadedInvoice = Invoice & { lines: InvoiceLine[] }

const percent = (basisPoints: number) =>
  new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(basisPoints / 10_000)

function InvoiceDetail() {
  const invoice = Route.useLoaderData()
  const viewer = useViewer()
  const sheet = useRef<HTMLElement>(null)
  const subject = { subjectType: "invoice", subjectId: invoice.id } as const
  const details: Detail[] = [
    { field: "customer", label: "Bill to" },
    { field: "issued", label: "Issue date" },
    { field: "due", label: "Due date" },
    { field: "status", label: "Status" },
    ...invoice.lines.map((line) => ({ field: `line-${line.id}`, label: line.description })),
    { field: "totals", label: "Totals" },
    { field: "notes", label: "Notes" }
  ]

  const page = (
    <>
      <InvoiceHeader invoice={invoice} />
      <div className="invoice-layout">
        <InvoiceSheet invoice={invoice} sheetRef={sheet} commenting={viewer !== null} />
        <aside aria-label="Collaboration" className="collaboration">
          {viewer ? (
            <>
              <FilesPanel invoiceId={invoice.id} />
              <CommentsPanel />
            </>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Comments</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SignInPrompt>to discuss this invoice with your team.</SignInPrompt>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </>
  )

  return viewer ? (
    <InvoiceCommentsProvider subject={subject} root={sheet} details={details}>
      {page}
    </InvoiceCommentsProvider>
  ) : (
    page
  )
}

/** The invoice's number, status and customer, with what can be done to it next. */
function InvoiceHeader({ invoice }: { invoice: LoadedInvoice }) {
  const viewer = useViewer()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const total = formatMoney(invoice.amount, invoice.currency)

  async function moveTo(status: InvoiceStatus, message: string) {
    setBusy(true)
    try {
      await setInvoiceStatus({ data: { id: invoice.id, status } })
      await router.invalidate()
      alerts.dismiss("invoice-status")
      toast.add({ title: message, timeout: 4000 })
    } catch (error) {
      alerts.error({
        id: "invoice-status",
        title: "The invoice couldn’t be changed",
        body: error instanceof Error ? error.message : "Try again in a moment."
      })
    } finally {
      setBusy(false)
    }
  }

  async function recordPayment() {
    const confirmed = await modals.confirm({
      title: `Record payment for ${invoice.number}?`,
      description: `${invoice.customer} paid ${total} in full today.`,
      confirmLabel: "Record payment"
    })
    if (confirmed) {
      await moveTo("paid", `${invoice.number} marked as paid`)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.add({ title: "Link copied", description: "Anyone signed in can open it.", timeout: 3000 })
    } catch {
      toast.add({ title: "The link couldn’t be copied", description: window.location.href })
    }
  }

  return (
    <div className="page-head">
      <div>
        <h1 style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {invoice.number} <StatusLabel status={invoice.status} />
        </h1>
        <p>
          {total} for {invoice.customer}, due <time dateTime={invoice.dueOn}>{formatDate(invoice.dueOn)}</time>
        </p>
      </div>
      <div className="page-actions">
        <Button variant="outline" onClick={() => void copyLink()}>
          <LinkIcon />
          Copy link
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <PrinterIcon />
          Print
        </Button>
        {viewer && invoice.status === "draft" && (
          <Button aria-disabled={busy} onClick={() => !busy && void moveTo("sent", `${invoice.number} sent`)}>
            <SendIcon />
            Mark as sent
          </Button>
        )}
        {viewer && (invoice.status === "sent" || invoice.status === "overdue") && (
          <Button aria-disabled={busy} onClick={() => !busy && void recordPayment()}>
            <BanknoteIcon />
            Record payment
          </Button>
        )}
        {viewer && invoice.status !== "draft" && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}>
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {invoice.status === "sent" && (
                <DropdownMenuItem onClick={() => void moveTo("overdue", `${invoice.number} marked as overdue`)}>
                  Mark as overdue
                </DropdownMenuItem>
              )}
              {invoice.status === "paid" && (
                <DropdownMenuItem onClick={() => void moveTo("sent", `Payment for ${invoice.number} removed`)}>
                  <Undo2Icon />
                  Undo payment
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => void moveTo("draft", `${invoice.number} moved back to drafts`)}>
                Move back to drafts
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

interface InvoiceSheetProps {
  invoice: LoadedInvoice
  sheetRef: RefObject<HTMLElement | null>
  /** Whether the viewer can comment, which adds a comment button and pins to each detail. */
  commenting: boolean
}

/** The invoice as the customer gets it. Each part someone can comment on has a `data-field`. */
function InvoiceSheet({ invoice, sheetRef, commenting }: InvoiceSheetProps) {
  const subtotal = invoice.lines.reduce((sum, line) => sum + line.quantity * line.unitAmount, 0)
  const tax = invoice.amount - subtotal
  const money = (amount: number) => formatMoney(amount, invoice.currency)
  const here = (field: string, label: string) => (commenting ? <CommentHere field={field} label={label} /> : null)

  return (
    <article className="invoice-sheet" ref={sheetRef} aria-labelledby="sheet-title">
      <div className="sheet-top">
        <div className="sheet-from">
          <span className="brand-mark" aria-hidden="true">
            <ReceiptTextIcon size={16} />
          </span>
          <div>
            <p style={{ fontWeight: 600 }}>Better Apps Studio</p>
            <p className="address">410 Market Street, San Francisco, CA 94105</p>
          </div>
        </div>
        <div className="sheet-title">
          <p>Invoice</p>
          <p id="sheet-title">{invoice.number}</p>
        </div>
      </div>
      <div className="sheet-parties">
        <div data-field="customer">
          <p className="label">Bill to</p>
          <p style={{ fontWeight: 500, marginTop: "0.25rem" }}>{invoice.customer}</p>
          <p className="address">{invoice.customerEmail}</p>
          <p className="address">{invoice.customerAddress}</p>
          {here("customer", "Bill to")}
        </div>
        <dl className="sheet-dates">
          <div data-field="issued">
            <dt className="label">Issued</dt>
            <dd>
              <time dateTime={invoice.issuedOn}>{formatDate(invoice.issuedOn)}</time>
              {here("issued", "Issue date")}
            </dd>
          </div>
          <div data-field="due">
            <dt className="label">Due</dt>
            <dd>
              <time dateTime={invoice.dueOn}>{formatDate(invoice.dueOn)}</time>
              {here("due", "Due date")}
            </dd>
          </div>
          <div data-field="status">
            <dt className="label">Status</dt>
            <dd>
              <StatusLabel status={invoice.status} />
              {here("status", "Status")}
            </dd>
          </div>
          {invoice.paidOn && (
            <div>
              <dt className="label">Paid</dt>
              <dd>
                <time dateTime={invoice.paidOn}>{formatDate(invoice.paidOn)}</time>
              </dd>
            </div>
          )}
        </dl>
      </div>
      <Table className="sheet-lines">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Description</TableHead>
            <TableHead scope="col" className="numeric">
              Qty
            </TableHead>
            <TableHead scope="col" className="numeric optional">
              Unit price
            </TableHead>
            <TableHead scope="col" className="numeric">
              Amount
            </TableHead>
            {commenting && (
              <TableHead scope="col" className="line-actions">
                <span className="visually-hidden">Comment</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoice.lines.map((line) => (
            <TableRow key={line.id} data-field={`line-${line.id}`}>
              <TableCell style={{ whiteSpace: "normal" }}>{line.description}</TableCell>
              <TableCell className="numeric">{line.quantity}</TableCell>
              <TableCell className="numeric optional">{money(line.unitAmount)}</TableCell>
              <TableCell className="numeric">{money(line.quantity * line.unitAmount)}</TableCell>
              {commenting && (
                <TableCell className="line-actions">{here(`line-${line.id}`, line.description)}</TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="sheet-totals" data-field="totals">
        <dl className="stack" style={{ gap: "0.5rem" }}>
          <div>
            <dt>Subtotal</dt>
            <dd>{money(subtotal)}</dd>
          </div>
          <div>
            <dt>Tax {invoice.taxRate > 0 ? `(${percent(invoice.taxRate)})` : ""}</dt>
            <dd>{money(tax)}</dd>
          </div>
          <div className="grand">
            <dt>Total</dt>
            <dd>{money(invoice.amount)}</dd>
          </div>
          <div>
            <dt>Amount due</dt>
            <dd>{money(invoice.status === "paid" ? 0 : invoice.amount)}</dd>
          </div>
        </dl>
        {here("totals", "Totals")}
      </div>
      {invoice.notes && (
        <div className="sheet-notes" data-field="notes">
          <p className="label">Notes</p>
          <p style={{ marginTop: "0.25rem" }}>{invoice.notes}</p>
          {here("notes", "Notes")}
        </div>
      )}
      {commenting && <AnchorPins />}
    </article>
  )
}

function InvoiceNotFound() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestionIcon />
        </EmptyMedia>
        <EmptyTitle>
          <h1>Invoice not found</h1>
        </EmptyTitle>
        <EmptyDescription>There’s no invoice at this address. It may have been deleted.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/invoices" />} nativeButton={false}>
          All invoices
        </Button>
      </EmptyContent>
    </Empty>
  )
}
