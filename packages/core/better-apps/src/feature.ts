import type { ActionDefinition } from "./action.js"
import type { EventDefinition, EventHandler } from "./events.js"
import type { FeatureSchema } from "./schema.js"
import type { SubjectDefinition } from "./subjects.js"

/** An app feature, such as comments or audit history: its tables, actions and events. */
export interface BetterAppsFeature {
  /** Unique feature identifier, such as `comments`. It names the feature's actions in `app.api` and the handler's URLs. */
  id: string
  /** Tables the feature stores. Omit it for features that keep no data in the database. */
  schema?: FeatureSchema | undefined
  /** Server functions, keyed by name. Declare each with `defineAction` to keep its types. */
  actions?: Readonly<Record<string, ActionDefinition>> | undefined
  /** Events the feature emits, keyed by type, such as `comment.created`. Declare each with `defineEvent`. */
  events?: Readonly<Record<string, EventDefinition>> | undefined
  /** Handlers for other features' events, keyed by the emitting feature's id, then the event type. */
  on?: Readonly<Record<string, Readonly<Record<string, EventHandler>>>> | undefined
  /**
   * Subject types for the feature's own records, keyed by name, such as `comments.comment`, so other features can
   * attach to them with the same access rules.
   */
  subjects?: Readonly<Record<string, SubjectDefinition>> | undefined
  /** Subject types the feature works with. Creating the app fails when neither the app nor a feature declares one. */
  usesSubjects?: readonly string[] | undefined
  /** The feature's configuration, kept for inference and for other features to read. */
  options?: unknown
}

/** Declares a feature and keeps its literal types for inference. */
export function defineFeature<const Feature extends BetterAppsFeature>(feature: Feature): Feature {
  return feature
}
