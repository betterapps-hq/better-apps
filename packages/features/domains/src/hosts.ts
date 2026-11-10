// Which organization a host serves, and the origin of an organization's domain, for features that serve customers'
// domains, such as short links' `hosts`.
import type { Domain, HostnameMatch } from "./feature.js"
import { isWithin, normalizeHostname } from "./hostname.js"

/** The domains calls `domainHosts` makes: `app.api.domains`, which exists only once the app is created. */
export interface DomainHostsApi {
  /** The domain holding a hostname. */
  lookup(input: { hostname: string }): Promise<HostnameMatch | null>
  /** An organization's primary domain. */
  getPrimary(input: { orgId: string | null }): Promise<Domain | null>
}

/** What `domainHosts` takes. */
export interface DomainHostsOptions {
  /**
   * The app's own URL, such as `https://app.yourapp.com`. Its hostname is the app's, and domains' origins use its scheme
   * and port.
   */
  url: string | URL
  /** More hostnames that are the app's own, such as `localhost` beside `127.0.0.1`. */
  hostnames?: readonly string[] | undefined
  /**
   * For local development with `localHostnames()` only. Browsers can't reach a custom domain such as `go.acme.com` on
   * your machine, but they send every name under `localhost` to it, so the app answers a custom domain at
   * `{hostname}.{localSuffix}`, such as `go.acme.com.yourapp.localhost`, and shares its links there. Subdomains are
   * reachable as they are. A name under `localhost`, such as `yourapp.localhost`.
   */
  localSuffix?: string | undefined
}

/**
 * Whose host it is: `"app"` for the app's own host and for a ready domain in an app without organizations, `{ orgId }`
 * for an organization's ready domain, or `null` for any other host.
 */
export type HostOwner = "app" | { orgId: string } | null

/** What `domainHosts` returns. */
export interface DomainHosts {
  /** Pass as short links' `hosts`. Each call throws until `connect` runs. */
  hosts: {
    /** Whose links a host opens. */
    resolve: (args: { hostname: string }) => Promise<HostOwner>
    /** The origin of an organization's primary domain once it's `active`, or `null` for the app's own. */
    origin: (args: { orgId: string | null }) => Promise<string | null>
  }
  /** Connects `app.api.domains` once the app is created, since features are created before it. */
  connect: (api: DomainHostsApi) => void
}

/**
 * Hosts for a feature that serves organizations' domains, such as short links. The app's own hostnames are the app's,
 * an organization's `active` domain is the organization's, and every other host, such as a pending domain, is nobody's.
 * An organization's links are shared on its primary domain once it's `active`.
 *
 * Features are created before the app, so the app calls `connect(app.api.domains)` once it exists.
 */
export function domainHosts(options: DomainHostsOptions): DomainHosts {
  const url = new URL(options.url)
  const appHostnames = new Set(
    [url.hostname, ...(options.hostnames ?? [])].map((hostname) => normalizeHostname(hostname) ?? hostname)
  )
  const suffix = options.localSuffix === undefined ? null : normalizeHostname(options.localSuffix)
  if (options.localSuffix !== undefined && (suffix === null || !isWithin(suffix, "localhost"))) {
    throw new Error(
      "`localSuffix` is for local development: use a name under `localhost`, such as `yourapp.localhost`."
    )
  }
  const port = url.port ? `:${url.port}` : ""
  let connected: DomainHostsApi | undefined

  const api = (): DomainHostsApi => {
    if (!connected) {
      throw new Error("Domain hosts aren't connected yet. Call `connect(app.api.domains)` once the app is created.")
    }
    return connected
  }

  /** The domain a host reaches: a custom domain only through its alias while `localSuffix` is set. */
  const match = async (hostname: string): Promise<HostnameMatch | null> => {
    if (suffix === null) {
      return api().lookup({ hostname })
    }
    if (hostname.endsWith(`.${suffix}`)) {
      const aliased = hostname.slice(0, -suffix.length - 1)
      // A custom hostname has at least two labels, so a subdomain of a zone under the suffix needs no lookup here.
      const found = aliased.includes(".") ? await api().lookup({ hostname: aliased }) : null
      if (found?.kind === "custom") {
        return found
      }
    }
    const found = await api().lookup({ hostname })
    return found?.kind === "custom" ? null : found
  }

  return {
    hosts: {
      resolve: async ({ hostname }) => {
        const host = hostname.toLowerCase()
        if (appHostnames.has(host)) {
          return "app"
        }
        const found = await match(host)
        if (!found?.verified) {
          return null
        }
        return found.orgId === null ? "app" : { orgId: found.orgId }
      },
      origin: async ({ orgId }) => {
        const primary = await api().getPrimary({ orgId })
        if (primary?.status !== "active") {
          return null
        }
        const hostname =
          suffix !== null && primary.kind === "custom" ? `${primary.hostname}.${suffix}` : primary.hostname
        return `${url.protocol}//${hostname}${port}`
      }
    },
    connect: (domains) => {
      connected = domains
    }
  }
}
