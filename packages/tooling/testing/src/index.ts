import { createBetterApps, type BetterApp, type BetterAppsFeature, type CreateBetterAppsOptions } from "better-apps"
import { testDatabase, type TestDatabase } from "./database.js"
import { testIdentity, type TestIdentity, type TestUser } from "./identity.js"

export { createStatements, testDatabase, type TestDatabase } from "./database.js"
export { testIdentity, testUserHeader, type TestIdentity, type TestUser } from "./identity.js"

/** Options for `createTestApp`: the app's options, with test users instead of a database and an identity. */
export type CreateTestAppOptions<Features extends readonly BetterAppsFeature[]> = Omit<
  CreateBetterAppsOptions<Features>,
  "database" | "identity"
> & {
  users?: readonly TestUser[] | undefined
}

/** Creates an app on a fresh in-memory database, with a test identity for the given users. */
export function createTestApp<const Features extends readonly BetterAppsFeature[]>({
  users = [],
  ...options
}: CreateTestAppOptions<Features>): { app: BetterApp<Features>; database: TestDatabase; identity: TestIdentity } {
  const database = testDatabase()
  const identity = testIdentity(users)
  const app = createBetterApps({ ...options, database, identity })
  return { app, database, identity }
}
