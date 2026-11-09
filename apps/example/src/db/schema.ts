import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/** The statuses an invoice moves through, in order. */
export const invoiceStatuses = ["draft", "sent", "overdue", "paid"] as const

export type InvoiceStatus = (typeof invoiceStatuses)[number]

/** The app's own table. Comments attach to invoices as their subject. */
export const invoice = sqliteTable("invoice", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  customer: text("customer").notNull(),
  customerEmail: text("customer_email").notNull().default(""),
  /** The billing address, one line per line. */
  customerAddress: text("customer_address").notNull().default(""),
  /** The total with tax, in the currency's minor unit, such as cents. */
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  /** Tax on the line items, in basis points: 825 is 8.25%. */
  taxRate: integer("tax_rate").notNull().default(0),
  status: text("status", { enum: invoiceStatuses }).notNull(),
  /** Calendar dates, as `YYYY-MM-DD`. */
  issuedOn: text("issued_on").notNull(),
  dueOn: text("due_on").notNull(),
  paidOn: text("paid_on"),
  /** A note to the customer, printed under the totals. */
  notes: text("notes").notNull().default("")
})

/** What an invoice bills for, in the order it lists them. */
export const invoiceLine = sqliteTable(
  "invoice_line",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    /** The price of one, in the currency's minor unit. */
    unitAmount: integer("unit_amount").notNull()
  },
  (table) => [index("invoice_line_invoice_idx").on(table.invoiceId, table.position)]
)

export type Invoice = typeof invoice.$inferSelect

export type InvoiceLine = typeof invoiceLine.$inferSelect
