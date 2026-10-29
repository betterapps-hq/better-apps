// Forked from Better Auth's db/adapter/factory.ts and the naming helpers beside it (get-default-model-name.ts,
// get-default-field-name.ts, get-model-name.ts and get-field-name.ts). It maps logical model and field names to tables
// and columns and converts values on their way in and out, so an ORM adapter only builds queries. See docs/fork.md for
// what changed from upstream.
import type {
  CountGroup,
  DatabaseAdapter,
  DatabaseAdapterFactory,
  DatabaseSchema,
  FieldAttribute,
  FieldValue,
  Row,
  SortBy,
  Where,
  WhereOperator,
  WriteOperation,
  WriteResult
} from "better-apps"

/** A condition with its field mapped to a column, and its value to what the driver stores. */
export interface ColumnWhere {
  column: string
  value: unknown
  operator: WhereOperator
  connector: "AND" | "OR"
  mode: "sensitive" | "insensitive"
}

/** A sort key mapped to its column. */
export interface ColumnSort {
  column: string
  direction: "asc" | "desc"
}

/** A batch write with names mapped to the ORM schema's table and column keys. */
export type ColumnWrite =
  | { type: "create"; table: string; data: Row }
  | { type: "update" | "updateMany"; table: string; where: ColumnWhere[]; update: Row }
  | { type: "incrementOne"; table: string; where: ColumnWhere[]; increment: Record<string, number>; set: Row }
  | { type: "deleteMany"; table: string; where: ColumnWhere[] }

/** The queries an ORM adapter runs. Tables and columns are the ORM schema's keys, and values are already converted. */
export interface AdapterDriver {
  create(input: { table: string; data: Row }): Promise<Row>
  createMany(input: { table: string; data: Row[] }): Promise<Row[]>
  findOne(input: { table: string; where: ColumnWhere[]; select?: string[] | undefined }): Promise<Row | null>
  findMany(input: {
    table: string
    where: ColumnWhere[]
    sortBy: ColumnSort[]
    /** The driver values of the sort keys from the previous page's last row. */
    after?: unknown[] | undefined
    limit?: number | undefined
    offset?: number | undefined
    select?: string[] | undefined
  }): Promise<Row[]>
  count(input: { table: string; where: ColumnWhere[] }): Promise<number>
  countGroups(input: { table: string; where: ColumnWhere[]; groupBy: string[] }): Promise<CountGroup[]>
  update(input: { table: string; where: ColumnWhere[]; update: Row }): Promise<Row | null>
  updateMany(input: { table: string; where: ColumnWhere[]; update: Row }): Promise<number>
  incrementOne(input: {
    table: string
    where: ColumnWhere[]
    increment: Record<string, number>
    set: Row
  }): Promise<Row | null>
  deleteMany(input: { table: string; where: ColumnWhere[] }): Promise<number>
  batch(writes: ColumnWrite[]): Promise<WriteResult[]>
}

/** Where a value is going to or coming from. */
export interface ValueContext {
  table: string
  column: string
  field: FieldAttribute
}

export interface AdapterFactoryConfig {
  /** The adapter's name, such as `drizzle`. */
  id: string
  /** The adapter's configuration, which schema generators read. */
  options: Record<string, unknown>
  /** Whether the ORM schema's table keys are the model names with an `s` added. */
  usePlural?: boolean | undefined
  /** Whether the database stores JSON natively. Otherwise JSON is stored as text. */
  supportsJSON: boolean
  /** Whether the database stores arrays natively. Otherwise arrays are stored as JSON text. */
  supportsArrays: boolean
  /** Generates the id of a created row that has none, or `false` to leave it to the database. */
  generateId: (() => string) | false
  /** Converts a value bound for a column, after the built-in conversions. */
  toDriver?: ((value: unknown, context: ValueContext) => unknown) | undefined
  /** Converts a value read from a column, before the built-in conversions. */
  fromDriver?: ((value: unknown, context: ValueContext) => unknown) | undefined
}

const idAttribute: FieldAttribute = { type: "string", required: true }

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

// Values in a where clause or cursor may arrive as strings, such as from a query string.
function coerce(field: FieldAttribute, value: unknown): unknown {
  if (field.type === "number" && typeof value === "string" && value.trim() !== "") {
    const number = Number(value)
    return Number.isNaN(number) ? value : number
  }
  if (field.type === "boolean" && typeof value === "string") {
    return value === "true"
  }
  return value
}

