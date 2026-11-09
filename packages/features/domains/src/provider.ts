// The `hostnames` slot: what a provider that routes custom domains and issues their certificates implements, such as
// `@better-apps/hostnames-cloudflare`.

/** Why a customer adds a record: to route traffic, to prove they own the hostname, or to validate its certificate. */
export type RecordPurpose = "routing" | "ownership" | "certificate"

/** A DNS record a customer adds at their DNS provider. */
export interface DnsRecord {
  type: "CNAME" | "TXT"
  /** The full name, such as `links.acme.com` or `_cf-custom-hostname.links.acme.com`. */
  name: string
  value: string
  purpose: RecordPurpose
}

/**
 * A hostname as the provider sees it. `moved` means it was validated once but no longer points at the app, or wasn't
 * validated in time; `blocked` means the provider won't serve it.
 */
export interface ProviderHostname {
  /** The provider's id, stored on the domain. */
  id: string
  hostname: string
  status: "pending" | "active" | "moved" | "blocked"
  certificate: "pending" | "active" | "failed"
  /** The records the customer adds, the routing record first. */
  records: DnsRecord[]
  /** Why it isn't ready yet, in the provider's words. */
  errors: string[]
}

/** Routes custom domains to the app and issues their certificates. */
export interface HostnameProvider {
  /** Registers a hostname. A hostname the provider already has is returned as it is, so this is safe to repeat. */
  create(hostname: string): Promise<ProviderHostname>
  /** Reads a hostname, or `null` when the provider doesn't have it. */
  get(id: string): Promise<ProviderHostname | null>
  /** Restarts validation of the hostname and its certificate, such as after the customer fixed a record. */
  refresh(id: string): Promise<ProviderHostname>
  /** Deletes a hostname and its certificate. A hostname the provider doesn't have counts as deleted. */
  remove(id: string): Promise<void>
}

/**
 * What a provider reports that a person can act on: a hostname it refuses, a quota it's out of, or that it's
 * unavailable for now, such as rate limited or down. Any other error is the app's to fix, such as a bad API token.
 */
export type HostnameProviderErrorCode = "INVALID_HOSTNAME" | "QUOTA_EXCEEDED" | "UNAVAILABLE"

/** An error a provider throws on purpose, which domains passes on to the person adding or checking a domain. */
export class HostnameProviderError extends Error {
  readonly code: HostnameProviderErrorCode

  constructor(code: HostnameProviderErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.name = "HostnameProviderError"
    this.code = code
  }
}
