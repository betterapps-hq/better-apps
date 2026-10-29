import { drizzleAdapter } from "@better-apps/drizzle"
import { defineFeature, type BetterAppsOptions } from "better-apps"
import { drizzle } from "drizzle-orm/pg-proxy"

const comments = defineFeature({
  id: "comments",
  schema: { comment: { fields: { body: { type: "string", required: true } } } }
})

// Generating a schema doesn't query the database, so the proxy never answers.
const db = drizzle(async () => ({ rows: [] }))

export default { database: drizzleAdapter(db, { provider: "pg" }), features: [comments] } satisfies BetterAppsOptions
