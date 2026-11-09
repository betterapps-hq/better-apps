// Checking a custom domain with its provider and the DNS, and when to check it next. The provider and DNS calls are
// here; the decisions they feed are plain functions.
import { isRecordFound, type DnsResolver } from "./dns.js"
import { DomainsError } from "./errors.js"
import { HostnameProviderError, type HostnameProvider, type ProviderHostname } from "./provider.js"
import type { CertificateStatus, CheckedRecord, DomainRow, DomainStatus } from "./schema.js"

/** Minutes from each scheduled check to the next, by how many have run; the last one repeats. */
export const checkScheduleMinutes: readonly number[] = [1, 2, 5, 10, 15, 30, 60, 120, 240]

/** How long a pending domain is checked on a schedule before it fails, as the provider stops validating it too. */
export const checkWindowMs = 7 * 24 * 60 * 60_000

/** How soon after a domain's last check `check` may check it again. */
export const checkCooldownMs = 10_000

/** When the scheduled check after `attempts` checks is due. */
export function nextCheckAt(attempts: number, from: Date): Date {
  const minutes = checkScheduleMinutes[Math.min(attempts, checkScheduleMinutes.length - 1)] as number
  return new Date(from.getTime() + minutes * 60_000)
}

/** What a check found, to save on the domain. */
export interface Inspection {
  providerId: string | null
  status: DomainStatus
  certificate: CertificateStatus
  records: CheckedRecord[]
  error: string | null
}

const providerCodes = {
  INVALID_HOSTNAME: "INVALID_INPUT",
  QUOTA_EXCEEDED: "LIMIT_EXCEEDED",
  UNAVAILABLE: "PROVIDER_ERROR"
} as const

/**
 * Runs a provider call, turning what the provider reports on purpose into a `DomainsError` for the person, and leaving
 * any other error, such as a bad API token, for the app's `onError`.
 */
export async function fromProvider<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (caught) {
    if (caught instanceof HostnameProviderError) {
      throw new DomainsError(providerCodes[caught.code], caught.message, { cause: caught })
    }
    throw caught
  }
}

/** Why a domain isn't ready yet, in words for the person who added it, or `null` when it is. */
function describe(state: ProviderHostname, records: readonly CheckedRecord[], status: DomainStatus): string | null {
  if (status === "active") {
    return null
  }
  if (status === "failed") {
    return state.errors[0] ?? "The provider won't serve this domain."
  }
  const routing = records.find((record) => record.purpose === "routing")
  if (routing?.found === null) {
    return "We couldn't look up this domain's DNS records. We'll try again soon."
  }
  if (routing && !routing.found) {
    return `Add a CNAME record for ${routing.name} that points to ${routing.value}.`
  }
  // The provider's own errors are left out here: once the CNAME is found, ones such as "does not CNAME to this zone"
  // are older than the check.
  if (state.status !== "active") {
    return "The CNAME record is in place. Waiting for the provider to verify the domain."
  }
  if (state.certificate === "failed") {
    return state.errors[0] ?? "The certificate couldn't be issued. We asked for it again."
  }
  return "The domain is verified. Its certificate is being issued, which can take a few minutes."
}

/** A domain is ready once the provider serves the hostname with its certificate and the CNAME record is found. */
function statusOf(state: ProviderHostname, routed: boolean): DomainStatus {
  if (state.status === "blocked") {
    return "failed"
  }
  return state.status === "active" && state.certificate === "active" && routed ? "active" : "pending"
}

/** Looks up a provider hostname's records and says where the domain stands. */
export async function evaluate(dns: DnsResolver, state: ProviderHostname): Promise<Inspection> {
  const records = await Promise.all(
    state.records.map(async (record): Promise<CheckedRecord> => ({
      ...record,
      found: await isRecordFound(dns, record)
    }))
  )
  const routed = records.some((record) => record.purpose === "routing" && record.found === true)
  const status = statusOf(state, routed)
  return {
    providerId: state.id,
    status,
    certificate: state.certificate,
    records,
    error: describe(state, records, status)
  }
}

/**
 * Checks a custom domain: reads it from the provider, creating it when the provider doesn't have it, and restarts the
 * provider's validation when it moved or its certificate failed, then looks up its records.
 */
export async function inspect(provider: HostnameProvider, dns: DnsResolver, row: DomainRow): Promise<Inspection> {
  return fromProvider(async () => {
    let state = row.providerId === null ? null : await provider.get(row.providerId)
    state ??= await provider.create(row.hostname)
    if (state.status === "moved" || state.certificate === "failed") {
      state = await provider.refresh(state.id)
    }
    return evaluate(dns, state)
  })
}

/** The error a domain gets when its schedule of checks ran out. */
export const expiredError = "We stopped checking after 7 days. Fix the records, then check again."
