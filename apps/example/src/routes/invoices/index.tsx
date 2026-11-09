import { useThreadCounts } from "@better-apps/comments/react"
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from "@buildkitgg/shadcn-baseui-kit"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type RowData,
  type SortingState
} from "@tanstack/react-table"
import { MessageSquareIcon, SearchIcon, SearchXIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { SignInPrompt } from "../../app-shell"
import { loadCommentCounts } from "../../comments.functions"
import { StatusLabel, statusLabels } from "../../components"
import {
  DataTable,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  DataTablePagination,
  useDataTable
} from "../../data-table"
import { invoiceStatuses, type Invoice, type InvoiceStatus } from "../../db/schema"
import { formatDate, formatMoney, plural, totalsByCurrency } from "../../format"
import { listInvoices } from "../../invoices.functions"
import { useViewer } from "../../viewer"

interface InvoiceSearch {
  q?: string | undefined
  /** The statuses to show, or every status when there are none. */
  status?: InvoiceStatus[] | undefined
}

/** Statuses from the address, which may hold one as text or several as a list. */
function statusesIn(value: unknown): InvoiceStatus[] | undefined {
  const values: unknown[] = Array.isArray(value) ? value : [value]
  const statuses = invoiceStatuses.filter((status) => values.includes(status))
  return statuses.length > 0 ? statuses : undefined
}

export const Route = createFileRoute("/invoices/")({
  validateSearch: (search: Record<string, unknown>): InvoiceSearch => ({
    q: typeof search.q === "string" && search.q !== "" ? search.q : undefined,
    status: statusesIn(search.status)
  }),
  loader: async ({ context }) => {
    const invoices = await listInvoices()
    if (!invoices) {
      return null
    }
    // Counts the open threads for the server render. If that fails, the table loads them itself.
    const counts = await loadCommentCounts({ data: { invoiceIds: invoices.map((invoice) => invoice.id) } }).catch(
      () => null
    )
    if (counts) {
      context.comments.hydrate(counts)
    }
    return invoices
  },
  head: () => ({ meta: [{ title: "Invoices – Better Invoices" }] }),
  component: Invoices
})

const statusOptions = invoiceStatuses.map((status) => ({ value: status, label: statusLabels[status] }))

/** Whether an invoice matches what someone typed: its number, its customer or the customer's email. */
function matches(invoice: Invoice, query: string) {
  const text = query.trim().toLowerCase()
  return [invoice.number, invoice.customer, invoice.customerEmail].some((value) => value.toLowerCase().includes(text))
}

declare module "@tanstack/react-table" {
  interface TableMeta<TData extends RowData> {
    /** How many open threads an invoice has, or `undefined` while the count loads. */
    openThreads(invoiceId: string): number | undefined
  }
}

/** The invoice table's columns. Search and the status filter work on these. */
const columns: ColumnDef<Invoice>[] = [
  {
    accessorKey: "number",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
    cell: ({ row }) => (
      <Link className="invoice-link" to="/invoices/$invoiceId" params={{ invoiceId: row.original.id }}>
        {row.original.number}
      </Link>
    )
  },
  {
    accessorKey: "customer",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
    cell: ({ row }) => (
      <span className="customer">
        {row.original.customer}
        <span>{row.original.customerEmail}</span>
      </span>
    )
  },
  {
    accessorKey: "issuedOn",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Issued" />,
    cell: ({ row }) => <time dateTime={row.original.issuedOn}>{formatDate(row.original.issuedOn)}</time>,
    meta: { className: "optional" }
  },
  {
    accessorKey: "dueOn",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />,
    cell: ({ row }) => <time dateTime={row.original.dueOn}>{formatDate(row.original.dueOn)}</time>,
    meta: { className: "optional" }
  },
  {
    accessorKey: "status",
    header: "Status",
    enableSorting: false,
    filterFn: (row, id, picked: InvoiceStatus[]) => picked.includes(row.getValue(id)),
    cell: ({ row }) => <StatusLabel status={row.original.status} />
  },
  {
    id: "comments",
    header: "Comments",
    enableSorting: false,
    cell: ({ row, table }) => openThreads(table.options.meta?.openThreads(row.original.id)),
    meta: { className: "optional" }
  },
  {
    accessorKey: "amount",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
    cell: ({ row }) => formatMoney(row.original.amount, row.original.currency),
    meta: { className: "numeric" }
  }
]

function Invoices() {
  const invoices = Route.useLoaderData()
  if (!invoices) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Invoices</h1>
          </div>
        </div>
        <Card>
          <CardContent>
            <SignInPrompt>to see your invoices.</SignInPrompt>
          </CardContent>
        </Card>
      </>
    )
  }
  return <InvoiceList invoices={invoices} />
}

