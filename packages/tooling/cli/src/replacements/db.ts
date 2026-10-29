// Stands in for `better-auth/db` and Better Auth's db/type.ts in vendored code, with Better Apps' schema types. Only
// `getAuthTables` behaves differently from upstream: it returns feature tables only.
import { getFeatureTables, type DatabaseSchema, type FieldAttribute, type TableIndex } from "better-apps"
import type { BetterAuthOptions } from "./core.js"

export type BetterAuthDBSchema = DatabaseSchema
export type DBFieldAttribute = FieldAttribute
export type DBTableIndex = TableIndex

export function getAuthTables(options: BetterAuthOptions): BetterAuthDBSchema {
  return getFeatureTables(options.plugins ?? [])
}
