import type { ActionDefinition, CallInput, CallOutput } from "./action.js"
import { createDatabaseAdapter, type DatabaseAdapter } from "./database.js"
import { BetterAppsError } from "./errors.js"
import type { BetterAppsEvent, EventDefinition } from "./events.js"
import type { BetterAppsFeature } from "./feature.js"
import type { Actor, Author, Identity } from "./identity.js"
import type { BetterAppsOptions } from "./options.js"
import { createOutbox, type DeliverOptions, type DeliveryReport, type ErrorContext } from "./outbox.js"
import type { StandardSchemaV1 } from "./standard-schema.js"
import { createSubjects, type SubjectDefinition, type Subjects } from "./subjects.js"

/** Options for `createBetterApps`. */
export interface CreateBetterAppsOptions<
  Features extends readonly BetterAppsFeature[] = readonly BetterAppsFeature[]
> extends BetterAppsOptions {
  features: Features
  /** Reads the signed-in user, such as `localIdentity()` or a provider's adapter. */
  identity: Identity
  /**
   * The kinds of records features attach things to, such as `invoice`, keyed by name, with who can see them. Features
   * that attach to records check these rules, so each subject type is declared once for all of them.
   */
  subjects?: Readonly<Record<string, SubjectDefinition>> | undefined
  /** The path `app.handler` is mounted on. The default is `/api/apps`. */
  basePath?: string | undefined
  /** The largest request body `app.handler` reads, in bytes. The default is 1 MiB. */
  maxBodySize?: number | undefined
  /**
   * Reports errors no caller sees: unexpected errors in actions called over HTTP, and subscribers that fail. The default
   * logs them with `console.error`. If it throws or rejects, that's logged too, and delivery and the action's result go
   * on as if it hadn't. A promise it returns is handed to the request's, call's or delivery run's `waitUntil` when it has
   * one, so the report isn't cut off on Workers. Otherwise nothing waits for it.
   */
  onError?: ((error: unknown, context: ErrorContext) => void | Promise<void>) | undefined
}

/** Options server code passes to `app.api` calls, which a browser can't send. */
export interface ApiCallOptions {
  /** The request the call serves. The identity adapter reads the actor from it. */
  request?: Request | undefined
  /** The actor to act as, instead of reading one from `request`. `null` acts as a signed-out visitor. */
  actor?: Actor | null | undefined
  /** Attributes the call's writes to someone other than the actor, such as an email sender or a system job. */
  author?: Author | undefined
  /** The original time of an imported change. The default is now. */
  createdAt?: Date | undefined
  /** Marks the call's events silent, so notifications skip them. */
  silent?: boolean | undefined
  /** Keeps event delivery running after the call returns. Without it, the call waits for delivery. */
  waitUntil?: ((promise: Promise<unknown>) => void) | undefined
}

/** The platform hooks `app.handler` uses, such as a Cloudflare Worker's execution context. */
export interface HandlerContext {
  /** Keeps event delivery running after the response is sent. Without it, the response waits for delivery. */
  waitUntil?(promise: Promise<unknown>): void
}

/** An action as `app.api` exposes it. The input is optional when the action accepts `undefined`. */
export type ApiMethod<Input, Output> = undefined extends Input
  ? (input?: Input, options?: ApiCallOptions) => Promise<Output>
  : (input: Input, options?: ApiCallOptions) => Promise<Output>

/** One feature's actions in `app.api`. */
export type FeatureApi<Feature> = Feature extends { actions: infer Actions }
  ? { [Name in keyof Actions]: ApiMethod<CallInput<Actions[Name]>, CallOutput<Actions[Name]>> }
  : Record<never, never>

/** Every feature's actions, keyed by feature id, then action name. */
export type BetterAppsApi<Features extends readonly BetterAppsFeature[]> = {
  [Feature in Features[number] as Feature["id"]]: FeatureApi<Feature>
}

/** The events one feature declares, as subscribers receive them. */
export type FeatureEvent<Feature> = Feature extends { id: infer Id extends string; events: infer Events }
  ? {
      [Type in keyof Events & string]: BetterAppsEvent<
        Events[Type] extends EventDefinition<infer Data> ? Data : unknown
      > & {
        feature: Id
        type: Type
      }
    }[keyof Events & string]
  : never

/** Every event the app's features declare, as subscribers receive them. */
export type BetterAppsEvents<Features extends readonly BetterAppsFeature[]> = FeatureEvent<Features[number]>

