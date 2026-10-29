// A small in-memory database adapter for the core's own tests, which can't depend on @better-apps/drizzle because it
// depends on the core. Features and apps test against SQLite through @better-apps/testing instead.
import type { DatabaseAdapter, DatabaseAdapterFactory, Row, SortBy, Where, WriteOperation } from "../src/index.js"

function compare(left: unknown, right: unknown): number {
  const a = left instanceof Date ? left.getTime() : left
  const b = right instanceof Date ? right.getTime() : right
  if (a === b) {
    return 0
  }
  return (a as number) < (b as number) ? -1 : 1
}

function matches(row: Row, where: readonly Where[] = []): boolean {
  return where.every(({ field, value, operator = "eq" }) => {
    const actual = row[field] ?? null
    switch (operator) {
      case "eq":
        return compare(actual, value) === 0
      case "ne":
        return compare(actual, value) !== 0
      case "lt":
        return compare(actual, value) < 0
      case "lte":
        return compare(actual, value) <= 0
      case "gt":
        return compare(actual, value) > 0
      case "gte":
        return compare(actual, value) >= 0
      case "in":
        return (value as unknown[]).some((item) => compare(actual, item) === 0)
      default:
        throw new Error(`The memory database doesn't support "${operator}".`)
    }
  })
}

/** The memory database, with its tables and every batch it ran, for assertions. */
export interface MemoryDatabase {
  database: DatabaseAdapterFactory
  tables: Map<string, Row[]>
  batches: WriteOperation[][]
  /** Makes the next write fail, to test what a failure leaves behind. */
  failNextWrite(error?: Error): void
}

export function memoryDatabase(): MemoryDatabase {
  const tables = new Map<string, Row[]>()
  const batches: WriteOperation[][] = []
  let nextFailure: Error | undefined
  const rows = (model: string) => {
    const table = tables.get(model) ?? []
    tables.set(model, table)
    return table
  }
  const checkFailure = () => {
    const error = nextFailure
    nextFailure = undefined
    if (error) {
      throw error
    }
  }

  const adapter: DatabaseAdapter = {
    id: "memory",
    options: {},
    async create({ model, data }) {
      checkFailure()
      const row = { ...data, id: data.id ?? crypto.randomUUID() }
      if (rows(model).some((existing) => existing.id === row.id)) {
        throw new Error(`Duplicate id ${String(row.id)}`)
      }
      rows(model).push(row)
      return { ...row } as never
    },
    async createMany({ model, data }) {
      return Promise.all(data.map((item) => adapter.create({ model, data: item }))) as never
    },
    async findOne({ model, where }) {
      const row = rows(model).find((candidate) => matches(candidate, where))
      return (row ? { ...row } : null) as never
    },
    async findMany({ model, where, sortBy, limit, select }) {
      let keys: readonly SortBy[] = []
      if (sortBy) {
        keys = "field" in sortBy ? [sortBy] : sortBy
      }
      const sorted = rows(model)
        .filter((row) => matches(row, where))
        .sort((a, b) => {
          for (const { field, direction } of keys) {
            const order = compare(a[field], b[field])
            if (order !== 0) {
              return direction === "asc" ? order : -order
            }
          }
          return 0
        })
        .slice(0, limit)
      return sorted.map((row) =>
        select ? Object.fromEntries(select.map((field) => [field, row[field]])) : { ...row }
      ) as never
    },
    async count({ model, where }) {
      return rows(model).filter((row) => matches(row, where)).length
    },
    async countGroups() {
      throw new Error("The memory database doesn't count groups.")
    },
    async update({ model, where, update }) {
      checkFailure()
      const row = rows(model).find((candidate) => matches(candidate, where))
      if (!row) {
        return null
      }
      Object.assign(row, update)
      return { ...row } as never
    },
    async updateMany({ model, where, update }) {
      const matched = rows(model).filter((row) => matches(row, where))
      for (const row of matched) {
        Object.assign(row, update)
      }
      return matched.length
    },
    async incrementOne({ model, where, increment, set }) {
      checkFailure()
      const row = rows(model).find((candidate) => matches(candidate, where))
      if (!row) {
        return null
      }
      for (const [field, amount] of Object.entries(increment)) {
        row[field] = Number(row[field] ?? 0) + amount
      }
      Object.assign(row, set)
      return { ...row } as never
    },
    async deleteMany({ model, where }) {
      const kept = rows(model).filter((row) => !matches(row, where))
      const removed = rows(model).length - kept.length
      tables.set(model, kept)
      return removed
    },
    async batch(operations) {
      batches.push([...operations])
      const snapshot = new Map([...tables].map(([model, table]) => [model, table.map((row) => ({ ...row }))]))
      try {
        const results = []
        for (const operation of operations) {
          switch (operation.type) {
            case "create":
              results.push(await adapter.create(operation))
              break
            case "update":
              results.push(await adapter.update(operation))
              break
            case "updateMany":
              results.push(await adapter.updateMany(operation))
              break
            case "incrementOne":
              results.push(await adapter.incrementOne(operation))
              break
            case "deleteMany":
              results.push(await adapter.deleteMany(operation))
              break
          }
        }
        return results
      } catch (error) {
        tables.clear()
        for (const [model, table] of snapshot) {
          tables.set(model, table)
        }
        throw error
      }
    }
  }

  return {
    database: () => adapter,
    tables,
    batches,
    failNextWrite(error = new Error("The write failed.")) {
      nextFailure = error
    }
  }
}
