import { getGlobalStartContext, type Register, type RequestServerOptions } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import type { ApiCallOptions, BetterApp, BetterAppsApi, BetterAppsFeature } from "better-apps"
import { createBetterAppsClient, type BetterAppsClient } from "better-apps/client"

/**
 * The request context Start gives server routes and server functions: what the server entry passes to
 * `handler.fetch(request, { context })`, plus what global request middleware adds. It follows the app's `Register`.
 */
export type StartRequestContext = RequestServerOptions<Register, []>["context"]

/** Keeps work running after the response is sent, such as a Cloudflare Worker's `ctx.waitUntil`. */
export type WaitUntil = (promise: Promise<unknown>) => void

/** Options for `createStartBindings`. */
export interface StartBindingsOptions {
  /**
   * Reads the platform's `waitUntil` for a request from Start's request context, so events are delivered after the
   * response is sent. Without it, or when it returns `undefined`, responses and calls wait for delivery.
   */
  waitUntil?: ((context: StartRequestContext) => WaitUntil | undefined) | undefined
}

/** What the Better Apps route reads from a Start server route handler's arguments. */
export interface StartRouteRequest {
  /** The request to the route. */
  request: Request
  /** Start's request context, which `waitUntil` reads. Routes with their own middleware add to it. */
  context?: unknown
}

/** Server route handlers that answer every method with `app.handler`. */
export interface StartRouteHandlers {
  /** Answers a request with any method. */
  ANY(route: StartRouteRequest): Promise<Response>
}

/** An app bound to TanStack Start's current request. */
export interface StartBindings<Features extends readonly BetterAppsFeature[]> {
  /**
   * `app.api`, acting as the user of the request being served. Call it from server functions, which loaders call, and
   * from server routes. Options such as `actor`, `author` and `silent` work as they do on `app.api`.
   */
  api: BetterAppsApi<Features>
  /** Handlers for a catch-all server route at the app's base path, such as `src/routes/api/apps/$.ts`. */
  handlers: StartRouteHandlers
  /**
   * Creates a client for server code that calls the app in process, as the user of the request being served. Feature
   * clients take it, so a server function can fill a feature's store the way the browser would, then send the store's
   * `dehydrate()` to the browser for the server render.
   */
  client(): BetterAppsClient<BetterApp<Features>>
}

type ApiMethod = (input?: unknown, options?: ApiCallOptions) => Promise<unknown>

function currentRequest(): Request | undefined {
  try {
    return getRequest()
  } catch {
    // Start throws outside a request, such as in a script or a scheduled job.
    return undefined
  }
}

function currentContext(): StartRequestContext | undefined {
  try {
    return getGlobalStartContext()
  } catch {
    // Start throws before global request middleware has finished, such as in that middleware.
    return undefined
  }
}

/**
 * Binds an app to TanStack Start: `handlers` serve its actions over HTTP from a server route, and `api` calls them from
 * server code as the user of the request being served, without passing the request by hand.
 */
export function createStartBindings<const Features extends readonly BetterAppsFeature[]>(
  app: BetterApp<Features>,
  options: StartBindingsOptions = {}
): StartBindings<Features> {
  const readWaitUntil = (context: StartRequestContext | undefined) =>
    context === undefined ? undefined : options.waitUntil?.(context)

  // Every call goes through here, so request-scoped behavior has one place to live.
  const call = async (method: ApiMethod, input: unknown, callOptions: ApiCallOptions = {}) => {
    const request = callOptions.request ?? currentRequest()
    if (!request && callOptions.actor === undefined) {
      throw new Error(
        "Better Apps can't find the request being served. Call the bound api while Start serves a request, such as in a server function, or pass an actor."
      )
    }
    const waitUntil = callOptions.waitUntil ?? (options.waitUntil ? readWaitUntil(currentContext()) : undefined)
    return method(input, { ...callOptions, request, waitUntil })
  }

  const api: Record<string, Record<string, ApiMethod>> = {}
  for (const [featureId, methods] of Object.entries(app.api as Record<string, Record<string, ApiMethod>>)) {
    api[featureId] = Object.fromEntries(
      Object.entries(methods).map(([name, method]) => [
        name,
        (input?: unknown, callOptions?: ApiCallOptions) => call(method, input, callOptions)
      ])
    )
  }

  // Calls go to app.handler with the served request's headers, so the identity adapter reads the same cookies and
  // tokens. Only the body's own headers are replaced.
  const client = () => {
    const request = currentRequest()
    if (!request) {
      throw new Error(
        "Better Apps can't find the request being served. Create the client while Start serves a request, such as in a server function."
      )
    }
    return createBetterAppsClient<BetterApp<Features>>({
      basePath: app.options.basePath,
      fetch: (url, init) => {
        const headers = new Headers(request.headers)
        for (const name of ["content-length", "content-encoding", "transfer-encoding"]) {
          headers.delete(name)
        }
        new Headers(init.headers).forEach((value, name) => headers.set(name, value))
        const call = new Request(new URL(url, request.url), { method: init.method, headers, body: init.body })
        return app.handler(call, { waitUntil: options.waitUntil ? readWaitUntil(currentContext()) : undefined })
      }
    })
  }

  return {
    api: api as BetterAppsApi<Features>,
    handlers: {
      ANY: ({ request, context }) =>
        app.handler(request, { waitUntil: readWaitUntil(context as StartRequestContext | undefined) })
    },
    client
  }
}