function sortKeys(sortBy: SortBy | readonly SortBy[] | undefined): readonly SortBy[] {
  if (sortBy === undefined) {
    return []
  }
  return "field" in sortBy ? [sortBy] : sortBy
}

/** Creates a database adapter factory from the queries an ORM adapter runs. */
export function createAdapterFactory(config: AdapterFactoryConfig, driver: AdapterDriver): DatabaseAdapterFactory {
  return ({ schema }: { schema: DatabaseSchema }): DatabaseAdapter => {
    const usePlural = config.usePlural ?? false

    // Resolves a model key or a custom modelName to the model key. An exact key wins over a modelName, so remapping one
    // table onto another's key can't reroute queries. With usePlural, a trailing "s" is ignored first.
    function getModelKey(model: string): string {
      const resolve = (candidate: string) =>
        schema[candidate] ? candidate : Object.entries(schema).find(([, table]) => table.modelName === candidate)?.[0]
      if (usePlural && model.endsWith("s")) {
        const singular = resolve(model.slice(0, -1))
        if (singular) {
          return singular
        }
      }
      const key = resolve(model)
      if (!key) {
        throw new Error(`The "${model}" model isn't in the schema. Check that the feature that declares it is enabled.`)
      }
      return key
    }

    function getTableName(modelKey: string): string {
      const name = schema[modelKey]!.modelName
      return usePlural ? `${name}s` : name
    }

    function getFields(modelKey: string): [string, FieldAttribute][] {
      return [["id", idAttribute], ...Object.entries(schema[modelKey]!.fields)]
    }

    // Resolves a field name or a custom fieldName to the logical field. Every model has an implicit `id`.
    function getField(modelKey: string, field: string): [string, FieldAttribute] {
      if (field === "id") {
        return ["id", idAttribute]
      }
      const fields = schema[modelKey]!.fields
      const attribute = fields[field]
      if (attribute) {
        return [field, attribute]
      }
      const match = Object.entries(fields).find(([, candidate]) => candidate.fieldName === field)
      if (!match) {
        throw new Error(`The "${modelKey}" model has no "${field}" field.`)
      }
      return match
    }

    const getColumn = (name: string, field: FieldAttribute) => field.fieldName ?? name

    function toStorage(table: string, column: string, field: FieldAttribute, value: unknown): unknown {
      let result = value
      if (field.type === "json" && !config.supportsJSON && result !== null && typeof result === "object") {
        result = JSON.stringify(result)
      } else if (
        (field.type === "string[]" || field.type === "number[]") &&
        !config.supportsArrays &&
        Array.isArray(result)
      ) {
        result = JSON.stringify(result)
      }
      return config.toDriver ? config.toDriver(result, { table, column, field }) : result
    }

    async function toRow(modelKey: string, data: Row, action: "create" | "update"): Promise<Row> {
      const fields = schema[modelKey]!.fields
      for (const key of Object.keys(data)) {
        if (key !== "id" && !(key in fields)) {
          throw new Error(`The "${modelKey}" model has no "${key}" field.`)
        }
      }
      const table = getTableName(modelKey)
      const row: Row = {}
      for (const [name, field] of getFields(modelKey)) {
        let value = data[name]
        if (action === "create" && name === "id" && value === undefined && config.generateId) {
          value = config.generateId()
        }
        // As upstream, a default replaces a missing value, or a null one for a field explicitly marked required.
        if (
          action === "create" &&
          (value === undefined || (value === null && field.required === true)) &&
          field.defaultValue !== undefined
        ) {
          value = typeof field.defaultValue === "function" ? field.defaultValue() : field.defaultValue
        }
        if (action === "update" && value === undefined && field.onUpdate) {
          value = field.onUpdate()
        }
        // An optional field set on update, with no default, starts empty. Drizzle's $onUpdate, which schema generators
        // write for these fields, would otherwise fill it on insert too.
        if (
          action === "create" &&
          value === undefined &&
          field.onUpdate &&
          field.defaultValue === undefined &&
          field.required !== true
        ) {
          value = null
        }
        if (value === undefined) {
          continue
        }
        // Dates sent as JSON arrive as strings.
        if (field.type === "date" && typeof value === "string") {
          value = new Date(value)
        }
        if (field.transform?.input) {
          value = await field.transform.input(value as FieldValue)
        }
        const column = getColumn(name, field)
        row[column] = toStorage(table, column, field, value)
      }
      return row
    }

    async function fromRow(modelKey: string, row: Row, select?: readonly string[]): Promise<Row> {
      const table = getTableName(modelKey)
      const result: Row = {}
      for (const [name, field] of getFields(modelKey)) {
        const column = getColumn(name, field)
        if ((select?.length && !select.includes(name)) || !(column in row)) {
          continue
        }
        let value = row[column]
        if (value !== null && value !== undefined) {
          if (config.fromDriver) {
            value = config.fromDriver(value, { table, column, field })
          }
          if (name === "id" || field.references?.field === "id") {
            value = String(value)
          } else if (
            typeof value === "string" &&
            ((field.type === "json" && !config.supportsJSON) ||
              ((field.type === "string[]" || field.type === "number[]") && !config.supportsArrays))
          ) {
            value = parseJson(value)
          }
        }
        if (field.transform?.output) {
          value = await field.transform.output(value as FieldValue)
        }
        result[name] = value
      }
      return result
    }

    function toWhere(modelKey: string, where: readonly Where[] = []): ColumnWhere[] {
      const table = getTableName(modelKey)
      return where.map(({ field: fieldName, value, operator = "eq", connector = "AND", mode = "sensitive" }) => {
        const [name, field] = getField(modelKey, fieldName)
        const column = getColumn(name, field)
        const convert = (item: unknown) => toStorage(table, column, field, coerce(field, item))
        if (operator === "in" || operator === "not_in") {
          if (!Array.isArray(value)) {
            throw new Error(`The "${operator}" operator on "${fieldName}" needs a list of values.`)
          }
          return { column, operator, connector, mode, value: (value as readonly unknown[]).map(convert) }
        }
        return { column, operator, connector, mode, value: convert(value) }
      })
    }

    function toSort(modelKey: string, sortBy: SortBy | readonly SortBy[] | undefined, after: Row | undefined) {
      const table = getTableName(modelKey)
      const keys = sortKeys(sortBy).map(({ field: fieldName, direction }) => {
        const [name, field] = getField(modelKey, fieldName)
        return { name, field, column: getColumn(name, field), direction }
      })
      const columns: ColumnSort[] = keys.map(({ column, direction }) => ({ column, direction }))
      if (!after) {
        return { sortBy: columns, after: undefined }
      }
      if (!keys.length) {
        throw new Error("A cursor needs a sort order. Pass sortBy with after.")
      }
      const values = keys.map(({ name, field, column }) => {
        const value = after[name]
        if (value === undefined || value === null) {
          throw new Error(`The cursor needs a value for "${name}", one of the sort keys.`)
        }
        return toStorage(table, column, field, coerce(field, value))
      })
      return { sortBy: columns, after: values }
    }

    function toColumns(modelKey: string, fields: readonly string[]): string[] {
      return fields.map((fieldName) => {
        const [name, field] = getField(modelKey, fieldName)
        return getColumn(name, field)
      })
    }

    function requireWhere(type: string, where: readonly Where[]) {
      if (!where.length) {
        throw new Error(`${type} changes a single row, so it needs at least one condition.`)
      }
    }

    async function toIncrement(modelKey: string, increment: Record<string, number>, set: Row | undefined) {
      const columns: Record<string, number> = {}
      for (const [fieldName, delta] of Object.entries(increment)) {
        const [name, field] = getField(modelKey, fieldName)
        if (field.type !== "number") {
          throw new Error(`Only number fields can be incremented, and "${fieldName}" is a ${String(field.type)} field.`)
        }
        columns[getColumn(name, field)] = delta
      }
      return { increment: columns, set: await toRow(modelKey, set ?? {}, "update") }
    }

    async function toWrite(operation: WriteOperation): Promise<ColumnWrite> {
      const modelKey = getModelKey(operation.model)
      const table = getTableName(modelKey)
      switch (operation.type) {
        case "create":
          return { type: "create", table, data: await toRow(modelKey, operation.data, "create") }
        case "update":
        case "updateMany":
          if (operation.type === "update") {
            requireWhere("update", operation.where)
          }
          return {
            type: operation.type,
            table,
            where: toWhere(modelKey, operation.where),
            update: await toRow(modelKey, operation.update, "update")
          }
        case "incrementOne":
          requireWhere("incrementOne", operation.where)
          return {
            type: "incrementOne",
            table,
            where: toWhere(modelKey, operation.where),
            ...(await toIncrement(modelKey, operation.increment, operation.set))
          }
        case "deleteMany":
          return { type: "deleteMany", table, where: toWhere(modelKey, operation.where) }
      }
    }

    const readRow = async <T extends Row>(modelKey: string, row: Row | null, select?: readonly string[]) =>
      row ? ((await fromRow(modelKey, row, select)) as T) : null

    return {
      id: config.id,
      options: config.options,
      async create<T extends Row = Row>({ model, data }: { model: string; data: Row }) {
        const modelKey = getModelKey(model)
        const row = await driver.create({ table: getTableName(modelKey), data: await toRow(modelKey, data, "create") })
        return (await fromRow(modelKey, row)) as T
      },
      async createMany<T extends Row = Row>({ model, data }: { model: string; data: readonly Row[] }) {
        if (!data.length) {
          return []
        }
        const modelKey = getModelKey(model)
        const rows = await Promise.all(data.map((item) => toRow(modelKey, item, "create")))
        const created = await driver.createMany({ table: getTableName(modelKey), data: rows })
        return Promise.all(created.map(async (row) => (await fromRow(modelKey, row)) as T))
      },
      async findOne<T extends Row = Row>({ model, where, select }: Parameters<DatabaseAdapter["findOne"]>[0]) {
        const modelKey = getModelKey(model)
        const row = await driver.findOne({
          table: getTableName(modelKey),
          where: toWhere(modelKey, where),
          select: select && toColumns(modelKey, select)
        })
        return readRow<T>(modelKey, row, select)
      },
      async findMany<T extends Row = Row>({
        model,
        where,
        sortBy,
        after,
        limit,
        offset,
        select
      }: Parameters<DatabaseAdapter["findMany"]>[0]) {
        const modelKey = getModelKey(model)
        const rows = await driver.findMany({
          table: getTableName(modelKey),
          where: toWhere(modelKey, where),
          ...toSort(modelKey, sortBy, after),
          limit,
          offset,
          select: select && toColumns(modelKey, select)
        })
        return Promise.all(rows.map(async (row) => (await fromRow(modelKey, row, select)) as T))
      },
      async count({ model, where }) {
        const modelKey = getModelKey(model)
        return driver.count({ table: getTableName(modelKey), where: toWhere(modelKey, where) })
      },
      async countGroups({ model, where, groupBy }) {
        const modelKey = getModelKey(model)
        const names = groupBy.map((fieldName) => getField(modelKey, fieldName)[0])
        const groups = await driver.countGroups({
          table: getTableName(modelKey),
          where: toWhere(modelKey, where),
          groupBy: toColumns(modelKey, groupBy)
        })
        return Promise.all(
          groups.map(async ({ group, count }) => ({ group: await fromRow(modelKey, group, names), count }))
        )
      },
      async update<T extends Row = Row>({ model, where, update }: Parameters<DatabaseAdapter["update"]>[0]) {
        requireWhere("update", where)
        const modelKey = getModelKey(model)
        const row = await driver.update({
          table: getTableName(modelKey),
          where: toWhere(modelKey, where),
          update: await toRow(modelKey, update, "update")
        })
        return readRow<T>(modelKey, row)
      },
      async updateMany({ model, where, update }) {
        const modelKey = getModelKey(model)
        return driver.updateMany({
          table: getTableName(modelKey),
          where: toWhere(modelKey, where),
          update: await toRow(modelKey, update, "update")
        })
      },
      async incrementOne<T extends Row = Row>({
        model,
        where,
        increment,
        set
      }: Parameters<DatabaseAdapter["incrementOne"]>[0]) {
        requireWhere("incrementOne", where)
        const modelKey = getModelKey(model)
        const row = await driver.incrementOne({
          table: getTableName(modelKey),
          where: toWhere(modelKey, where),
          ...(await toIncrement(modelKey, increment, set))
        })
        return readRow<T>(modelKey, row)
      },
      async deleteMany({ model, where }) {
        const modelKey = getModelKey(model)
        return driver.deleteMany({ table: getTableName(modelKey), where: toWhere(modelKey, where) })
      },
      async batch(operations) {
        if (!operations.length) {
          return []
        }
        const writes = await Promise.all(operations.map(toWrite))
        const results = await driver.batch(writes)
        return Promise.all(
          results.map((result, index) =>
            typeof result === "number" || result === null
              ? result
              : fromRow(getModelKey(operations[index]!.model), result)
          )
        )
      }
    }
  }
}
