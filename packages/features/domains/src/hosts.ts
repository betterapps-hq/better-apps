// Which organization a host serves, and the origin of an organization's domain, for features that serve customers'
// domains, such as short links' `hosts`.
import { z } from "zod"
import type { Domain, HostnameMatch } from "./feature.js"
import { isWithin, maxHostnameLength, normalizeHostname } from "./hostname.js"

/** The app's own URL: http or https, with any host, including `127.0.0.1` and `[::1]`. */
const appUrl = z.url({ protocol: /^https?$/ })

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
  /** More hostnames that are the app's own, such as `localhost` beside `127.0.0.1`, without a scheme or port. */
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
    /** Whose links a host opens. The hostname is normalized as `lookup` does, so a port or trailing dot is fine. */
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
  const parsed = appUrl.safeParse(String(options.url))
  if (!parsed.success) {
    throw new Error("`url` is the app's own http or https URL, such as `https://app.yourapp.com`.")
  }
  const url = new URL(parsed.data)
  // Normalized as requests' hosts are, so a trailing dot can't keep the app's own host from matching.
  const appHostnames = new Set([normalizeHostname(url.host, { allowPort: true }) ?? url.hostname])
  for (const entry of options.hostnames ?? []) {
    const hostname = normalizeHostname(entry)
    if (hostname === null) {
      throw new Error(`\`hostnames\` holds "${entry}", which isn't a hostname without a port, such as \`localhost\`.`)
    }
    appHostnames.add(hostname)
  }
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

  /**
   * The domain a host reaches. While `localSuffix` is set, a subdomain answers as it is and a custom domain only at its
   * alias. The host itself is looked up first, so a custom domain's alias never takes a subdomain's place.
   */
  const match = async (hostname: string): Promise<HostnameMatch | null> => {
    const found = await api().lookup({ hostname })
    if (suffix === null) {
      return found
    }
    if (found?.kind === "subdomain") {
      return found
    }
    const aliased = hostname.endsWith(`.${suffix}`) ? hostname.slice(0, -suffix.length - 1) : ""
    // A custom hostname has at least two labels.
    if (!aliased.includes(".")) {
      return null
    }
    const custom = await api().lookup({ hostname: aliased })
    return custom?.kind === "custom" ? custom : null
  }

  return {
    hosts: {
      resolve: async ({ hostname }) => {
        // Normalized as `lookup` does, and a host no domain could hold answers at once.
        const host = normalizeHostname(hostname, { allowPort: true })
        if (host === null || host.length > maxHostnameLength) {
          return null
        }
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
