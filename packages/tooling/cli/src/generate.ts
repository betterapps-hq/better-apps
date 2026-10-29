import { getFeatureTables, type BetterAppsOptions } from "better-apps"
import type { DBAdapter } from "./replacements/adapter.js"
import type { BetterAuthOptions } from "./replacements/core.js"
import prettier from "./replacements/prettier.js"
import { generateDrizzleSchema } from "./vendor/better-auth/packages/cli/src/generators/drizzle.js"
import type { SchemaGenerator, SchemaGeneratorResult } from "./vendor/better-auth/packages/cli/src/generators/types.js"

export type { SchemaGeneratorResult }

const generators: Record<string, SchemaGenerator> = { drizzle: generateDrizzleSchema }

/** Options for generating the features' schema. */
export interface GenerateSchemaOptions extends BetterAppsOptions {
  /** Path of the schema file to write. The default is `./better-apps-schema.ts`. */
  file?: string | undefined
}

/** Generates the ORM schema for the features' tables. Writing the result to disk is up to the caller. */
export async function generateSchema({
  file,
  database,
  features
}: GenerateSchemaOptions): Promise<SchemaGeneratorResult> {
  const adapter = database({ schema: getFeatureTables(features) })
  const generator = generators[adapter.id]
  if (!generator) {
    throw new Error(
      `Better Apps can't generate a schema for the "${adapter.id}" adapter. Supported adapters: ${Object.keys(generators).join(", ")}.`
    )
  }
  // Better Auth's generators read features as plugins. src/replacements/db.ts turns them back into feature tables.
  const options: BetterAuthOptions = { plugins: features }
  // Each adapter's options hold its own configuration, in the shape the generator for its id reads.
  const result = await generator({ adapter: adapter as DBAdapter, options, file: file ?? "./better-apps-schema.ts" })
  const { code } = result
  if (code && adapter.id === "drizzle" && (adapter as DBAdapter).options?.provider === "mysql") {
    const fixed = withoutMysqlJsonMode(code)
    return fixed === code ? result : { ...result, code: await prettier.format(fixed, { parser: "typescript" }) }
  }
  return result
}

/**
 * Better Auth's Drizzle generator passes `{ mode: "json" }` to MySQL's `text` and `json` columns, for lists and JSON.
 * Drizzle's MySQL columns take no such option, so the schema failed type checks. Drizzle ignored it, so the columns
 * are the same without it, and the adapter encodes JSON for text columns itself.
 */
function withoutMysqlJsonMode(code: string): string {
  return code.replace(/\b(text|json)\((\s*(["'])[^"']*\3)\s*,\s*\{\s*mode:\s*(["'])json\4\s*,?\s*\}\s*\)/g, "$1($2)")
}
