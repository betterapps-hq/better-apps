import type { FeatureSchema } from "better-apps"
import type { CertificateStatus, DnsRecord } from "./provider.js"

/** The model of the domains table. */
export const domainModel = "domain"

/** What kind of domain: a subdomain of the app's zone, or a domain the organization owns. */
export type DomainKind = "subdomain" | "custom"

/**
 * Whether a domain is ready for traffic: `pending` until it is, `failed` when the provider blocks it, time ran out, or
 * another organization proved it owns the hostname.
 */
export type DomainStatus = "pending" | "active" | "failed"

/** A record the customer adds, with what the last check found: `null` before one, or when the lookup failed. */
export interface CheckedRecord extends DnsRecord {
  found: boolean | null
}

/** One domain as the table holds it. */
export type DomainRow = {
  id: string
  /** The organization, or `""` in an app without organizations. */
  orgId: string
  hostname: string
  /**
   * The hostname while this domain holds it: a subdomain from the start, a custom domain once its ownership record is
   * found. Unique, so one domain holds a hostname, while any organization may add it and prove it owns it.
   */
  claimedHostname: string | null
  /** The value of a custom domain's ownership record. `null` for subdomains. */
  ownershipToken: string | null
  kind: DomainKind
  status: DomainStatus
  certificate: CertificateStatus
  records: CheckedRecord[] | null
  providerId: string | null
  /** The organization's id when this is its primary domain, else `null`. Unique, so each has one at most. */
  primaryOf: string | null
  error: string | null
  /** Scheduled checks since checking last started. */
  attempts: number
  /** The current schedule of checks, or `null` when none runs; an event carrying another token stops. */
  checkToken: string | null
  /** When checking last started, while the domain is pending. */
  checkingSince: Date | null
  nextCheckAt: Date | null
  lastCheckedAt: Date | null
  verifiedAt: Date | null
  createdAt: Date
  createdBy: string | null
}

/** The domains table: one row per hostname an organization added, of which one domain holds the hostname. */
export const domainsSchema: FeatureSchema = {
  [domainModel]: {
    fields: {
      orgId: { type: "string", defaultValue: "" },
      hostname: { type: "string" },
      claimedHostname: { type: "string", required: false, unique: true },
      ownershipToken: { type: "string", required: false },
      kind: { type: "string" },
      status: { type: "string" },
      certificate: { type: "string" },
      records: { type: "json", required: false },
      providerId: { type: "string", required: false },
      primaryOf: { type: "string", required: false, unique: true },
      error: { type: "string", required: false },
      attempts: { type: "number", defaultValue: 0 },
      checkToken: { type: "string", required: false },
      checkingSince: { type: "date", required: false },
      nextCheckAt: { type: "date", required: false },
      lastCheckedAt: { type: "date", required: false },
      verifiedAt: { type: "date", required: false },
      createdAt: { type: "date" },
      createdBy: { type: "string", required: false }
    },
    indexes: [
      { fields: ["orgId", "createdAt"], name: "domain_by_org" },
      { fields: ["orgId", "hostname"], name: "domain_org_hostname", unique: true }
    ]
  }
}
