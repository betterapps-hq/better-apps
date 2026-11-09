import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { migrate } from "drizzle-orm/sqlite-proxy/migrator"
import * as authTables from "./auth-schema"
import * as featureTables from "./better-apps-schema"
import * as appTables from "./schema"
import { seedInvoiceLines, seedInvoices } from "./seed"

type Method = "run" | "all" | "values" | "get"

// Paths are relative to the app folder, where the package scripts run.
const file = process.env.DATABASE_FILE ?? ".data/example.db"
if (file !== ":memory:") {
  mkdirSync(dirname(resolve(file)), { recursive: true })
}
const sqlite = new DatabaseSync(file)
sqlite.exec("PRAGMA journal_mode = WAL")
sqlite.exec("PRAGMA foreign_keys = ON")

function query(sql: string, params: unknown[], method: Method) {
  const statement = sqlite.prepare(sql)
  const values = params as SQLInputValue[]
  if (method === "run") {
    statement.run(...values)
    return { rows: [] }
  }
  // Drizzle's sqlite-proxy driver reads rows as arrays of values, which node:sqlite's types don't follow.
  statement.setReturnArrays(true)
  const rows: unknown = method === "get" ? statement.get(...values) : statement.all(...values)
  return { rows: rows as unknown[] }
}

function transaction<T>(run: () => T): T {
  sqlite.exec("BEGIN")
  try {
    const result = run()
    sqlite.exec("COMMIT")
    return result
  } catch (error) {
    sqlite.exec("ROLLBACK")
    throw error
  }
}

/** The app's database, with its own tables and its features' tables. Better Apps batches commit or roll back together. */
export const db = drizzle(
  async (sql, params, method) => query(sql, params, method),
  async (queries) => transaction(() => queries.map(({ sql, params, method }) => query(sql, params, method))),
  { schema: { ...appTables, ...authTables, ...featureTables } }
)

// Apply the migrations drizzle-kit generated, in one transaction, then add the sample invoices and their lines once.
await migrate(
  db,
  async (queries) => {
    transaction(() => queries.forEach((statement) => sqlite.exec(statement)))
  },
  { migrationsFolder: resolve("drizzle") }
)
await db.insert(appTables.invoice).values(seedInvoices).onConflictDoNothing()
await db.insert(appTables.invoiceLine).values(seedInvoiceLines).onConflictDoNothing()
// Invoices added before invoices had customer details get the seed's details once.
for (const seeded of seedInvoices) {
  await db
    .update(appTables.invoice)
    .set(seeded)
    .where(and(eq(appTables.invoice.id, seeded.id), eq(appTables.invoice.customerEmail, "")))
}
