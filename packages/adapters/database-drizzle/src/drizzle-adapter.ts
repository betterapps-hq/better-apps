// Forked from Better Auth's drizzle-adapter/src/drizzle-adapter.ts. It builds the Drizzle queries for the factory and
// adds cursors on several columns, grouped counts, atomic batches and createMany. See docs/fork.md for what changed.
import type { DatabaseAdapterFactory, Row, WriteResult } from "better-apps"
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  is,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
  Table,
  type Column,
  type SQL
} from "drizzle-orm"
import { fromDriverDate, toDriverDate } from "./date-columns.js"
import {
  createAdapterFactory,
  type AdapterDriver,
  type ColumnSort,
  type ColumnWhere,
  type ColumnWrite
} from "./factory.js"
import { fromDriverJson, toDriverJson } from "./json-columns.js"
import {
  escapedLike,
  escapeLikePattern,
  insensitiveEq,
  insensitiveInArray,
  insensitiveNe,
  insensitiveNotInArray
} from "./query-builders.js"

/** A Drizzle database for PostgreSQL, MySQL or SQLite, including Cloudflare D1. */
export interface DrizzleDatabase {
  select: unknown
  insert: unknown
  update: unknown
  delete: unknown
}

/** Configures `drizzleAdapter`. */
export interface DrizzleAdapterConfig {
  /** The kind of database the Drizzle schema is for. */
  provider: "pg" | "mysql" | "sqlite"
  /** The Drizzle schema that holds the feature tables. The default is the schema passed to `drizzle()`. */
  schema?: Record<string, unknown> | undefined
  /** Whether the schema's table exports are plural, such as `comments` for the `comment` model. */
  usePlural?: boolean | undefined
  /** Keeps camelCase column names in generated schemas instead of snake_case. Only the CLI reads it. */
  camelCase?: boolean | undefined
  /** The PostgreSQL schema generated tables go in. Only the CLI reads it. */
  schemaName?: string | undefined
  /**
   * Generates the id of a created row that has none. The default is `crypto.randomUUID()`. `false` leaves ids to the
   * database or the Drizzle schema, which MySQL doesn't support because it can't return the created row.
   */
  generateId?: (() => string) | false | undefined
  /**
   * Whether atomic writes go through the database's `batch()`. The default uses it whenever the database has one.
   * Drizzle's sqlite-proxy driver has `batch()` even without a batch callback, and then fails, so pass `false` there to
   * use a transaction instead.
   */
  batch?: boolean | undefined
}

// Drizzle's builders differ by dialect, so queries go through this loose shape. Each method returns the next step, and
// awaiting the last one runs the query.
interface Query extends PromiseLike<unknown> {
  values(values: Row | Row[]): Query
  returning(fields?: Record<string, Column>): Query
  from(table: Table): Query
  where(condition: SQL | undefined): Query
  orderBy(...order: SQL[]): Query
  groupBy(...columns: Column[]): Query
  limit(limit: number): Query
  offset(offset: number): Query
  set(values: Row): Query
  for(strength: "update"): Query
}

interface Database {
  select(fields?: Record<string, unknown>): Query
  insert(table: Table): Query
  update(table: Table): Query
  delete(table: Table): Query
  transaction?<T>(run: (tx: Database) => Promise<T>): Promise<T>
  batch?(queries: Query[]): Promise<unknown[]>
  _?: { fullSchema?: Record<string, unknown> | undefined } | undefined
}

// Cloudflare D1 binds at most 100 parameters per statement, so multi-row SQLite inserts stay under it.
const maxSqliteParameters = 100
const maxRowsPerInsert = 1000

const isJsonField = (type: unknown) => type === "json" || type === "string[]" || type === "number[]"

/**
 * Reads the number of affected rows from a MySQL write result: mysql2 returns a `[ResultSetHeader]` tuple with
 * `affectedRows`, and PlanetScale and other serverless drivers report `rowsAffected`.
 */