/** A running app: its features' actions for server code and over HTTP, and its event outbox. */
export interface BetterApp<Features extends readonly BetterAppsFeature[] = readonly BetterAppsFeature[]> {
  /** Calls actions from server code, typed per feature, with options a browser can't send. */
  api: BetterAppsApi<Features>
  /**
   * Answers `POST {basePath}/{feature}/{action}` with the action's JSON input as the body. Works on any runtime with the
   * Fetch API, such as Cloudflare Workers and Node.
   */
  handler(request: Request, context?: HandlerContext): Promise<Response>
  /** Delivers events left in the outbox by a crash or a failing subscriber. Call it from a scheduled job. */
  deliverEvents(options?: DeliverOptions): Promise<DeliveryReport>
  /** The database adapter, for server code and tests. */
  db: DatabaseAdapter
  /** Who can see the app's subjects, so server code checks access the way features do. */
  subjects: Subjects
  options: CreateBetterAppsOptions<Features>
  /** Types for the client and for subscribers. Use them with `typeof app.$Infer`; the values are empty. */
  $Infer: { Api: BetterAppsApi<Features>; Events: BetterAppsEvents<Features> }
}

interface Call {
  actor: Actor | null
  author: Author | null
  now: Date
  silent: boolean
  source: "http" | "api"
  request: Request | null
  waitUntil: ((promise: Promise<unknown>) => void) | undefined
}

// Feature ids and action names appear in URLs, so they're limited to characters that need no escaping.
const urlSafeName = /^[A-Za-z][\w-]*$/

async function validate(schema: StandardSchemaV1, value: unknown): Promise<unknown> {
  const result = await schema["~standard"].validate(value)
  if (result.issues) {
    throw new BetterAppsError("INVALID_INPUT", "The input isn't valid.", { issues: result.issues })
  }
  return result.value
}

async function readBody(request: Request, limit: number): Promise<string> {
  const tooLarge = () =>
    new BetterAppsError("PAYLOAD_TOO_LARGE", `The request body is larger than ${limit} bytes.`, { status: 413 })
  if (Number(request.headers.get("content-length") ?? 0) > limit) {
    throw tooLarge()
  }
  if (!request.body) {
    return ""
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

function errorResponse(error: BetterAppsError): Response {
  const headers = error.status === 405 ? { allow: "POST" } : undefined
  const body = { error: { code: error.code, message: error.message, ...(error.issues && { issues: error.issues }) } }
  return Response.json(body, { status: error.status, headers })
}

const internalError = () =>
  Response.json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } }, { status: 500 })

/** The subject types the app and its features declare, checked against the ones features use. */
function declareSubjects(options: CreateBetterAppsOptions): Map<string, SubjectDefinition> {
  const declared = new Map(Object.entries(options.subjects ?? {}))
  for (const feature of options.features) {
    for (const [subjectType, subject] of Object.entries(feature.subjects ?? {})) {
      if (declared.has(subjectType)) {
        throw new Error(
          `The "${feature.id}" feature declares the "${subjectType}" subject type, which is already declared.`
        )
      }
      declared.set(subjectType, subject)
    }
  }
  for (const feature of options.features) {
    for (const subjectType of feature.usesSubjects ?? []) {
      if (!declared.has(subjectType)) {
        throw new Error(
          `The "${feature.id}" feature uses the "${subjectType}" subject type, but nothing declares it. Add it to the app's subjects.`
        )
      }
    }
  }
  return declared
}

