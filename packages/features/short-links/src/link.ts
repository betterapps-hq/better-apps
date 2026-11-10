import type { OwnerType } from "./options.js"
import type { LinkRow } from "./schema.js"

/** Where a link goes, as actions return it. */
export type ShortLinkTarget = { type: "url"; url: string } | { type: "subject"; subjectType: string; subjectId: string }

/** A short link as actions and events return it. */
export interface ShortLink {
  id: string
  code: string
  /**
   * The address to share: `baseUrl`, or the request's origin, with the path and code. For server code with neither,
   * the path alone. With `hosts`, it's on a host that opens the link, and `null` for a link in an organization's scope
   * while `hosts.origin` returns `null` for the organization, such as when it has no ready domain, or while the cookie
   * wouldn't reach the record the link grants access to from the host `origin` gives.
   */
  shortUrl: string | null
  owner: { type: OwnerType; id: string }
  /** The organization the link was made in, or `null` outside any. */
  orgId: string | null
  /** The user who made it. */
  createdBy: string
  target: ShortLinkTarget
  /** Whether opening it lets anyone who has it see the record. */
  grantsView: boolean
  /** Whether it opens. A link that's off keeps its code and counts. */
  enabled: boolean
  expiresAt: Date | null
  /** How many times it was opened. */
  clicks: number
  lastClickedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** The `owner` column's value for an owner. */
export const ownerKey = (type: OwnerType, id: string): string => `${type}:${id}`

/** An owner from the `owner` column. */
export function ownerOf(key: string): ShortLink["owner"] {
  const split = key.indexOf(":")
  return { type: key.slice(0, split) as OwnerType, id: key.slice(split + 1) }
}

/**
 * A row as actions return it, with its short URL under `prefix`, such as `https://app.example/s`, or none for `null`.
 */
export function toLink(row: LinkRow, prefix: string | null): ShortLink {
  const target: ShortLinkTarget =
    row.url !== null
      ? { type: "url", url: row.url }
      : { type: "subject", subjectType: row.subjectType ?? "", subjectId: row.subjectId ?? "" }
  return {
    id: row.id,
    code: row.code,
    shortUrl: prefix === null ? null : `${prefix}/${row.code}`,
    owner: ownerOf(row.owner),
    orgId: row.orgId === "" ? null : row.orgId,
    createdBy: row.createdBy,
    target,
    grantsView: row.grantsView,
    enabled: row.enabled,
    expiresAt: row.expiresAt,
    clicks: row.clicks,
    lastClickedAt: row.lastClickedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

/** Whether a link opens now: it's turned on and hasn't expired. */
export function isOpen(row: Pick<LinkRow, "enabled" | "expiresAt">, now: Date): boolean {
  return row.enabled && (row.expiresAt === null || row.expiresAt.getTime() > now.getTime())
}
