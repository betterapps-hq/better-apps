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

// Adds the sample conversations on the first start, through the features, as the demo people.
await seedComments(app)

// Removes uploads that never finished and comment drafts that were never posted, a page at a time. A Worker would
// sweep from a scheduled handler instead.
let swept = await app.api.attachments.sweep()
while (!swept.done) {
  swept = await app.api.attachments.sweep()
}
