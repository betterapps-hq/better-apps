import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/** The app's own table. Comments will attach to invoices as their subject. */
export const invoice = sqliteTable("invoice", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  customer: text("customer").notNull(),
  /** The total in the currency's minor unit, such as cents. */
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  status: text("status", { enum: ["draft", "sent", "paid", "overdue"] }).notNull(),
  /** Calendar dates, as `YYYY-MM-DD`. */
  issuedOn: text("issued_on").notNull(),
  dueOn: text("due_on").notNull()
})

export type Invoice = typeof invoice.$inferSelect
