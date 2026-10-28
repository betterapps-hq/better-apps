import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { defineFeature, type BetterAppsOptions } from "better-apps"

const comments = defineFeature({
  id: "comments",
  schema: { comment: { fields: { body: { type: "string", required: true } } } }
})

export default { database: drizzleAdapter({}, { provider: "pg" }), features: [comments] } satisfies BetterAppsOptions
