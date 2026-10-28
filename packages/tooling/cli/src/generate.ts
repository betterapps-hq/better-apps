import type { BetterAuthOptions } from "@better-auth/core"
import type { BetterAppsOptions } from "better-apps"
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
  // Better Auth's generators read features as plugins. src/replacements/db.ts turns them back into feature tables.
  const options: BetterAuthOptions = { database, plugins: features.map(({ id, schema }) => ({ id, schema })) }
  const adapter = database(options)
  const generator = generators[adapter.id]
  if (!generator) {
    throw new Error(
      `Better Apps can't generate a schema for the "${adapter.id}" adapter. Supported adapters: ${Object.keys(generators).join(", ")}.`
    )
  }
  return generator({ adapter, options, file: file ?? "./better-apps-schema.ts" })
}
