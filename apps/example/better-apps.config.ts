import { drizzleAdapter } from "@better-apps/drizzle"
import type { BetterAppsOptions } from "better-apps"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { features } from "./src/features.ts"

// Generating the schema never queries the database, so the proxy doesn't answer.
const db = drizzle(async () => ({ rows: [] }))

export default { database: drizzleAdapter(db, { provider: "sqlite" }), features } satisfies BetterAppsOptions
