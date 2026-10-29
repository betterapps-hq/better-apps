import { drizzleAdapter } from "@better-apps/drizzle"
import { createStartBindings } from "@better-apps/tanstack-start"
import { createBetterApps, localIdentity } from "better-apps"
import { db } from "./db/database.server"
import { features } from "./features"

/** Who requests act for. Every request acts as the one local user. */
export const identity = localIdentity()

/** The app's features on its SQLite database. */
export const app = createBetterApps({
  database: drizzleAdapter(db, { provider: "sqlite" }),
  identity,
  features
})

// Node has no waitUntil, so responses wait for event delivery. A Worker would pass its waitUntil here.
export const { api, handlers, client } = createStartBindings(app)
