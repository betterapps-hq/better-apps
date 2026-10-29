import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { count } from "drizzle-orm"
import * as authTables from "./db/auth-schema"
import { db } from "./db/database.server"
import { demoPassword, demoUsers } from "./demo-users"

// The example's own origins, in development and preview. Better Auth refuses sign-ins sent from any other.
const origins = [4190, 4191].flatMap((port) => [`http://127.0.0.1:${port}`, `http://localhost:${port}`])

/** Email and password sign-in, with sessions in the app's SQLite database. */
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:4190",
  // A fixed secret keeps sessions valid across restarts on your machine. Set BETTER_AUTH_SECRET anywhere else.
  secret: process.env.BETTER_AUTH_SECRET ?? "better-apps-example-secret-for-local-use-only",
  trustedOrigins: origins,
  database: drizzleAdapter(db, { provider: "sqlite", schema: authTables }),
  emailAndPassword: { enabled: true },
  telemetry: { enabled: false }
})

// Signs up the demo people on the first start, so there's someone to sign in as.
const [existing] = await db.select({ users: count() }).from(authTables.user)
if (!existing?.users) {
  for (const person of demoUsers) {
    await auth.api.signUpEmail({ body: { ...person, password: demoPassword } })
  }
}
