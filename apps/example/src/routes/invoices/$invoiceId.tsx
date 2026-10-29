import { createFileRoute } from "@tanstack/react-router"
import { useRef, useState, type ReactNode } from "react"
import { loadInvoiceComments } from "../../comments.functions"
import { BackLink, StatusLabel } from "../../components"
import { formatDate, formatMoney } from "../../format"
import { AnchorPins, InvoiceComments, type PinTarget } from "../../invoice-comments"
import { getInvoice } from "../../invoices.functions"

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
    meta: [{ title: `${loaderData ? `Invoice ${loaderData.number}` : "Invoice"} – Better Apps example` }]
  }),
  component: InvoiceDetail,
  notFoundComponent: InvoiceNotFound
})

interface Detail {
  field: string
  label: string
  value: ReactNode
}

function InvoiceDetail() {
  const invoice = Route.useLoaderData()
  const details = useRef<HTMLDListElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const [target, setTarget] = useState<PinTarget | null>(null)
  const subject = { subjectType: "invoice", subjectId: invoice.id } as const
  const fields: Detail[] = [
    { field: "customer", label: "Customer", value: invoice.customer },
    { field: "amount", label: "Amount", value: formatMoney(invoice.amount, invoice.currency) },
    { field: "status", label: "Status", value: <StatusLabel status={invoice.status} /> },
    {
      field: "issued",
      label: "Issued",
      value: <time dateTime={invoice.issuedOn}>{formatDate(invoice.issuedOn)}</time>
    },
    { field: "due", label: "Due", value: <time dateTime={invoice.dueOn}>{formatDate(invoice.dueOn)}</time> }
  ]
  const labels = Object.fromEntries(fields.map(({ field, label }) => [field, label]))

  function commentOn(detail: PinTarget) {
    setTarget(detail)
    composer.current?.focus()
  }

  return (
    <div className="invoice-page">
      <article aria-labelledby="invoice-title">
        <BackLink to="/invoices">All invoices</BackLink>
        <h1 id="invoice-title">Invoice {invoice.number}</h1>
        <div className="details-frame">
          <dl className="details" ref={details}>
            {fields.map(({ field, label, value }) => (
              <div key={field} data-field={field}>
                <dt>{label}</dt>
                <dd>
                  <span>{value}</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => commentOn({ field, label })}
                    aria-label={`Comment on ${label}`}
                  >
                    Comment
                  </button>
                </dd>
              </div>
            ))}
          </dl>
          <AnchorPins subject={subject} root={details} labels={labels} />
        </div>
      </article>
      <InvoiceComments
        subject={subject}
        root={details}
        labels={labels}
        target={target}
        onTargetChange={setTarget}
        composerRef={composer}
      />
    </div>
  )
}

function InvoiceNotFound() {
  return (
    <section aria-labelledby="invoice-missing-title">
      <BackLink to="/invoices">All invoices</BackLink>
      <h1 id="invoice-missing-title">Invoice not found</h1>
      <p>There’s no invoice at this address.</p>
    </section>
  )
}
