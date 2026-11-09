import type { DatabaseAdapter } from "./database.js"
import type { Actor, Identity } from "./identity.js"
import type { Subjects } from "./subjects.js"

/** The methods a route answers. `GET` routes also answer `HEAD`. */
export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

/** What a route handler receives. */
export interface RouteContext {
  request: Request
  /** The request's URL, parsed, such as for its host. */
  url: URL
  /** The path's parameters, such as `code` for `/s/:code`, decoded. */
  params: Readonly<Record<string, string>>
  db: DatabaseAdapter
  identity: Identity
  /** Who can see the app's subjects. Pass the request to its checks for the person making it, so grants count. */
  subjects: Subjects
  now: Date
  /** The signed-in user, read from the request the first time it's called, or `null` when nobody is signed in. */
  getActor(): Promise<Actor | null>
  /**
   * Keeps work running after the response is sent, such as recording a click. Without the platform's `waitUntil`, the
   * response waits for it. A failure goes to the app's `onError` and never changes the response.
   */
  waitUntil(promise: Promise<unknown>): void
}

/**
 * A public page or endpoint a feature serves besides its actions, such as a short link's redirect or a file upload. Its
 * handler gets the request as it arrived, body unread, and its response goes out as it is.
 */
export interface RouteDefinition {
  /**
   * The path it answers, from the site's root, such as `/s/:code`. A segment that starts with `:` matches any one
   * segment and reaches the handler in `params`. It may sit under the app's `basePath`, such as
   * `/api/apps/attachments/files/:fileId/:name`, when it can't match an action's URL: any number of segments below
   * `basePath` but two.
   */
  path: string
  method: RouteMethod
  handler(context: RouteContext): Response | Promise<Response>
}

/** Declares a route. */
export function defineRoute(route: RouteDefinition): RouteDefinition {
  return route
}

/** A route ready to match: its segments, literal or a parameter's name. */
export interface CompiledRoute<Owner> {
  owner: Owner
  name: string
  route: RouteDefinition
  segments: readonly Segment[]
}

type Segment = { literal: string } | { param: string }

const paramName = /^[A-Za-z_]\w*$/
const literalSegment = /^[\w\-.~!$&'()*+,;=@]+$/

/** Splits a route's path into segments, or throws when the path can't be matched. */
function compile(path: string, where: string): Segment[] {
  if (!path.startsWith("/") || path === "/") {
    throw new Error(`${where} has the path "${path}", which must start with / and name at least one segment.`)
  }
  const params = new Set<string>()
  return path
    .slice(1)
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        const name = segment.slice(1)
        if (!paramName.test(name) || params.has(name)) {
          throw new Error(`${where} has the path "${path}", whose parameter "${segment}" isn't a valid, unique name.`)
        }
        params.add(name)
        return { param: name }
      }
      if (!literalSegment.test(segment)) {
        throw new Error(`${where} has the path "${path}", with an empty or unescaped segment.`)
      }
      return { literal: segment }
    })
}

/** The shape two routes collide on: their method and segments, with every parameter alike. */
const shapeOf = (method: string, segments: readonly Segment[]) =>
  JSON.stringify([method, segments.map((segment) => ("literal" in segment ? segment.literal : null))])

/** Whether a route could match an action's URL, `{basePath}/{feature}/{action}`, and so hide it or be hidden. */
function overlapsActions(segments: readonly Segment[], basePath: string): boolean {
  const base = basePath === "" ? [] : basePath.slice(1).split("/")
  return (
    segments.length === base.length + 2 &&
    base.every((part, index) => {
      const segment = segments[index] as Segment
      return !("literal" in segment) || segment.literal === part
    })
  )
}

/**
 * Compiles routes so the most literal match wins: segments are compared in order, and a literal beats a parameter.
 * Throws for a malformed path, a path that could match an action's URL, or two routes with the same method and shape.
 */
export function compileRoutes<Owner>(
  routes: readonly { owner: Owner; ownerId: string; name: string; route: RouteDefinition }[],
  basePath: string
): CompiledRoute<Owner>[] {
  const shapes = new Map<string, string>()
  const compiled = routes.map(({ owner, ownerId, name, route }) => {
    const where = `The "${ownerId}" route "${name}"`
    const named = `the "${ownerId}" route "${name}"`
    const segments = compile(route.path, where)
    if (overlapsActions(segments, basePath)) {
      throw new Error(`${where} could match an action's URL under the app's base path, "${basePath || "/"}".`)
    }
    const shape = shapeOf(route.method, segments)
    const taken = shapes.get(shape)
    if (taken) {
      throw new Error(`${where} has the same method and path as ${taken}.`)
    }
    shapes.set(shape, named)
    return { owner, name, route, segments }
  })
  const rank = (route: CompiledRoute<Owner>) => route.segments.map((segment) => ("literal" in segment ? 0 : 1)).join("")
  return compiled.sort((a, b) => rank(a).localeCompare(rank(b)))
}

/** What matching a path found: a route for the method, or only the methods the path allows. */
export type RouteMatch<Owner> =
  | { found: CompiledRoute<Owner>; params: Record<string, string> }
  | { found: null; allowed: RouteMethod[] }

/** Finds the route for a request's method and path. `HEAD` matches `GET` routes. */
export function matchRoute<Owner>(
  routes: readonly CompiledRoute<Owner>[],
  method: string,
  pathname: string
): RouteMatch<Owner> {
  const parts = pathname.slice(1).split("/")
  const allowed: RouteMethod[] = []
  for (const compiled of routes) {
    const params = paramsOf(compiled.segments, parts)
    if (!params) {
      continue
    }
    if (compiled.route.method === method || (method === "HEAD" && compiled.route.method === "GET")) {
      return { found: compiled, params }
    }
    allowed.push(compiled.route.method)
  }
  return { found: null, allowed }
}

function paramsOf(segments: readonly Segment[], parts: readonly string[]): Record<string, string> | null {
  if (segments.length !== parts.length) {
    return null
  }
  const params: Record<string, string> = {}
  for (const [index, segment] of segments.entries()) {
    const part = parts[index] as string
    if ("literal" in segment) {
      if (segment.literal !== part) {
        return null
      }
      continue
    }
    if (part === "") {
      return null
    }
    try {
      params[segment.param] = decodeURIComponent(part)
    } catch {
      // A malformed escape can't name anything.
      return null
    }
  }
  return params
}
