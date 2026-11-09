import { defineEvent } from "better-apps"
import type { DomainKind, DomainStatus } from "./schema.js"

/** What domain events carry about a domain, so a subscriber never needs to query back. */
export interface DomainSummary {
  id: string
  /** The organization, or `null` in an app without organizations. */
  orgId: string | null
  hostname: string
  kind: DomainKind
  status: DomainStatus
  primary: boolean
}

/** The events domains emits. */
export const domainEvents = {
  "domain.added": defineEvent<{ domain: DomainSummary }>(),
  /** A custom domain became `active`. */
  "domain.verified": defineEvent<{ domain: DomainSummary }>(),
  /** A domain's status changed, such as to `failed` when another organization proved it owns the hostname. */
  "domain.status.changed": defineEvent<{ domain: DomainSummary; from: DomainStatus }>(),
  /** A domain was removed. */
  "domain.removed": defineEvent<{ domain: DomainSummary }>(),
  /** An organization's primary domain changed, or it has none when `domain` is `null`. */
  "primary.changed": defineEvent<{ orgId: string | null; domain: DomainSummary | null }>(),
  /**
   * Domains' own: a custom domain's next scheduled check, due at `dueAt`, an ISO date, delivered by a later
   * `app.deliverEvents()` run.
   */
  "check.scheduled": defineEvent<{ domainId: string; token: string; dueAt: string }>()
}

/** The data of each domains event, by type. */
export type DomainsEventData = {
  [Type in keyof typeof domainEvents]: (typeof domainEvents)[Type] extends { "~data"?: infer Data }
    ? NonNullable<Data>
    : never
}
