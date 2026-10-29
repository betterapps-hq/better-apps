import { defineConfig } from "drizzle-kit"

// The app's own tables, Better Auth's, and the ones `better-apps generate` writes for its features share one set of
// migrations.
export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/db/schema.ts", "./src/db/auth-schema.ts", "./src/db/better-apps-schema.ts"],
  out: "./drizzle"
})
