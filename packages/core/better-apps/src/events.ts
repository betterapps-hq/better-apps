import type { DatabaseAdapter } from "./database.js"
import type { Actor, Author, Identity } from "./identity.js"
import type { FeatureSchema } from "./schema.js"
import type { Subjects } from "./subjects.js"

/** An event as subscribers receive it. */
export interface BetterAppsEvent<Data = unknown> {
  /** Unique per event, so a subscriber can skip one it has already handled, since delivery is at least once. */
  id: string
  /** The feature that emitted it. */
  feature: string
  type: string
  data: Data
  actor: Actor | null
  author: Author | null
  /** Whether server code marked the change silent, so notifications skip it. */
  silent: boolean
  createdAt: Date
}

/** Declares an event a feature emits. The type parameter types its data in `app.$Infer.Events`. */
export interface EventDefinition<Data = unknown> {
  /** Carries the data type only; it's never set. */
  readonly "~data"?: Data | undefined
}

/** Declares an event with the type of its data. */
export function defineEvent<Data = unknown>(): EventDefinition<Data> {
  return {}
}

/** What an event subscriber receives besides the event. */
export interface EventContext {
  /** The app's database. A `batch` also writes the events the subscriber has emitted so far. */
  db: DatabaseAdapter
  identity: Identity
  /** Who can see the app's subjects, such as for checking who an event may reach. */
  subjects: Subjects
  /** Emits one of the subscribing feature's own events, delivered after this one. */
  emit(type: string, data: unknown): void
}

/** Handles another feature's event. Throwing leaves the event in the outbox to be retried. */
export type EventHandler = {
  // A method, so a subscriber may type the event's data more narrowly than `unknown`.
  handle(event: BetterAppsEvent, context: EventContext): void | Promise<void>
}["handle"]

/** The model of the core's outbox table, which holds events until every subscriber has handled them. */
export const eventModel = "betterAppsEvent"

/** The outbox table. It's generated with the features' tables when any feature subscribes to events. */
export const eventTables: FeatureSchema = {
  [eventModel]: {
    fields: {
      feature: { type: "string", required: true },
      type: { type: "string", required: true },
      data: { type: "json", required: false },
      actor: { type: "json", required: false },
      author: { type: "json", required: false },
      silent: { type: "boolean", required: true, defaultValue: false },
      createdAt: { type: "date", required: true },
      /** When the event can next be delivered: when it's written, then after each attempt's lease or backoff. */
      availableAt: { type: "date", required: true },
      attempts: { type: "number", required: true, defaultValue: 0 },
      lastError: { type: "string", required: false }
    },
    indexes: [{ fields: ["availableAt"] }]
  }
}