function getAffectedRowCount(result: unknown): number {
  const header: unknown = Array.isArray(result) ? result[0] : result
  const record = (header && typeof header === "object" ? header : {}) as Record<string, unknown>
  const affected = record.affectedRows ?? record.rowsAffected
  if (typeof affected !== "number" || !Number.isFinite(affected)) {
    throw new Error("The MySQL driver didn't report how many rows the write changed.")
  }
  return affected
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function readOne(query: PromiseLike<unknown>): Promise<Row | null> {
  const rows = (await query) as Row[]
  return rows[0] ?? null
}

async function sequence(queries: readonly PromiseLike<unknown>[]): Promise<unknown[]> {
  const results: unknown[] = []
  for (const query of queries) {
    results.push(await query)
  }
  return results
}

function runWrite(driver: AdapterDriver, write: ColumnWrite): Promise<WriteResult> {
  switch (write.type) {
    case "create":
      return driver.create(write)
    case "update":
      return driver.update(write)
    case "updateMany":
      return driver.updateMany(write)
    case "incrementOne":
      return driver.incrementOne(write)
    case "deleteMany":
      return driver.deleteMany(write)
  }
}

/** Creates a database adapter for a Drizzle database. */
export function drizzleAdapter(db: DrizzleDatabase, config: DrizzleAdapterConfig): DatabaseAdapterFactory {
  const root = db as unknown as Database
  const { provider } = config
  if (provider === "mysql" && config.generateId === false) {
    throw new Error("MySQL can't return a created row without its id, so drizzleAdapter can't use generateId: false.")
  }

  function getTable(name: string): Table {
    const table = (config.schema ?? root._?.fullSchema)?.[name]
    if (!is(table, Table)) {
      throw new Error(
        `The Drizzle schema has no "${name}" table. Generate it with better-apps generate and pass the schema to drizzleAdapter.`
      )
    }
    return table
  }

  function getColumn(table: Table, name: string, key: string): Column {
    const column = getTableColumns(table)[key]
    if (!column) {
      throw new Error(`The "${name}" table has no "${key}" column. Regenerate the schema with better-apps generate.`)
    }
    return column
  }

  function condition(table: Table, name: string, { column: key, value, operator, mode }: ColumnWhere): SQL {
    const column = getColumn(table, name, key)
    const insensitive =
      mode === "insensitive" &&
      (typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string")))
    const likeMode = insensitive ? "insensitive" : "sensitive"
    switch (operator) {
      case "in":
        return insensitive ? insensitiveInArray(column, value as string[]) : inArray(column, value as unknown[])
      case "not_in":
        return insensitive ? insensitiveNotInArray(column, value as string[]) : notInArray(column, value as unknown[])
      case "contains":
        return escapedLike(column, `%${escapeLikePattern(String(value))}%`, provider, likeMode)
      case "starts_with":
        return escapedLike(column, `${escapeLikePattern(String(value))}%`, provider, likeMode)
      case "ends_with":
        return escapedLike(column, `%${escapeLikePattern(String(value))}`, provider, likeMode)
      case "lt":
        return lt(column, value)
      case "lte":
        return lte(column, value)
      case "gt":
        return gt(column, value)
      case "gte":
        return gte(column, value)
      case "ne":
        if (value === null) {
          return isNotNull(column)
        }
        return insensitive && typeof value === "string" ? insensitiveNe(column, value) : ne(column, value)
      case "eq":
        if (value === null) {
          return isNull(column)
        }
        return insensitive && typeof value === "string" ? insensitiveEq(column, value) : eq(column, value)
    }
  }

  // Conditions joined with AND must all match, and when there are OR conditions, at least one of them must too.
  function whereClause(table: Table, name: string, where: readonly ColumnWhere[]): SQL | undefined {
    const all = where.filter((item) => item.connector === "AND").map((item) => condition(table, name, item))
    const any = where.filter((item) => item.connector === "OR").map((item) => condition(table, name, item))
    return and(...all, any.length ? or(...any) : undefined)
  }

  // Rows after a cursor: for some sort key, every earlier key equals the cursor's value and this key passes it.
  function afterClause(table: Table, name: string, sortBy: readonly ColumnSort[], after: readonly unknown[]) {
    return or(
      ...sortBy.map((key, index) =>
        and(
          ...sortBy.slice(0, index).map((previous, j) => eq(getColumn(table, name, previous.column), after[j])),
          (key.direction === "asc" ? gt : lt)(getColumn(table, name, key.column), after[index])
        )
      )
    )
  }

  function selection(table: Table, name: string, select: readonly string[] | undefined) {
    return select?.length ? Object.fromEntries(select.map((key) => [key, getColumn(table, name, key)])) : undefined
  }

  // Pins a write to the first matching row. The guard is repeated on the write itself: under READ COMMITTED,
  // PostgreSQL re-checks an UPDATE's own WHERE after waiting on a concurrent writer, but not an uncorrelated
  // subquery's, so without it every waiting compare-and-swap would succeed once the first committed.
  function firstRow(database: Database, table: Table, name: string, clause: SQL | undefined): SQL | undefined {
    const id = getColumn(table, name, "id")
    const first = database.select({ id }).from(table).where(clause).limit(1)
    return and(clause, inArray(id, first as unknown as SQL))
  }

  function assignments(table: Table, name: string, increment: Record<string, number>, set: Row): Row {
    const values: Row = { ...set }
    for (const [key, delta] of Object.entries(increment)) {
      values[key] = sql`${getColumn(table, name, key)} + ${delta}`
    }
    return values
  }

  // The query a write runs on PostgreSQL and SQLite. Counts come from returned ids, so they don't depend on how each
  // driver reports affected rows.
  function writeQuery(database: Database, write: ColumnWrite): Query {
    const table = getTable(write.table)
    if (write.type === "create") {
      return database.insert(table).values(write.data).returning()
    }
    const clause = whereClause(table, write.table, write.where)
    const id = getColumn(table, write.table, "id")
    switch (write.type) {
      case "update":
        return database
          .update(table)
          .set(write.update)
          .where(firstRow(database, table, write.table, clause))
          .returning()
      case "incrementOne":
        return database
          .update(table)
          .set(assignments(table, write.table, write.increment, write.set))
          .where(firstRow(database, table, write.table, clause))
          .returning()
      case "updateMany":
        return database.update(table).set(write.update).where(clause).returning({ id })
      case "deleteMany":
        return database.delete(table).where(clause).returning({ id })
    }
  }

  function readWrite(write: ColumnWrite, result: unknown): WriteResult {
    const rows = result as Row[]
    return write.type === "updateMany" || write.type === "deleteMany" ? rows.length : (rows[0] ?? null)
  }

  function createDriver(database: Database, inTransaction: boolean): AdapterDriver {
    function transaction<T>(run: (tx: Database) => Promise<T>): Promise<T> {
      if (!database.transaction) {
        throw new Error("This Drizzle driver has neither transactions nor batch(), so writes can't be made atomic.")
      }
      return database.transaction(run)
    }

    // Runs queries as one atomic unit: D1, libSQL and other drivers with batch() send them together, and the rest run
    // them in a transaction. A single statement is atomic on its own.
    async function runAtomic(build: (database: Database) => Query[]): Promise<unknown[]> {
      const queries = build(database)
      if (inTransaction || queries.length === 1) {
        return sequence(queries)
      }
      if (typeof database.batch === "function" && config.batch !== false) {
        return database.batch(queries)
      }
      return transaction((tx) => sequence(build(tx)))
    }

    // MySQL has no UPDATE ... RETURNING. The row is held under SELECT ... FOR UPDATE inside a transaction, so
    // concurrent writers wait, then it's read back by id.
    async function updateLocked(name: string, where: readonly ColumnWhere[], values: (table: Table) => Row) {
      const table = getTable(name)
      const clause = whereClause(table, name, where)
      const id = getColumn(table, name, "id")
      const run = async (tx: Database) => {
        const target = await readOne(tx.select().from(table).where(clause).for("update").limit(1))
        if (!target) {
          return null
        }
        await tx.update(table).set(values(table)).where(eq(id, target.id))
        return readOne(tx.select().from(table).where(eq(id, target.id)).limit(1))
      }
      return inTransaction ? run(database) : transaction(run)
    }

    const driver: AdapterDriver = {
      async create(write) {
        if (provider !== "mysql") {
          const row = await readOne(writeQuery(database, { type: "create", ...write }))
          if (!row) {
            throw new Error(`The database didn't return the created "${write.table}" row.`)
          }
          return row
        }
        const table = getTable(write.table)
        await database.insert(table).values(write.data)
        const row = await readOne(
          database
            .select()
            .from(table)
            .where(eq(getColumn(table, write.table, "id"), write.data.id))
            .limit(1)
        )
        if (!row) {
          throw new Error(`The created "${write.table}" row couldn't be read back.`)
        }
        return row
      },
      async createMany({ table: name, data }) {
        const table = getTable(name)
        const size =
          provider === "sqlite"
            ? Math.max(1, Math.floor(maxSqliteParameters / Object.keys(getTableColumns(table)).length))
            : maxRowsPerInsert
        const chunks = chunk(data, size)
        if (provider !== "mysql") {
          const results = await runAtomic((database) =>
            chunks.map((rows) => database.insert(table).values(rows).returning())
          )
          return (results as Row[][]).flat()
        }
        await runAtomic((database) => chunks.map((rows) => database.insert(table).values(rows)))
        const id = getColumn(table, name, "id")
        const found = new Map<unknown, Row>()
        for (const ids of chunk(
          data.map((row) => row.id),
          maxRowsPerInsert
        )) {
          for (const row of (await database.select().from(table).where(inArray(id, ids))) as Row[]) {
            found.set(row.id, row)
          }
        }
        return data.map((row) => found.get(row.id)).filter((row): row is Row => row !== undefined)
      },
      async findOne({ table: name, where, select }) {
        const table = getTable(name)
        return readOne(
          database
            .select(selection(table, name, select))
            .from(table)
            .where(whereClause(table, name, where))
            .limit(1)
        )
      },
      async findMany({ table: name, where, sortBy, after, limit, offset, select }) {
        const table = getTable(name)
        const clause = and(whereClause(table, name, where), after ? afterClause(table, name, sortBy, after) : undefined)
        let query = database
          .select(selection(table, name, select))
          .from(table)
          .where(clause)
        if (sortBy.length) {
          query = query.orderBy(
            ...sortBy.map((key) => (key.direction === "desc" ? desc : asc)(getColumn(table, name, key.column)))
          )
        }
        if (limit !== undefined) {
          query = query.limit(limit)
        } else if (offset !== undefined && provider !== "pg") {
          // SQLite and MySQL accept OFFSET only after LIMIT.
          query = query.limit(Number.MAX_SAFE_INTEGER)
        }
        if (offset !== undefined) {
          query = query.offset(offset)
        }
        return (await query) as Row[]
      },
      async count({ table: name, where }) {
        const table = getTable(name)
        const row = await readOne(
          database
            .select({ count: count() })
            .from(table)
            .where(whereClause(table, name, where))
        )
        return Number(row?.count ?? 0)
      },
      async countGroups({ table: name, where, groupBy }) {
        const table = getTable(name)
        const columns = groupBy.map((key) => getColumn(table, name, key))
        // Grouped columns are selected under positional keys, so a column named "count" can't collide.
        const fields = Object.fromEntries(columns.map((column, index) => [`group${index}`, column]))
        const rows = (await database
          .select({ ...fields, count: count() })
          .from(table)
          .where(whereClause(table, name, where))
          .groupBy(...columns)) as Row[]
        return rows.map((row) => ({
          group: Object.fromEntries(groupBy.map((key, index) => [key, row[`group${index}`]])),
          count: Number(row.count)
        }))
      },
      async update(write) {
        if (provider === "mysql") {
          return updateLocked(write.table, write.where, () => write.update)
        }
        return readOne(writeQuery(database, { type: "update", ...write }))
      },
      async updateMany(write) {
        if (provider === "mysql") {
          const table = getTable(write.table)
          return getAffectedRowCount(
            await database
              .update(table)
              .set(write.update)
              .where(whereClause(table, write.table, write.where))
          )
        }
        return ((await writeQuery(database, { type: "updateMany", ...write })) as Row[]).length
      },
      async incrementOne(write) {
        if (provider === "mysql") {
          return updateLocked(write.table, write.where, (table) =>
            assignments(table, write.table, write.increment, write.set)
          )
        }
        return readOne(writeQuery(database, { type: "incrementOne", ...write }))
      },
      async deleteMany(write) {
        if (provider === "mysql") {
          const table = getTable(write.table)
          return getAffectedRowCount(await database.delete(table).where(whereClause(table, write.table, write.where)))
        }
        return ((await writeQuery(database, { type: "deleteMany", ...write })) as Row[]).length
      },
      async batch(writes) {
        // MySQL has no RETURNING, so its writes run one by one in a transaction, each locking its row.
        if (provider === "mysql") {
          const run = async (tx: AdapterDriver) => {
            const results: WriteResult[] = []
            for (const write of writes) {
              results.push(await runWrite(tx, write))
            }
            return results
          }
          return inTransaction ? run(driver) : transaction((tx) => run(createDriver(tx, true)))
        }
        const results = await runAtomic((database) => writes.map((write) => writeQuery(database, write)))
        return results.map((result, index) => readWrite(writes[index]!, result))
      }
    }
    return driver
  }

  return createAdapterFactory(
    {
      id: "drizzle",
      options: { ...config, adapterConfig: { usePlural: config.usePlural ?? false } },
      usePlural: config.usePlural,
      // Each Drizzle column decides how JSON and lists are stored, in toDriver and fromDriver below.
      supportsJSON: true,
      supportsArrays: true,
      generateId: config.generateId ?? (() => crypto.randomUUID()),
      toDriver: (value, { table, column, field }) => {
        const drizzleColumn = getTableColumns(getTable(table))[column]
        if (field.type === "date") {
          return toDriverDate(value, drizzleColumn, provider)
        }
        return isJsonField(field.type) ? toDriverJson(value, drizzleColumn) : value
      },
      fromDriver: (value, { table, column, field }) => {
        if (
          field.type === "date" &&
          (typeof value === "string" || typeof value === "number" || value instanceof Date)
        ) {
          return fromDriverDate(value)
        }
        return isJsonField(field.type) ? fromDriverJson(value, getTableColumns(getTable(table))[column]) : value
      }
    },
    createDriver(root, false)
  )
}
