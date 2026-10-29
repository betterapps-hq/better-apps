// Forked from Better Auth's drizzle-adapter/src/query-builders.ts. Pattern operators now escape `%`, `_` and `\` in the
// value, so `contains`, `starts_with` and `ends_with` match it literally.
import { sql, type Column, type SQL } from "drizzle-orm"

export type Provider = "pg" | "mysql" | "sqlite"

/** Escapes LIKE wildcards so a value matches literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/**
 * LIKE with an explicit backslash escape character. SQLite has no default LIKE escape, so the ESCAPE clause is always
 * supplied. Insensitive matching uses ILIKE on PostgreSQL and LOWER() elsewhere.
 */
export function escapedLike(
  column: Column,
  pattern: string,
  provider: Provider,
  mode: "sensitive" | "insensitive" = "sensitive"
): SQL {
  const escape = "\\"
  if (mode === "insensitive") {
    return provider === "pg"
      ? sql`${column} ILIKE ${pattern} ESCAPE ${escape}`
      : sql`LOWER(${column}) LIKE LOWER(${pattern}) ESCAPE ${escape}`
  }
  return sql`${column} LIKE ${pattern} ESCAPE ${escape}`
}

/** Case-insensitive IN for strings. */
export function insensitiveInArray(column: Column, values: readonly string[]): SQL {
  if (values.length === 0) {
    return sql`false`
  }
  return sql`LOWER(${column}) IN (${sql.join(
    values.map((value) => sql`LOWER(${value})`),
    sql`, `
  )})`
}

/** Case-insensitive NOT IN for strings. */
export function insensitiveNotInArray(column: Column, values: readonly string[]): SQL {
  if (values.length === 0) {
    return sql`true`
  }
  return sql`LOWER(${column}) NOT IN (${sql.join(
    values.map((value) => sql`LOWER(${value})`),
    sql`, `
  )})`
}

/** Case-insensitive equality for strings. */
export function insensitiveEq(column: Column, value: string): SQL {
  return sql`LOWER(${column}) = LOWER(${value})`
}

/** Case-insensitive inequality for strings. */
export function insensitiveNe(column: Column, value: string): SQL {
  return sql`LOWER(${column}) <> LOWER(${value})`
}
