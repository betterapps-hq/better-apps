import type { BetterAppsOptions } from "./options.js"
import type { DatabaseSchema, FieldValue } from "./schema.js"
import { getFeatureTables } from "./tables.js"

/** A comparison in a `where` list. Every operator but `in` and `not_in` takes a single value. */
export type WhereOperator =
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in"
  | "not_in"
  | "contains"
  | "starts_with"
  | "ends_with"

/**
 * One condition on a field. Conditions joined with `AND`, the default, must all match. Those joined with `OR` match
 * when any of them does, and a list with both needs both groups to match.
 */
export interface Where {
  field: string
  value: FieldValue | readonly FieldValue[]
  operator?: WhereOperator | undefined
  connector?: "AND" | "OR" | undefined
  /** Compares strings without regard to case. The default is `sensitive`. */
  mode?: "sensitive" | "insensitive" | undefined
}

/** One key of a sort order. */
export interface SortBy {
  field: string
  direction: "asc" | "desc"
}

/** A row as features read and write it, keyed by logical field name. */
export type Row = Record<string, unknown>

/** The number of rows that share one combination of the grouped fields. */
export interface CountGroup {
  group: Row
  count: number
}

/** A write that runs inside a batch. */
export type WriteOperation =
  | { type: "create"; model: string; data: Row }
  | { type: "update"; model: string; where: readonly Where[]; update: Row }
  | { type: "updateMany"; model: string; where: readonly Where[]; update: Row }
  | {
      type: "incrementOne"
      model: string
      where: readonly Where[]
      increment: Record<string, number>
      set?: Row | undefined
    }
  | { type: "deleteMany"; model: string; where: readonly Where[] }

/**
 * What each write in a batch returns, in order: the created row, the updated row or `null` when nothing matched, or the
 * number of rows `updateMany` and `deleteMany` changed.
 */
export type WriteResult = Row | null | number

/** Reads and writes feature tables. Every method takes logical model and field names. */
export interface DatabaseAdapter {
  /** The adapter's name, such as `drizzle`. */
  id: string
  /** The adapter's configuration, which schema generators read. */
  options: Record<string, unknown>
  /** Creates a row. An `id` in `data` is kept, so callers can make retries safe; otherwise one is generated. */
  create<T extends Row = Row>(input: { model: string; data: Row }): Promise<T>
  /** Creates rows in one atomic write. */
  createMany<T extends Row = Row>(input: { model: string; data: readonly Row[] }): Promise<T[]>
  findOne<T extends Row = Row>(input: {
    model: string
    where: readonly Where[]
    select?: readonly string[] | undefined
  }): Promise<T | null>
  /**
   * Lists rows. `sortBy` may name several keys. `after` holds the sort keys' values from the last row of the previous
   * page and returns the rows that follow it in that order, so rows that tie on the first key are never skipped or
   * repeated. Every sort key must be non-null for `after` to work.
   */
  findMany<T extends Row = Row>(input: {
    model: string
    where?: readonly Where[] | undefined
    sortBy?: SortBy | readonly SortBy[] | undefined
    after?: Row | undefined
    limit?: number | undefined
    offset?: number | undefined
    select?: readonly string[] | undefined
  }): Promise<T[]>
  count(input: { model: string; where?: readonly Where[] | undefined }): Promise<number>
  /** Counts rows per combination of `groupBy` values, in one query. */
  countGroups(input: {
    model: string
    where?: readonly Where[] | undefined
    groupBy: readonly [string, ...string[]]
  }): Promise<CountGroup[]>
  /** Updates the first row that matches and returns it, or `null` when none does. */
  update<T extends Row = Row>(input: { model: string; where: readonly Where[]; update: Row }): Promise<T | null>
  updateMany(input: { model: string; where: readonly Where[]; update: Row }): Promise<number>
  /**
   * Adds to numeric fields of one matching row, and sets other fields, in one statement. `where` both selects and guards
   * the row, so it returns `null` when a concurrent change makes the row stop matching.
   */
  incrementOne<T extends Row = Row>(input: {
    model: string
    where: readonly Where[]
    increment: Record<string, number>
    set?: Row | undefined
  }): Promise<T | null>
  deleteMany(input: { model: string; where: readonly Where[] }): Promise<number>
  /** Runs writes in order as one atomic unit: all of them apply, or none do. */
  batch(operations: readonly WriteOperation[]): Promise<WriteResult[]>
}

/** Creates a database adapter for the tables the enabled features declare. */
export type DatabaseAdapterFactory = (options: { schema: DatabaseSchema }) => DatabaseAdapter

/** Creates the runtime adapter features use to read and write their tables, whatever the ORM. */
export function createDatabaseAdapter({ database, features }: BetterAppsOptions): DatabaseAdapter {
  return database({ schema: getFeatureTables(features) })
}
