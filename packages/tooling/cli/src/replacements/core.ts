// Stands in for `better-auth/types` and `@better-auth/core` in vendored code: the options the generators read.
// Features are passed as plugins, and src/replacements/db.ts turns them back into feature tables.
import type { BetterAppsFeature } from "better-apps"

export interface BetterAuthOptions {
  plugins?: readonly BetterAppsFeature[] | undefined
  /** Better Auth's id option. Better Apps never sets it, so generated ids are text columns. */
  advanced?:
    | { database?: { generateId?: "serial" | "uuid" | false | (() => string) | undefined } | undefined }
    | undefined
}
