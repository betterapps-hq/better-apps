// Domain rows as actions return them and events carry them.
import type { DomainSummary } from "./events.js"
import type { CertificateStatus } from "./provider.js"
import type { CheckedRecord, DomainKind, DomainRow, DomainStatus } from "./schema.js"

/** A domain as actions return it. */
export interface Domain {
  id: string
  hostname: string
  kind: DomainKind
  status: DomainStatus
  certificate: CertificateStatus
  /** Whether it's the organization's primary domain. */
  primary: boolean
  /** The DNS records the customer adds, with what the last check found. None for subdomains. */
  records: CheckedRecord[]
  /** Why it isn't ready, in words to show, or `null`. */
  error: string | null
  createdAt: Date
  lastCheckedAt: Date | null
  /** When the next scheduled check is due, or `null` when none is. */
  nextCheckAt: Date | null
  verifiedAt: Date | null
}

/** The organization as actions and events report it: `null` in an app without organizations. */
export const publicOrg = (orgId: string) => (orgId === "" ? null : orgId)

export function toDomain(row: DomainRow): Domain {
  return {
    id: row.id,
    hostname: row.hostname,
    kind: row.kind,
    status: row.status,
    certificate: row.certificate,
    primary: row.primaryOf !== null,
    records: row.records ?? [],
    error: row.error,
    createdAt: row.createdAt,
    lastCheckedAt: row.lastCheckedAt,
    nextCheckAt: row.nextCheckAt,
    verifiedAt: row.verifiedAt
  }
}

export function summary(row: DomainRow): DomainSummary {
  return {
    id: row.id,
    orgId: publicOrg(row.orgId),
    hostname: row.hostname,
    kind: row.kind,
    status: row.status,
    primary: row.primaryOf !== null
  }
}
