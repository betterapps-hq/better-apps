import type { DatabaseAdapter } from "./database.js"
import type { Actor, Author, Identity } from "./identity.js"
import type { InferSchemaInput, InferSchemaOutput, StandardSchemaV1 } from "./standard-schema.js"
import type { Subjects } from "./subjects.js"

/** What an action handler receives. */
export interface ActionContext<Input> {
  /** The input, after the action's schema has checked it. */
  input: Input
  /** The app's database. A `batch` also writes the events the action has emitted so far, so they commit together. */
  db: DatabaseAdapter
  /** The user the call acts for, or `null` when nobody is signed in. */
  actor: Actor | null
  /** Who the call's writes are attributed to: the actor, or an author server code names. `null` without either. */
  author: Author | null
  identity: Identity
  /** Who can see the app's subjects, for checking access to what the action attaches to. */
  subjects: Subjects
  /** When the call counts as happening: now, or the original time server code passes as `createdAt` for an import. */
  now: Date
  /** Whether server code asked for the call's events to be marked silent, so notifications skip them. */
  silent: boolean
  /** `http` for a request to `app.handler`, `api` for a call from server code through `app.api`. */
  source: "http" | "api"
  /** The request, for an HTTP call or an `app.api` call that passed one. */
  request: Request | null
  /**
   * Emits one of the feature's events. It's written to the outbox with the action's next `db.batch`, or after the
   * handler returns, and delivered to subscribers once written. Events nobody subscribes to are dropped.
   */
  emit(type: string, data: unknown): void
}

/** A server function a feature exposes, with an optional Standard Schema for its input. */
export interface ActionDefinition<
  Schema extends StandardSchemaV1 | undefined = StandardSchemaV1 | undefined,
  Output = unknown
> {
  /** Checks the input before the handler runs. Without one, the handler receives the input unchecked. */
  input?: Schema
  /** Only server code can call it, through `app.api`; `app.handler` answers as if it didn't exist. */
  serverOnly?: boolean | undefined
  handler(context: ActionContext<ActionInput<Schema>>): Output | Promise<Output>
}

/** What a handler receives as input for a schema: the schema's output, or `unknown` without a schema. */
export type ActionInput<Schema> = [Schema] extends [StandardSchemaV1] ? InferSchemaOutput<Schema> : unknown

/** What a caller passes as input to an action. */
export type CallInput<Action> = Action extends { input?: infer Schema }
  ? [NonNullable<Schema>] extends [never]
    ? unknown
    : NonNullable<Schema> extends StandardSchemaV1
      ? InferSchemaInput<NonNullable<Schema>>
      : unknown
  : unknown

/** What an action returns to its caller. */
export type CallOutput<Action> = Action extends { handler: (...args: never[]) => infer Output }
  ? Awaited<Output>
  : never

/** Declares an action and keeps its input and output types for `app.api` and the client. */
export function defineAction<
  Schema extends StandardSchemaV1 | undefined = undefined,
  Output = unknown,
  const ServerOnly extends boolean = false
>(
  action: ActionDefinition<Schema, Output> & { serverOnly?: ServerOnly | undefined }
): ActionDefinition<Schema, Output> & { serverOnly?: ServerOnly | undefined } {
  return action
}
