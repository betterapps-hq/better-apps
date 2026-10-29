import type { DatabaseAdapterFactory } from "./database.js"
import type { BetterAppsFeature } from "./feature.js"

/** The database adapter and the features an app enables. */
export interface BetterAppsOptions {
  /** A database adapter, such as `drizzleAdapter(db, { provider: "pg" })` from `@better-apps/drizzle`. */
  database: DatabaseAdapterFactory
  /** Features whose tables are generated and made available to the adapter. */
  features: readonly BetterAppsFeature[]
}
