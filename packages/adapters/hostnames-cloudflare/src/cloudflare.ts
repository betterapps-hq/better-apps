import {
  HostnameProviderError,
  type DnsRecord,
  type HostnameProvider,
  type ProviderHostname
} from "@better-apps/domains"
import Cloudflare, { APIConnectionError, APIError } from "cloudflare"

/** What `cloudflareHostnames` takes. */
export interface CloudflareHostnamesOptions {
  /**
   * An API token with **SSL and Certificates: Edit** on the zone. Pass `client` instead to share a client, such as one
   * with its own retries.
   */
  apiToken?: string | undefined
  client?: Cloudflare | undefined
  /** The id of the SaaS zone, the one Cloudflare for SaaS is enabled on. */
  zoneId: string
  /** The CNAME target customers point their hostname at, such as `customers.yourapp.com`. */
  target: string
  /**
   * How Cloudflare validates certificates. `http`, the default, needs only the CNAME record. `txt` adds a TXT record
   * per certificate, for customers who want the certificate before traffic moves.
   */
  certificateValidation?: "http" | "txt" | undefined
}

type CustomHostname = Awaited<ReturnType<Cloudflare["customHostnames"]["get"]>>

const activeStatuses = new Set(["active", "active_redeploying", "test_active", "test_active_apex"])
const blockedStatuses = new Set(["blocked", "pending_blocked", "test_blocked", "test_failed"])
const movedStatuses = new Set(["moved", "deleted", "pending_deletion"])
const activeCertificates = new Set(["active", "pending_expiration"])
const failedCertificates = new Set([
  "expired",
  "deleted",
  "inactive",
  "deactivating",
  "initializing_timed_out",
  "validation_timed_out",
  "issuance_timed_out",
  "deployment_timed_out",
  "deletion_timed_out"
])

/** Cloudflare's error codes for custom hostnames that domains acts on. */
const errorCodes = { quotaExceeded: 1405, duplicate: 1406, notFound: 1436 } as const

function status(hostname: CustomHostname): ProviderHostname["status"] {
  const value = hostname.status ?? "pending"
  if (activeStatuses.has(value)) {
    return "active"
  }
  if (blockedStatuses.has(value)) {
    return "blocked"
  }
  return movedStatuses.has(value) ? "moved" : "pending"
}

function certificate(hostname: CustomHostname): ProviderHostname["certificate"] {
  const value = hostname.ssl?.status ?? "initializing"
  if (activeCertificates.has(value)) {
    return "active"
  }
  return failedCertificates.has(value) ? "failed" : "pending"
}

/** Turns Cloudflare's custom hostname into what domains stores: the CNAME first, then any TXT records still needed. */
function toProviderHostname(hostname: CustomHostname, target: string): ProviderHostname {
  const records: DnsRecord[] = [{ type: "CNAME", name: hostname.hostname, value: target, purpose: "routing" }]
  const hostnameStatus = status(hostname)
  const ownership = hostname.ownership_verification
  if (hostnameStatus !== "active" && ownership?.name && ownership.value) {
    records.push({ type: "TXT", name: ownership.name, value: ownership.value, purpose: "ownership" })
  }
  const certificateStatus = certificate(hostname)
  if (certificateStatus !== "active") {
    for (const record of hostname.ssl?.validation_records ?? []) {
      if (record.txt_name && record.txt_value) {
        records.push({ type: "TXT", name: record.txt_name, value: record.txt_value, purpose: "certificate" })
      }
    }
  }
  const errors = [
    ...(hostname.verification_errors ?? []),
    ...(hostname.ssl?.validation_errors ?? []).flatMap((error) => (error.message ? [error.message] : []))
  ]
  return {
    id: hostname.id,
    hostname: hostname.hostname,
    status: hostnameStatus,
    certificate: certificateStatus,
    records,
    errors
  }
}

const hasCode = (error: APIError, code: number) => error.errors.some((entry) => entry.code === code)

const messageOf = (error: APIError) => error.errors.find((entry) => entry.message)?.message ?? error.message

/**
 * Turns Cloudflare's errors into what a person can act on: unreachable, rate limited or failing as `UNAVAILABLE`, out
 * of custom hostnames as `QUOTA_EXCEEDED`, and a hostname it refuses as `INVALID_HOSTNAME`. Others, such as a token
 * without permission, are thrown as they are, for the app's operators.
 */
function translate(error: unknown): unknown {
  if (error instanceof APIConnectionError) {
    return new HostnameProviderError("UNAVAILABLE", "Couldn't reach Cloudflare. Try again in a moment.", {
      cause: error
    })
  }
  if (!(error instanceof APIError)) {
    return error
  }
  if (hasCode(error, errorCodes.quotaExceeded)) {
    return new HostnameProviderError("QUOTA_EXCEEDED", "The app can't add more custom domains right now.", {
      cause: error
    })
  }
  const statusCode = error.status ?? 0
  if (statusCode === 429 || statusCode >= 500) {
    return new HostnameProviderError("UNAVAILABLE", "Cloudflare is busy. Try again in a moment.", { cause: error })
  }
  if (statusCode === 400 || statusCode === 409 || statusCode === 422) {
    return new HostnameProviderError("INVALID_HOSTNAME", messageOf(error), { cause: error })
  }
  return error
}

const isNotFound = (error: unknown) =>
  error instanceof APIError && (error.status === 404 || hasCode(error, errorCodes.notFound))

/**
 * The `hostnames` provider for Cloudflare for SaaS: custom domains become custom hostnames on the SaaS zone, with
 * certificates Cloudflare issues. The zone needs Cloudflare for SaaS, a fallback origin and the CNAME target set up
 * once; see the domains spec.
 */
export function cloudflareHostnames(options: CloudflareHostnamesOptions): HostnameProvider {
  const client = options.client ?? new Cloudflare({ apiToken: options.apiToken })
  const { zoneId, target } = options
  const ssl = { method: options.certificateValidation ?? "http", type: "dv" } as const
  const map = (hostname: CustomHostname) => toProviderHostname(hostname, target)

  const call = async <Result>(run: () => Promise<Result>): Promise<Result> => {
    try {
      return await run()
    } catch (caught) {
      throw translate(caught)
    }
  }

  const find = async (hostname: string) => {
    const page = await client.customHostnames.list({ zone_id: zoneId, hostname: { exact: hostname } })
    return page.result.find((entry) => entry.hostname === hostname) ?? null
  }

  return {
    async create(hostname) {
      try {
        return map(await client.customHostnames.create({ zone_id: zoneId, hostname, ssl }))
      } catch (caught) {
        // Cloudflare already has it, such as from an add that crashed before saving its id: use that one.
        if (caught instanceof APIError && hasCode(caught, errorCodes.duplicate)) {
          const existing = await call(() => find(hostname))
          if (existing) {
            return map(existing)
          }
        }
        throw translate(caught)
      }
    },
    async get(id) {
      try {
        return map(await client.customHostnames.get(id, { zone_id: zoneId }))
      } catch (caught) {
        if (isNotFound(caught)) {
          return null
        }
        throw translate(caught)
      }
    },
    async refresh(id) {
      // Editing a hostname with the same `ssl` restarts validation of the hostname and its certificate.
      return call(async () => map(await client.customHostnames.edit(id, { zone_id: zoneId, ssl })))
    },
    async remove(id) {
      try {
        await client.customHostnames.delete(id, { zone_id: zoneId })
      } catch (caught) {
        if (!isNotFound(caught)) {
          throw translate(caught)
        }
      }
    }
  }
}
