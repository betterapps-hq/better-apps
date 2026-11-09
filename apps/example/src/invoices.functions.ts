import { notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { asc, desc, eq } from "drizzle-orm"
import { z } from "zod"
import { identity } from "./better-apps.server"
import { db } from "./db/database.server"
import { invoice, invoiceLine, invoiceStatuses } from "./db/schema"

export const listInvoices = createServerFn({ method: "GET" }).handler(() =>
  db.select().from(invoice).orderBy(desc(invoice.issuedOn), desc(invoice.number))
)

/** An invoice with what it bills for. */
export const getInvoice = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const [found] = await db.select().from(invoice).where(eq(invoice.id, data.id))
    if (!found) {
      throw notFound()
    }
    const lines = await db
      .select()
      .from(invoiceLine)
      .where(eq(invoiceLine.invoiceId, data.id))
      .orderBy(asc(invoiceLine.position))
    return { ...found, lines }
  })

/**
 * Moves an invoice to another status for a signed-in person. Paying records today's date, and anything else clears it.
 * A real app would check who may change the invoice and keep a history.
 */
export const setInvoiceStatus = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), status: z.enum(invoiceStatuses) }))
  .handler(async ({ data }) => {
    if (!(await identity.getActor(getRequest()))) {
      throw new Error("Sign in to change invoices.")
    }
    const paidOn = data.status === "paid" ? new Date().toISOString().slice(0, 10) : null
    const [updated] = await db
      .update(invoice)
      .set({ status: data.status, paidOn })
      .where(eq(invoice.id, data.id))
      .returning({ id: invoice.id })
    if (!updated) {
      throw notFound()
    }
  })
