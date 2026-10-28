import type { DBAdapter } from "@better-auth/core/db/adapter"
import { toBetterAuthOptions, type BetterAppsOptions } from "./options.js"

/** Creates the runtime adapter features use to read and write their tables, whatever the ORM. */
export function createDatabaseAdapter(options: BetterAppsOptions): DBAdapter {
  return options.database(toBetterAuthOptions(options))
}
