import { betterAuthIdentity } from "@better-apps/better-auth"
import { drizzleAdapter } from "@better-apps/drizzle"
import { createStartBindings } from "@better-apps/tanstack-start"
import { createBetterApps } from "better-apps"
import { auth } from "./auth.server"
import { db } from "./db/database.server"
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