/** Creates an app from a database adapter, an identity adapter and the features it enables. */
export function createBetterApps<const Features extends readonly BetterAppsFeature[]>(
  options: CreateBetterAppsOptions<Features>
): BetterApp<Features> {
  const { identity, features } = options
  const db = createDatabaseAdapter(options)
  const basePath = `/${(options.basePath ?? "/api/apps").replace(/^\/+|\/+$/g, "")}`.replace(/^\/$/, "")
  const maxBodySize = options.maxBodySize ?? 1024 * 1024
  const report =
    options.onError ??
    ((error: unknown, context: ErrorContext) => {
      const where = [context.feature, context.action ?? context.event?.type].filter(Boolean).join(" ")
      console.error(`Better Apps${where ? ` (${where})` : ""}:`, error)
    })
  // A reporter that fails, such as one using a context that has ended, mustn't stop delivery or replace a result.
  const reportFailed = (reportError: unknown) =>
    console.error("Better Apps: onError failed while reporting an error.", reportError)
  const onError = (error: unknown, context: ErrorContext, waitUntil?: (promise: Promise<unknown>) => void) => {
    let reporting: Promise<void>
    try {
      reporting = Promise.resolve(report(error, context)).catch(reportFailed)
    } catch (reportError) {
      reportFailed(reportError)
      return
    }
    // A report still running after the response is sent would be cut off on Workers, so it's handed to waitUntil.
    try {
      waitUntil?.(reporting)
    } catch {
      // The runtime refused it, such as after its context ended, so the report runs on without it.
    }
  }
  const subjects = createSubjects(declareSubjects(options), { db, identity })
  const outbox = createOutbox({ db, features, identity, subjects, onError })

  const actions = new Map<string, Map<string, { feature: BetterAppsFeature; action: ActionDefinition }>>()
  for (const feature of features) {
    if (!urlSafeName.test(feature.id)) {
      throw new Error(`The feature id "${feature.id}" must start with a letter and use only letters, digits, _ and -.`)
    }
    const byName = new Map<string, { feature: BetterAppsFeature; action: ActionDefinition }>()
    for (const [name, action] of Object.entries(feature.actions ?? {})) {
      if (!urlSafeName.test(name)) {
        throw new Error(
          `The "${feature.id}" action "${name}" must start with a letter and use only letters, digits, _ and -.`
        )
      }
      byName.set(name, { feature, action })
    }
    actions.set(feature.id, byName)
  }

  async function run(feature: BetterAppsFeature, action: ActionDefinition, rawInput: unknown, call: Call) {
    const input = action.input ? await validate(action.input, rawInput) : rawInput
    const events = outbox.track(feature, call)
    try {
      const output = await action.handler({
        input,
        db: events.db,
        actor: call.actor,
        author: call.author,
        identity,
        subjects,
        now: call.now,
        silent: call.silent,
        source: call.source,
        request: call.request,
        emit: events.emit
      })
      await events.flush()
      return output
    } finally {
      // Events written before a failure belong to changes that committed, so they're delivered either way.
      if (events.written.length > 0) {
        const delivery = outbox.deliver(events.written, call.waitUntil)
        let handedOff = false
        if (call.waitUntil) {
          try {
            call.waitUntil(delivery)
            handedOff = true
          } catch (error) {
            // The runtime refused it, such as after its context ended, so the call waits for delivery instead.
            onError(error, { feature: feature.id })
          }
        }
        if (!handedOff) {
          await delivery
        }
      }
    }
  }

  const api: Record<string, Record<string, (input?: unknown, options?: ApiCallOptions) => Promise<unknown>>> = {}
  for (const [featureId, byName] of actions) {
    const methods: (typeof api)[string] = {}
    for (const [name, { feature, action }] of byName) {
      methods[name] = async (input, callOptions = {}) => {
        const { request, actor: given, author, createdAt, silent, waitUntil } = callOptions
        let actor: Actor | null = null
        if (given !== undefined) {
          actor = given
        } else if (request) {
          actor = await identity.getActor(request)
        }
        return run(feature, action, input, {
          actor,
          author: author ?? (actor ? { type: "user", userId: actor.userId } : null),
          now: createdAt ?? new Date(),
          silent: silent ?? false,
          source: "api",
          request: request ?? null,
          waitUntil
        })
      }
    }
    api[featureId] = methods
  }

  async function handler(request: Request, context: HandlerContext = {}): Promise<Response> {
    const { pathname } = new URL(request.url)
    const [featureId, name, ...rest] = pathname.startsWith(`${basePath}/`)
      ? pathname.slice(basePath.length + 1).split("/")
      : []
    const target = featureId && name ? actions.get(featureId)?.get(name) : undefined
    try {
      if (!target || rest.length > 0 || target.action.serverOnly) {
        throw new BetterAppsError("NOT_FOUND", "There is no such action.")
      }
      if (request.method !== "POST") {
        throw new BetterAppsError("METHOD_NOT_ALLOWED", "Actions take POST requests.", { status: 405 })
      }
      // Requiring JSON keeps cross-site forms from calling actions, since browsers preflight JSON requests.
      if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
        throw new BetterAppsError("UNSUPPORTED_MEDIA_TYPE", "Send the input as application/json.", { status: 415 })
      }
      const body = await readBody(request, maxBodySize)
      let input: unknown
      try {
        input = body.trim() === "" ? undefined : JSON.parse(body)
      } catch (error) {
        throw new BetterAppsError("INVALID_INPUT", "The request body isn't valid JSON.", { cause: error })
      }
      const actor = await identity.getActor(request)
      const output = await run(target.feature, target.action, input, {
        actor,
        author: actor ? { type: "user", userId: actor.userId } : null,
        now: new Date(),
        silent: false,
        source: "http",
        request,
        waitUntil: context.waitUntil?.bind(context)
      })
      return Response.json(output ?? null)
    } catch (error) {
      if (error instanceof BetterAppsError) {
        return errorResponse(error)
      }
      onError(error, { feature: featureId, action: name }, context.waitUntil?.bind(context))
      return internalError()
    }
  }

  return {
    api: api as BetterAppsApi<Features>,
    handler,
    deliverEvents: outbox.deliverPending,
    db,
    subjects,
    options,
    $Infer: {} as BetterApp<Features>["$Infer"]
  }
}
