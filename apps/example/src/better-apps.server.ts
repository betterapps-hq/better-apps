import { drizzleAdapter } from "@better-apps/database-drizzle"
import { betterAuthIdentity } from "@better-apps/identity-better-auth"
import { createStartBindings } from "@better-apps/tanstack-start"
import { createBetterApps } from "better-apps"
import { auth } from "./auth.server"
import { db } from "./db/database.server"
import { seedComments } from "./db/seed-comments.server"
import { features, subjects } from "./features"

/** Who requests act for: the person signed in with Better Auth. */
export const identity = betterAuthIdentity(auth)

/** The app's features on its SQLite database. */
export const app = createBetterApps({
  database: drizzleAdapter(db, { provider: "sqlite" }),
  identity,
  subjects,
  features
})

// Node has no waitUntil, so responses wait for event delivery. A Worker would pass its waitUntil here.
export const { api, handlers, client } = createStartBindings(app)

// Node has no cron trigger, so the example delivers events left for later, such as domains' scheduled checks, every
// minute. One timer per process, even when the dev server reloads this module.
const timer = Symbol.for("better-apps-example.deliver-events")
const scope = globalThis as { [timer]?: ReturnType<typeof setInterval> }
clearInterval(scope[timer])
scope[timer] = setInterval(() => {
  app.deliverEvents().catch((error: unknown) => console.error("Delivering events failed", error))
}, 60_000)
scope[timer].unref()

// Adds the sample conversations on the first start, through the features, as the demo people.
await seedComments(app)
