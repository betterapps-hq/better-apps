import type { FeatureSchema } from "./schema.js"

/** An app feature, such as comments or audit history, and the tables it stores. */
export interface BetterAppsFeature {
  /** Unique feature identifier, such as `comments`. */
  id: string
  /** Tables the feature stores. Omit it for features that keep no data in the database. */
  schema?: FeatureSchema | undefined
}

/** Declares a feature and keeps its literal types for inference. */
export function defineFeature<const Feature extends BetterAppsFeature>(feature: Feature): Feature {
  return feature
}
