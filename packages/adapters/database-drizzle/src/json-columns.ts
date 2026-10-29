// Better Apps' own code. Upstream encodes JSON and lists as text for every database without native JSON or arrays, so a
// Drizzle column that encodes them itself, such as the JSON-mode text columns `better-apps generate` writes for SQLite
// and D1, stored a JSON string of the JSON. Here the Drizzle column decides.

/**
 * Whether a Drizzle column converts values to and from JSON itself, or with its driver: json and jsonb, SQLite text and
 * blob in JSON mode, and Postgres arrays. Drizzle 0.x names those data types `"json"` and `"array"`.
 */
function encodesJson(column: unknown): boolean {
  const dataType = (column as { dataType?: unknown } | undefined)?.dataType
  return dataType === "json" || dataType === "array"
}

/**
 * Encodes a value as JSON text for a column that stores plain text, strings included, so it reads back as the same
 * type. A column that encodes JSON gets the value.
 */
export function toDriverJson(value: unknown, column: unknown): unknown {
  return value === null || value === undefined || encodesJson(column) ? value : JSON.stringify(value)
}

/**
 * Parses the JSON text read from a column that stores plain text. A column that encodes JSON returns the value as is:
 * Drizzle parses SQLite's JSON mode and Postgres's json and jsonb, and MySQL drivers such as mysql2 parse MySQL's json
 * column. Text that isn't JSON, such as a string an older write stored unencoded, is returned as is.
 */
export function fromDriverJson(value: unknown, column: unknown): unknown {
  if (typeof value !== "string" || encodesJson(column)) {
    return value
  }
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}
