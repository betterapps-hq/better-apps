import { eventModel, eventTables } from "./events.js"
import type { BetterAppsFeature } from "./feature.js"
import type { DatabaseSchema, FeatureSchema, TableIndex } from "./schema.js"
import { toSnakeCase } from "./string.js"

// Better Auth's runtime adapters always define these models, and its generators write them as these snake_case tables.
// A feature table with the same key would merge into them; one with the same table name would collide in a shared
// database. Names are compared after the generators' snake_case conversion, so `User` and `rate_limit` match too.
const reservedTables = new Set(["user", "session", "account", "verification", "rateLimit"].map(toSnakeCase))

function mergeIndexes(...collections: readonly (readonly TableIndex[] | undefined)[]): TableIndex[] {
  const indexes: TableIndex[] = []
  const seen = new Set<string>()
  for (const index of collections.flatMap((collection) => collection ?? [])) {
    const definition = JSON.stringify([index.name ?? null, index.fields, index.unique ?? false])
    if (!seen.has(definition)) {
      seen.add(definition)
      indexes.push(index)
    }
  }
  return indexes
}

function addTables(tables: DatabaseSchema, schema: FeatureSchema): void {
  for (const [key, table] of Object.entries(schema)) {
    const existing = tables[key]
    tables[key] = {
      modelName: table.modelName || existing?.modelName || key,
      fields: { ...existing?.fields, ...table.fields },
      indexes: mergeIndexes(existing?.indexes, table.indexes),
      disableMigrations: table.disableMigration ?? existing?.disableMigrations
    }
  }
}

/**
 * Merges the tables of every feature. Features may extend a table another feature declares; later fields win. The
 * core adds its event outbox when any feature subscribes to events. Unlike Better Auth's `getAuthTables`, no user or
 * session tables are added.
 */
export function getFeatureTables(features: readonly BetterAppsFeature[]): DatabaseSchema {
  const tables: DatabaseSchema = {}
  const ids = new Set<string>()
  for (const feature of features) {
    if (ids.has(feature.id)) {
      throw new Error(`The "${feature.id}" feature is registered more than once.`)
    }
    ids.add(feature.id)
    for (const [key, table] of Object.entries(feature.schema ?? {})) {
      for (const name of [key, table.modelName]) {
        if (name && reservedTables.has(toSnakeCase(name))) {
          throw new Error(
            `The "${feature.id}" feature can't declare a "${name}" table. Better Auth reserves that name.`
          )
        }
        if (name && toSnakeCase(name) === toSnakeCase(eventModel)) {
          throw new Error(
            `The "${feature.id}" feature can't declare a "${name}" table. Better Apps reserves that name.`
          )
        }
      }
    }
    addTables(tables, feature.schema ?? {})
  }
  if (features.some((feature) => Object.keys(feature.on ?? {}).length > 0)) {
    addTables(tables, eventTables)
  }
  return tables
}
