import type { FeatureSchema } from "better-apps"
import type { DnsRecord } from "./provider.js"

/** The model of the domains table. */
export const domainModel = "domain"

/** What kind of domain: a subdomain of the app's zone, or a domain the organization owns. */
export type DomainKind = "subdomain" | "custom"

/** Whether a domain is ready for traffic: `pending` until it is, `failed` when the provider blocks it or time ran out. */
export type DomainStatus = "pending" | "active" | "failed"

/** Where the domain's certificate stands. */
export type CertificateStatus = "pending" | "active" | "failed"

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
  /** The current schedule of checks; an event carrying another token stops. */
  checkToken: string | null
  checkingSince: Date | null
  nextCheckAt: Date | null
  lastCheckedAt: Date | null
  verifiedAt: Date | null
  createdAt: Date
  createdBy: string | null
}

/** The domains table: one row per hostname, which is unique across the app. */
export const domainsSchema: FeatureSchema = {
  [domainModel]: {
    fields: {
      orgId: { type: "string", defaultValue: "" },
      hostname: { type: "string", unique: true },
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
    indexes: [{ fields: ["orgId", "createdAt"], name: "domain_by_org" }]
  }
}
