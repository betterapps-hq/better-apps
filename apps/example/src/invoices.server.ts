import { eq } from "drizzle-orm"
import { db } from "./db/database.server"
import { invoice } from "./db/schema"

/** Whether an invoice exists, for the comments feature's access checks. */
export async function invoiceExists(id: string): Promise<boolean> {
  const [found] = await db.select({ id: invoice.id }).from(invoice).where(eq(invoice.id, id)).limit(1)
  return found !== undefined
}
