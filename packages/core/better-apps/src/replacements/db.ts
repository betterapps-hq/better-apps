// Stands in for `better-auth/db` in vendored code. Only `getAuthTables` differs from upstream.
import type { BetterAuthOptions } from "@better-auth/core"
import type { BetterAuthDBSchema } from "@better-auth/core/db"
import { getFeatureTables } from "../tables.js"

export type { BetterAuthDBSchema, DBFieldAttribute } from "@better-auth/core/db"

export function getAuthTables(options: BetterAuthOptions): BetterAuthDBSchema {
  return getFeatureTables(options.plugins ?? [])
}
