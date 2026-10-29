import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { migrate } from "drizzle-orm/sqlite-proxy/migrator"
import * as authTables from "./auth-schema"
import * as featureTables from "./better-apps-schema"
import * as appTables from "./schema"

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

const seedInvoices: appTables.Invoice[] = [
  {
    id: "inv-1001",
    number: "INV-1001",
    customer: "Harbor Light Bakery",
    amount: 128_000,
    currency: "USD",
    status: "paid",
    issuedOn: "2026-08-04",
    dueOn: "2026-09-03"
  },
  {
    id: "inv-1002",
    number: "INV-1002",
    customer: "Juniper Design Studio",
    amount: 452_550,
    currency: "USD",
    status: "overdue",
    issuedOn: "2026-08-21",
    dueOn: "2026-09-20"
  },
  {
    id: "inv-1003",
    number: "INV-1003",
    customer: "Maple Street Clinic",
    amount: 87_425,
    currency: "USD",
    status: "sent",
    issuedOn: "2026-10-02",
    dueOn: "2026-11-01"
  },
  {
    id: "inv-1004",
    number: "INV-1004",
    customer: "Orbit Freight",
    amount: 1_210_000,
    currency: "EUR",
    status: "sent",
    issuedOn: "2026-10-15",
    dueOn: "2026-11-14"
  },
  {
    id: "inv-1005",
    number: "INV-1005",
    customer: "Tidewater Books",
    amount: 39_900,
    currency: "USD",
    status: "draft",
    issuedOn: "2026-10-27",
    dueOn: "2026-11-26"
  }
]

// Apply the migrations drizzle-kit generated, in one transaction, then add the sample invoices once.
await migrate(
  db,
  async (queries) => {
    transaction(() => queries.forEach((statement) => sqlite.exec(statement)))
  },
  { migrationsFolder: resolve("drizzle") }
)
await db.insert(appTables.invoice).values(seedInvoices).onConflictDoNothing()