function InvoiceList({ invoices }: { invoices: Invoice[] }) {
  // TanStack Table keeps one table object and changes it in place, which the React Compiler can't see.
  "use no memo"
  const { q = "", status } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [sorting, setSorting] = useState<SortingState>([{ id: "issuedOn", desc: true }])
  // Comments are for signed-in people, so the counts are too.
  const signedIn = useViewer() !== null
  const counts = useThreadCounts("invoice", signedIn ? invoices.map((invoice) => invoice.id) : [])
  const columnFilters = status ? [{ id: "status", value: status }] : []

  function setSearch(next: InvoiceSearch) {
    void navigate({ search: (previous) => ({ ...previous, ...next }), replace: true })
  }

  const table = useDataTable({
    data: invoices,
    columns,
    // Search and status filters live in the address, so a filtered list can be shared and survives a reload.
    state: { sorting, globalFilter: q, columnFilters, columnVisibility: { comments: signedIn } },
    meta: { openThreads: (invoiceId) => counts[invoiceId]?.open },
    onSortingChange: setSorting,
    onGlobalFilterChange: (value: string) => setSearch({ q: value || undefined }),
    onColumnFiltersChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnFilters) : updater
      setSearch({ status: statusesIn(next.find((filter) => filter.id === "status")?.value) })
    },
    globalFilterFn: (row, _columnId, query: string) => matches(row.original, query),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues()
  })

  const filtered = q !== "" || status !== undefined
  const shown = table.getFilteredRowModel().rows.length
  const reset = () => setSearch({ q: undefined, status: undefined })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Invoices</h1>
          <p>Everything you’ve billed, newest first.</p>
        </div>
      </div>
      <Summary invoices={invoices} />
      <div className="toolbar">
        <InputGroup className="search">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search invoices"
            placeholder="Search by number or customer"
            value={q}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
          />
        </InputGroup>
        <DataTableFacetedFilter column={table.getColumn("status")!} title="Status" options={statusOptions} />
        {filtered && (
          <Button variant="ghost" size="sm" onClick={reset}>
            Reset
            <XIcon />
          </Button>
        )}
      </div>
      <output className="visually-hidden">{plural(shown, "invoice shown", "invoices shown")}</output>
      <Card className="invoice-table">
        <DataTable
          table={table}
          caption="Invoices. Column headers sort the table."
          empty={
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchXIcon />
                </EmptyMedia>
                <EmptyTitle>No invoices match</EmptyTitle>
                <EmptyDescription>Try another search, or show every status.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={reset}>
                  Reset filters
                </Button>
              </EmptyContent>
            </Empty>
          }
        />
      </Card>
      <DataTablePagination table={table} noun={["invoice", "invoices"]} />
    </>
  )
}

/** Open threads as a count with an icon, "None open" for screen readers, or nothing while the count loads. */
function openThreads(open: number | undefined) {
  if (open === undefined) {
    return null
  }
  if (open === 0) {
    return <span className="visually-hidden">None open</span>
  }
  return (
    <span className="comment-count">
      <MessageSquareIcon size={14} aria-hidden="true" />
      {open} open
    </span>
  )
}

interface SummaryCard {
  label: string
  statuses: readonly InvoiceStatus[]
}

const summaryCards: SummaryCard[] = [
  { label: "Outstanding", statuses: ["sent", "overdue"] },
  { label: "Overdue", statuses: ["overdue"] },
  { label: "Paid", statuses: ["paid"] },
  { label: "Drafts", statuses: ["draft"] }
]

/** Totals across every invoice: what's owed, what's late, what's paid and what's not sent yet. */
function Summary({ invoices }: { invoices: Invoice[] }) {
  return (
    <section className="summary" aria-label="Totals">
      {summaryCards.map((card) => {
        const included = invoices.filter((invoice) => card.statuses.includes(invoice.status))
        const [main, ...others] = totalsByCurrency(included)
        return (
          <Card key={card.label} size="sm">
            <CardHeader>
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="summary-value">
                {main ? formatMoney(main.amount, main.currency) : "$0.00"}
              </CardTitle>
              <p className="summary-extra">
                {others.map((other) => (
                  <span key={other.currency}>and {formatMoney(other.amount, other.currency)} </span>
                ))}
                {others.length > 0 && <br />}
                {plural(included.length, "invoice", "invoices")}
              </p>
            </CardHeader>
          </Card>
        )
      })}
    </section>
  )
}
