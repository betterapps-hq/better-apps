// The browser half of Better Apps: a framework-free client that calls `app.handler`, typed from the server's features,
// and a small store framework layers bind to. It imports only types from the server code, so bundles stay small.
import type { CallInput, CallOutput } from "./action.js"
import type { BetterApp } from "./app.js"
import type { InputIssue } from "./errors.js"
import type { BetterAppsFeature } from "./feature.js"

/** A value as JSON carries it to the browser: dates become ISO strings. */
export type Serialized<Value> = Value extends Date
  ? string
  : Value extends (...args: never[]) => unknown
    ? never
    : Value extends readonly (infer Item)[]
      ? Serialized<Item>[]
      : Value extends object
        ? { [Key in keyof Value]: Serialized<Value[Key]> }
        : Value

/** An action as the client exposes it. The input is optional when the action accepts `undefined`. */
export type ClientMethod<Input, Output> = undefined extends Input
  ? (input?: Input) => Promise<Serialized<Output>>
  : (input: Input) => Promise<Serialized<Output>>

type IsServerOnly<Action> = Action extends { serverOnly?: infer Flag }
  ? [Exclude<Flag, undefined>] extends [never]
    ? false
    : [Exclude<Flag, undefined>] extends [true]
      ? true
      : false
  : false

/** One feature's actions that browsers can call. Server-only actions are left out. */
export type FeatureClient<Feature> = Feature extends { actions: infer Actions }
  ? {
      [Name in keyof Actions as IsServerOnly<Actions[Name]> extends true ? never : Name]: ClientMethod<
        CallInput<Actions[Name]>,
        CallOutput<Actions[Name]>
      >
    }
  : Record<never, never>

/** Every feature's browser actions, keyed by feature id, then action name. */
export type ClientApi<Features extends readonly BetterAppsFeature[]> = {
  [Feature in Features[number] as Feature["id"]]: FeatureClient<Feature>
}

// Taken from the Fetch API's own types, which Node and browsers share.
type HeadersInit = ConstructorParameters<typeof Headers>[0]

type FeaturesOf<App> = App extends BetterApp<infer Features> ? Features : readonly BetterAppsFeature[]

/** How the client reaches `app.handler`. */
export interface ClientOptions {
  /** The server's origin, such as `https://app.example.com`. The default is the page's own. */
  baseURL?: string | undefined
  /** Where `app.handler` is mounted. The default is `/api/apps`, like the server's. */
  basePath?: string | undefined
  /** A `fetch` to use instead of the global one, such as one that adds a token, or `app.handler` in tests. */
  fetch?: ((input: string, init: RequestInit) => Promise<Response>) | undefined
  /** Headers for every call, or a function that returns them, such as an auth token. */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>) | undefined
  /** Whether calls send cookies. The default is `same-origin`. */
  credentials?: RequestInit["credentials"] | undefined
}

/** A client for an app's actions: `client.<feature>.<action>(input)`. Pass `typeof app` for its types. */
export type BetterAppsClient<App = BetterApp> = ClientApi<FeaturesOf<App>> & {
  /** Calls an action by name, for code that doesn't know the feature's types. */
  $call(feature: string, action: string, input?: unknown): Promise<unknown>
}

/** An error an action call failed with. `code` is the server's, such as `NOT_FOUND`, so a UI can react to it. */
export class BetterAppsClientError extends Error {
  readonly code: string
  readonly status: number
  readonly issues: InputIssue[] | undefined

  constructor(
    code: string,
    message: string,
    options: { status: number; issues?: InputIssue[] | undefined; cause?: unknown }
  ) {
    super(message, { cause: options.cause })
    this.name = "BetterAppsClientError"
    this.code = code
    this.status = options.status
    this.issues = options.issues
  }
}

// Names a proxy must not answer, so the client isn't mistaken for a promise or a React element.
const reserved = new Set(["then", "toJSON", "$$typeof", "constructor"])

function readError(status: number, body: unknown): BetterAppsClientError {
  const error = (body as { error?: { code?: unknown; message?: unknown; issues?: unknown } } | null)?.error
  if (error && typeof error.code === "string") {
    const message = typeof error.message === "string" ? error.message : error.code
    const issues = Array.isArray(error.issues) ? (error.issues as InputIssue[]) : undefined
    return new BetterAppsClientError(error.code, message, { status, issues })
  }
  return new BetterAppsClientError("INTERNAL_ERROR", `The server answered ${status}.`, { status })
}

/**
 * Creates a client that calls the app's actions over HTTP. Outputs arrive as JSON, so dates are ISO strings; feature
 * clients turn the ones they know back into dates.
 */
export function createBetterAppsClient<App = BetterApp>(options: ClientOptions = {}): BetterAppsClient<App> {
  const baseURL = (options.baseURL ?? "").replace(/\/+$/, "")
  const basePath = `/${(options.basePath ?? "/api/apps").replace(/^\/+|\/+$/g, "")}`.replace(/^\/$/, "")
  const call = async (feature: string, action: string, input?: unknown): Promise<unknown> => {
    const headers = new Headers(typeof options.headers === "function" ? await options.headers() : options.headers)
    headers.set("content-type", "application/json")
    const url = `${baseURL}${basePath}/${encodeURIComponent(feature)}/${encodeURIComponent(action)}`
    const init: RequestInit = {
      method: "POST",
      headers,
      body: input === undefined ? "" : JSON.stringify(input),
      credentials: options.credentials ?? "same-origin"
    }
    let response: Response
    try {
      response = await (options.fetch ?? globalThis.fetch)(url, init)
    } catch (error) {
      throw new BetterAppsClientError("NETWORK_ERROR", "The server couldn't be reached.", { status: 0, cause: error })
    }
    const text = await response.text()
    let body: unknown = null
    try {
      body = text === "" ? null : JSON.parse(text)
    } catch (error) {
      if (response.ok) {
        throw new BetterAppsClientError("INTERNAL_ERROR", "The server's answer isn't JSON.", {
          status: response.status,
          cause: error
        })
      }
    }
    if (!response.ok) {
      throw readError(response.status, body)
    }
    return body
  }
  const features = new Map<string, object>()
  const featureProxy = (feature: string) =>
    new Proxy(
      {},
      {
        get: (_, action) =>
          typeof action === "string" && !reserved.has(action)
            ? (input?: unknown) => call(feature, action, input)
            : undefined
      }
    )
  return new Proxy({ $call: call } as object, {
    get: (target, key) => {
      if (key === "$call") {
        return call
      }
      if (typeof key !== "string" || reserved.has(key)) {
        return Reflect.get(target, key)
      }
      let feature = features.get(key)
      if (!feature) {
        feature = featureProxy(key)
        features.set(key, feature)
      }
      return feature
    }
  }) as BetterAppsClient<App>
}

/** State that framework layers bind to: React through `useSyncExternalStore`, others through `subscribe`. */
export interface Store<State> {
  getSnapshot(): State
  /** Calls the listener after each change, and returns a function that stops it. */
  subscribe(listener: () => void): () => void
  /** Replaces the state, or derives it from the current one. Listeners run only when it changes. */
  setState(update: State | ((state: State) => State)): void
}

/** Creates a store. Treat its state as immutable: build a new value for each change. */
export function createStore<State>(initial: State): Store<State> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    setState(update) {
      const next = typeof update === "function" ? (update as (state: State) => State)(state) : update
      if (!Object.is(next, state)) {
        state = next
        // A copy, so a listener that subscribes another doesn't run it in this round.
        for (const listener of Array.from(listeners)) {
          listener()
        }
      }
    }
  }
}
