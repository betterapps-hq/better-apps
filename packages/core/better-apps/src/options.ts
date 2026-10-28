import type { BetterAuthOptions } from "@better-auth/core"
import type { DBAdapterInstance } from "@better-auth/core/db/adapter"
import type { BetterAppsFeature } from "./feature.js"

/** The database adapter and the features an app enables. */
export interface BetterAppsOptions {
  /** A Better Auth database adapter, such as `drizzleAdapter(db, { provider: "pg" })`. */
  database: DBAdapterInstance
  /** Features whose tables are generated and made available to the adapter. */
  features: readonly BetterAppsFeature[]
}

/** Presents features to Better Auth's adapters and generators as plugins. */
export function toBetterAuthOptions({ database, features }: BetterAppsOptions): BetterAuthOptions {
  return { database, plugins: features.map(({ id, schema }) => ({ id, schema })) }
}
