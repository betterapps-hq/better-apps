// Forked from Better Auth's utils/string.ts. Generated table names use the same conversion.
const wordPattern = /[\p{Ll}\d]+|\p{Lu}+(?!\p{Ll})|\p{Lu}[\p{Ll}\d]+|\p{Lo}+/gu
const apostrophePattern = /['’]/g

/** Converts a model or field name to snake_case, such as `rateLimit` to `rate_limit`. */
export function toSnakeCase(input: string): string {
  return (input.replace(apostrophePattern, "").match(wordPattern) ?? []).map((word) => word.toLowerCase()).join("_")
}
