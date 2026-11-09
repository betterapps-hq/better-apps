// Checking a custom domain with its provider and the DNS, and when to check it next. The provider and DNS calls are
// here; the decisions they feed are plain functions.
import { isRecordFound, type DnsResolver } from "./dns.js"
import { DomainsError } from "./errors.js"
import { HostnameProviderError, type DnsRecord, type HostnameProvider, type ProviderHostname } from "./provider.js"
import type { CheckedRecord, DomainRow, DomainStatus } from "./schema.js"

/** Minutes from each scheduled check of a pending domain to the next, by how many have run; the last one repeats. */
export const checkScheduleMinutes: readonly number[] = [1, 2, 5, 10, 15, 30, 60, 120, 240]

/** How long a pending domain is checked on a schedule before it fails, as the provider stops validating it too. */
export const checkWindowMs = 7 * 24 * 60 * 60_000

/** How soon after a domain's last check `check` may check it again. */
export const checkCooldownMs = 10_000

/** How long after an active custom domain's last check it's checked again. */
export const recheckMs = 24 * 60 * 60_000

/** When the scheduled check of a pending domain after `attempts` checks is due. */
export function nextCheckAt(attempts: number, from: Date): Date {
  const minutes = checkScheduleMinutes[Math.min(attempts, checkScheduleMinutes.length - 1)] as number
  return new Date(from.getTime() + minutes * 60_000)
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

/** The TXT record that proves an organization owns a hostname, with its domain's own token. */
export function ownershipRecord(label: string, hostname: string, token: string): DnsRecord {
  return { type: "TXT", name: `${label}.${hostname}`, value: token, purpose: "ownership" }
}

/** Looks up records with `dns`, saying of each whether the customer added it. */
export async function lookUp(dns: DnsResolver, records: readonly DnsRecord[]): Promise<CheckedRecord[]> {
  return Promise.all(records.map(async (record) => ({ ...record, found: await isRecordFound(dns, record) })))
}

/** Records before their first check. */
export const unchecked = (records: readonly DnsRecord[]): CheckedRecord[] =>
  records.map((record) => ({ ...record, found: null }))

export const lookupError = "We couldn't look up this domain's DNS records. We'll try again soon."

/** The error a domain gets when its schedule of checks ran out. */
export const expiredError = "We stopped checking after 7 days. Fix the records, then check again."

/** The error a domain gets when another organization proved it owns the hostname. */
export const evictedError = "Another organization proved it owns this domain. Check again to prove you still do."

/** The error a domain gets while another organization's ownership record is still in place. */
export const contestedError = (record: string) =>
  `Another organization's TXT record for ${record} is still in place. Remove it, then check again.`

/** What a custom domain needs before anything else: its ownership record, named by `name`. */
export const proveError = (name: string) => `Add the TXT record for ${name} to prove you own the domain.`

/** Why a custom domain whose ownership record wasn't found isn't ready, in words for the person who added it. */
export function ownershipError(records: readonly CheckedRecord[]): string {
  const ownership = records.find((record) => record.purpose === "ownership")
  if (!ownership || ownership.found === null) {
    return lookupError
  }
  return proveError(ownership.name)
}

function routingAdvice(record: CheckedRecord): string {
  return record.type === "CNAME"
    ? `Add a CNAME record for ${record.name} that points to ${record.value}.`
    : `Add an ${record.type} record for ${record.name} with the address ${record.value}.`
}

/** What the provider said of a custom domain's hostname in a check, and what the check asked of it. */
export interface Inspection {
  /** The hostname as the provider reports it, after any restart. */
  state: ProviderHostname
  /** The hostname as the provider reported it before the check restarted its validation, or `null` if it didn't. */
  restartedFrom: ProviderHostname | null
  /** Whether the check registered the hostname with the provider. */
  registered: boolean
}

/**
 * Why a custom domain the organization holds isn't ready yet, in words for the person who added it, or `null` when it
 * is. A ready domain whose certificate renewal stalled is told too, while its current certificate still serves. The
 * provider serving the hostname proves its traffic arrives, even where DNS hides the routing record, such as a CNAME
 * the customer's own Cloudflare zone proxies.
 */
export function describe(
  { state, restartedFrom }: Inspection,
  records: readonly CheckedRecord[],
  status: DomainStatus
): string | null {
  const troubled = [restartedFrom, state].find(
    (entry) => entry?.certificate === "stalled" || entry?.certificate === "failed"
  )
  if (status === "active") {
    return troubled
      ? (troubled.errors[0] ??
          "The certificate couldn't be renewed. We asked for it again, and the current one works until it expires.")
      : null
  }
  if (status === "failed") {
    return state.errors[0] ?? "The provider won't serve this domain."
  }
  if (troubled) {
    return troubled.errors[0] ?? "The certificate couldn't be issued. We asked for it again."
  }
  if (state.status === "active") {
    return "The domain is verified. Its certificate is being issued, which can take a few minutes."
  }
  const routing = records.filter((record) => record.purpose === "routing")
  if (routing.some((record) => record.found === null)) {
    return lookupError
  }
  const missing = routing.find((record) => record.found === false)
  if (missing) {
    return routingAdvice(missing)
  }
  // The provider's own errors are left out here: once the routing records are found, ones such as "does not CNAME to
  // this zone" are older than the check.
  return "The records are in place. Waiting for the provider to verify the domain."
}

/**
 * A domain the organization holds is ready once the provider serves the hostname with its certificate. One that's
 * already `active` stays so while its current certificate still serves: while a new one is being issued, which reports
 * a pending state, and when that stalled, until the current one expires. It doesn't once the certificate failed, such
 * as when it expired, or the hostname moved.
 */
export function statusOf({ state, restartedFrom }: Inspection, active: boolean): DomainStatus {
  if (state.status === "blocked") {
    return "failed"
  }
  if (state.status !== "active") {
    return "pending"
  }
  if (state.certificate === "active") {
    return "active"
  }
  const before = restartedFrom ?? state
  const serves = before.status === "active" && before.certificate !== "failed" && state.certificate !== "failed"
  return active && serves ? "active" : "pending"
}

/**
 * Reads a custom domain from its provider, registering it when the domain has no provider id yet or the provider lost
 * it, and restarts the provider's validation when it moved or its certificate stalled or failed.
 */
export async function inspect(provider: HostnameProvider, row: DomainRow): Promise<Inspection> {
  return fromProvider(async () => {
    const found = row.providerId === null ? null : await provider.get(row.providerId)
    const state = found ?? (await provider.create(row.hostname))
    const restart = state.status === "moved" || state.certificate === "stalled" || state.certificate === "failed"
    return {
      state: restart ? await provider.refresh(state.id) : state,
      restartedFrom: restart ? state : null,
      registered: found === null
    }
  })
}
