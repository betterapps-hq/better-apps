import { defineEvent } from "better-apps"
import type { ShortLink } from "./link.js"
import type { LinkSubject, OwnerType } from "./options.js"

/** Whose link was opened, as events about opening one carry it. */
export interface OpenedLink {
  linkId: string
  owner: { type: OwnerType; id: string }
  /** The organization the link was made in, or `null` outside any. */
  orgId: string | null
  /** The record it opens, or `null` for a link to a URL. */
  subject: LinkSubject | null
  /** The host it was opened on, such as `links.acme.com`. */
  host: string
}

/** What `link.clicked` carries: one open of a link, with `GET`. */
export interface LinkClick extends OpenedLink {
  /** Whether it set the access cookie, for a link that lets people see a record. */
  granted: boolean
  /**
   * The host it sent the visitor on to, for a link that lets people see a record whose cookie can't reach the record
   * from `host`, or `null`. That host's open is a click of its own, and only that one counts in `clicks`.
   */
  forwardedTo: string | null
  clickedAt: Date
  /** The share of opens that emit `link.clicked`, so each event stands for about `1 / sampleRate` opens. */
  sampleRate: number
}

/** What `link.granted` carries: a link that lets people see a record set its access cookie for a new visitor. */
export interface LinkGrant extends OpenedLink {
  subject: LinkSubject
  grantedAt: Date
}

/**
 * What `link.notFound` carries: a code that didn't open on a host. It's the same whether the code is unknown, turned off,
 * expired or another scope's, so it says nothing about whose code it is or whether it's a link anywhere else.
 */
export interface LinkNotFound {
  /** The host it was asked for on, such as `links.acme.com`. */
  host: string
  /** The organization whose domain the host is, or `null` for the app's own host. */
  orgId: string | null
  /** The code as the visitor gave it, up to 64 characters. It may be anything, including another scope's code. */
  code: string
  requestedAt: Date
}

/** The events short links emit. */
export const shortLinkEvents = {
  "link.created": defineEvent<{ link: ShortLink }>(),
  "link.updated": defineEvent<{ link: ShortLink }>(),
  "link.removed": defineEvent<{ link: ShortLink }>(),
  /** A link was opened, sampled by `events.clickRate`. */
  "link.clicked": defineEvent<LinkClick>(),
  /** A link that lets people see a record set its access cookie for a visitor whose cookie didn't hold it. */
  "link.granted": defineEvent<LinkGrant>(),
  /** A code didn't open on a host that opens links, limited by `events.notFoundPerMinute`. */
  "link.notFound": defineEvent<LinkNotFound>(),
  /** A link's click count reached one of `events.milestones`. */
  "link.milestone": defineEvent<{ link: ShortLink; clicks: number }>(),
  /** A link's `expiresAt` passed. */
  "link.expired": defineEvent<{ link: ShortLink }>(),
  /** A record's links were removed, such as after the record was deleted. */
  "subject.removed": defineEvent<{ subjectType: string; subjectId: string }>(),
  /** A person's or an organization's links were removed. */
  "owner.removed": defineEvent<{ owner: { type: OwnerType; id: string } }>(),
  /**
   * Short links' own: a link's expiry, which the outbox holds until `expiresAt`, delivered by a later
   * `app.deliverEvents()` run, which emits `link.expired` unless the expiry changed since.
   */
  "expiry.scheduled": defineEvent<{ linkId: string; token: string }>()
}

/** The data of each short links event, by type. */
export type ShortLinksEventData = {
  [Type in keyof typeof shortLinkEvents]: (typeof shortLinkEvents)[Type] extends { "~data"?: infer Data }
    ? NonNullable<Data>
    : never
}
