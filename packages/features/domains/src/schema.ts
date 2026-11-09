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
   * Its place among its organization's domains, from 0 to one below the organization's limit. Unique in the
   * organization, so adds that run at once can't pass the limit.
   */
  slot: number
  /** Its place among its organization's domains of its kind, unique too, so the subdomain limit holds the same way. */
  kindSlot: number
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
  /**
   * When a removal, or a check that found the domain out of time, last started deleting its hostname at the provider.
   * Until `releaseLeaseMs` after, no other organization can take the hostname over.
   */
  releasingAt: Date | null
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
      slot: { type: "number" },
      kindSlot: { type: "number" },
      claimedHostname: { type: "string", required: false, unique: true },
      ownershipToken: { type: "string", required: false },
      kind: { type: "string" },
      status: { type: "string" },
      certificate: { type: "string" },
      records: { type: "json", required: false },
      providerId: { type: "string", required: false },
      releasingAt: { type: "date", required: false },
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
      { fields: ["orgId", "hostname"], name: "domain_org_hostname", unique: true },
      { fields: ["orgId", "slot"], name: "domain_org_slot", unique: true },
      { fields: ["orgId", "kind", "kindSlot"], name: "domain_org_kind_slot", unique: true }
    ]
  }
}
