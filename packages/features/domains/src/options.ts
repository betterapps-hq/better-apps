import type { Actor } from "better-apps"
import type { DnsResolver } from "./dns.js"
import type { HostnameProvider } from "./provider.js"

/** Subdomains of the app's own zone, such as `acme.yourapp.com`, served by a wildcard record and certificate. */
export interface SubdomainOptions {
  /** The zone subdomains go under, such as `yourapp.com`. */
  zone: string
  /** Labels nobody can take. `defaultReservedSubdomains` by default; spread it to add to it. */
  reserved?: readonly string[] | undefined
  /** The shortest label, from 1 to 63. 3 by default. */
  minLength?: number | undefined
  /** How many subdomains one organization can have. 1 by default. */
  maxPerOrg?: number | undefined
}

/** Domains an organization owns, such as `links.acme.com`, routed and certified by a provider. */
export interface CustomDomainOptions {
  /** The `hostnames` slot, such as `cloudflareHostnames()` or `localHostnames()`. */
  provider: HostnameProvider
}

/** What `canManage` receives. */
export interface ManageArgs {
  actor: Actor
  /** The organization, or `null` in an app without organizations. */
  orgId: string | null
}

/** How domains are set up in an app. At least one of `subdomains` and `custom` is required. */
export interface DomainsOptions {
  subdomains?: SubdomainOptions | undefined
  custom?: CustomDomainOptions | undefined
  /** Looks up the records customers add. `dnsOverHttps()` by default. */
  dns?: DnsResolver | undefined
  /**
   * Who can add, check and remove an organization's domains and choose its primary one. People with the `owner` or
   * `admin` role by default.
   */
  canManage?: ((args: ManageArgs) => boolean | Promise<boolean>) | undefined
  /** How many domains of both kinds one organization can have, from 1 to 100. 10 by default. */
  maxPerOrg?: number | undefined
}

/** The input of `add`: a subdomain label, or a custom hostname. */
export type AddDomainInput =
  | { kind: "subdomain"; label: string; orgId?: string | null | undefined }
  | { kind: "custom"; hostname: string; orgId?: string | null | undefined }

/** The input of actions on one domain. `orgId` is for trusted server code only. */
export interface DomainInput {
  domainId: string
  orgId?: string | null | undefined
}

/** The input of `setPrimary`. `null` leaves the organization without a primary domain. */
export interface SetPrimaryInput {
  domainId: string | null
  orgId?: string | null | undefined
}
