import { notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { desc, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "./db/database.server"
import { invoice } from "./db/schema"

export const listInvoices = createServerFn({ method: "GET" }).handler(() =>
  db.select().from(invoice).orderBy(desc(invoice.issuedOn), desc(invoice.number))
)

export const getInvoice = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const [found] = await db.select().from(invoice).where(eq(invoice.id, data.id))
    if (!found) {
      throw notFound()
    }
    return found
  })
