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
  "domain.status.changed": defineEvent<{ domain: DomainSummary; from: DomainStatus }>(),
  /** A domain was removed, or taken over by another organization after it failed. */
  "domain.removed": defineEvent<{ domain: DomainSummary }>(),
  /** An organization's primary domain changed, or it has none when `domain` is `null`. */
  "primary.changed": defineEvent<{ orgId: string | null; domain: DomainSummary | null }>(),
  /** Domains' own: the next scheduled check of a pending domain, delivered by a later `app.deliverEvents()` run. */
  "check.scheduled": defineEvent<{ domainId: string; token: string }>()
}

/** The data of each domains event, by type. */
export type DomainsEventData = {
  [Type in keyof typeof domainEvents]: (typeof domainEvents)[Type] extends { "~data"?: infer Data }
    ? NonNullable<Data>
    : never
}
