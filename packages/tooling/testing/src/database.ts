import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { drizzleAdapter } from "@better-apps/drizzle"
import type { DatabaseAdapterFactory, DatabaseSchema, FieldAttribute, TableSchema } from "better-apps"
import { integer, sqliteTable, text, type SQLiteColumnBuilderBase } from "drizzle-orm/sqlite-core"
import { drizzle } from "drizzle-orm/sqlite-proxy"

/** A database factory for `createBetterApps` whose SQLite database stays reachable for assertions. */
export type TestDatabase = DatabaseAdapterFactory & {
  /** The SQLite database, once `createBetterApps` has created it. */
  readonly sqlite: DatabaseSync
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
const columnName = (key: string, field: FieldAttribute) => field.fieldName ?? key

// SQLite types and Drizzle columns that match what `better-apps generate` writes for SQLite.
function sqlType(field: FieldAttribute): "TEXT" | "INTEGER" {
  return ["number", "boolean", "date"].includes(field.type as string) ? "INTEGER" : "TEXT"
}

function drizzleColumn(name: string, field: FieldAttribute): SQLiteColumnBuilderBase {
  let column: { notNull(): unknown; unique(): unknown }
  switch (field.type) {
    case "number":
      column = integer(name)
      break
    case "boolean":
      column = integer(name, { mode: "boolean" })
      break
    case "date":
      column = integer(name, { mode: "timestamp_ms" })
      break
    case "json":
    case "string[]":
    case "number[]":
      column = text(name, { mode: "json" })
      break
    default:
      column = text(name)
  }
  if (field.required !== false) {
    column = column.notNull() as typeof column
  }
  if (field.unique) {
    column = column.unique() as typeof column
  }
  return column as unknown as SQLiteColumnBuilderBase
}

function findTable(schema: DatabaseSchema, model: string): TableSchema {
  const table = schema[model] ?? Object.values(schema).find((candidate) => candidate.modelName === model)
  if (!table) {
    throw new Error(`A field references the "${model}" model, which no feature declares.`)
  }
  return table
}

/** The CREATE TABLE and CREATE INDEX statements for every table, with the same column names as the Drizzle tables. */
export function createStatements(schema: DatabaseSchema): string[] {
  const statements: string[] = []
  for (const table of Object.values(schema)) {
    const columns = [`"id" TEXT PRIMARY KEY NOT NULL`]
    const indexes: string[] = []
    for (const [key, field] of Object.entries(table.fields)) {
      const name = columnName(key, field)
      let column = `${quote(name)} ${sqlType(field)}`
      if (field.required !== false) {
        column += " NOT NULL"
      }
      if (field.unique) {
        column += " UNIQUE"
      }
      if (field.references) {
        const target = findTable(schema, field.references.model)
        const targetField = target.fields[field.references.field]
        const targetColumn = targetField ? columnName(field.references.field, targetField) : field.references.field
        const onDelete = (field.references.onDelete ?? "cascade").toUpperCase()
        column += ` REFERENCES ${quote(target.modelName)}(${quote(targetColumn)}) ON DELETE ${onDelete}`
      }
      columns.push(column)
      if (field.index) {
        indexes.push(
          `CREATE INDEX ${quote(`${table.modelName}_${name}_idx`)} ON ${quote(table.modelName)} (${quote(name)})`
        )
      }
    }
    for (const index of table.indexes ?? []) {
      const names = index.fields.map((key) => {
        const field = table.fields[key]
        return field ? columnName(key, field) : key
      })
      const indexName = index.name ?? `${table.modelName}_${names.join("_")}_idx`
      const unique = index.unique ? "UNIQUE " : ""
      indexes.push(
        `CREATE ${unique}INDEX ${quote(indexName)} ON ${quote(table.modelName)} (${names.map(quote).join(", ")})`
      )
    }
    statements.push(`CREATE TABLE ${quote(table.modelName)} (${columns.join(", ")})`, ...indexes)
  }
  return statements
}

function drizzleTables(schema: DatabaseSchema) {
  return Object.fromEntries(
    Object.values(schema).map((table) => {
      const columns: Record<string, SQLiteColumnBuilderBase> = { id: text("id").primaryKey() }
      for (const [key, field] of Object.entries(table.fields)) {
        const name = columnName(key, field)
        columns[name] = drizzleColumn(name, field)
      }
      return [table.modelName, sqliteTable(table.modelName, columns)]
    })
  )
}

type Method = "run" | "all" | "values" | "get"

/**
 * An in-memory SQLite database for the features' tables, reached through `@better-apps/drizzle`, so tests run the same
 * queries an app runs. Pass it as `database` to `createBetterApps`; each app gets a fresh database with every table and
 * index created, foreign keys enforced, and batches that commit or roll back together.
 */
export function testDatabase(): TestDatabase {
  let current: DatabaseSync | undefined
  const factory = ({ schema }: { schema: DatabaseSchema }) => {
    const sqlite = new DatabaseSync(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON")
    for (const statement of createStatements(schema)) {
      sqlite.exec(statement)
    }
    current = sqlite
    const query = (sql: string, params: unknown[], method: Method) => {
      const statement = sqlite.prepare(sql)
      const values = params as SQLInputValue[]
      if (method === "run") {
        statement.run(...values)
        return { rows: [] }
      }
      statement.setReturnArrays(true)
      // setReturnArrays makes rows arrays of values, which node:sqlite's types don't follow.
      const rows: unknown = method === "get" ? statement.get(...values) : statement.all(...values)
      return { rows: rows as unknown[] }
    }
    const batch = async (queries: { sql: string; params: unknown[]; method: Method }[]) => {
      sqlite.exec("BEGIN")
      try {
        const results = queries.map(({ sql, params, method }) => query(sql, params, method))
        sqlite.exec("COMMIT")
        return results
      } catch (error) {
        sqlite.exec("ROLLBACK")
        throw error
      }
    }
    const tables = drizzleTables(schema)
    const db = drizzle(async (sql, params, method) => query(sql, params, method), batch, { schema: tables })
    return drizzleAdapter(db, { provider: "sqlite", schema: tables })({ schema })
  }
  return Object.defineProperty(factory, "sqlite", {
    get() {
      if (!current) {
        throw new Error("The test database is created when createBetterApps runs.")
      }
      return current
    }
  }) as TestDatabase
}
