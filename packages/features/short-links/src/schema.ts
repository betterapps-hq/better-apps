import type { FeatureSchema } from "better-apps"

/** The model of the short links table. */
export const linkModel = "shortLink"

/** The model of the clicks table: one row per click. */
export const clickModel = "shortLinkClick"

/** A short link as the table stores it. */
export type LinkRow = {
  id: string
  /** The code in the short URL, in lowercase. Unique. */
  code: string
  /** `user:{userId}` or `org:{orgId}`, so a person's and their organization's links list in one query. */
  owner: string
  /** The organization the link was made in, or `""` outside any. */
  orgId: string
  /** The user who made it. */
  createdBy: string
  /** The target of a URL link. */
  url: string | null
  /** The target of a record link. */
  subjectType: string | null
  subjectId: string | null
  grantsView: boolean
  enabled: boolean
  expiresAt: Date | null
  clicks: number
  lastClickedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * One click on a link. It holds when the link was opened and nothing about who opened it: no IP address or user agent.
 * Removing the link removes its clicks.
 */
export type ClickRow = {
  id: string
  /** The link opened. */
  linkId: string
  clickedAt: Date
  /**
   * The start of the 15-minute slot the click fell in, in UTC. Every time zone's offset is a whole number of 15
   * minutes, so a slot is never split across two days in any zone, and clicks per day group by slot in one query.
   */
  slot: Date
}

/**
 * The short links tables. Opening a link is one read through the unique index on its code. Clicks reference their link,
 * so removing links, one at a time or in one statement for a record or an owner, removes their clicks too.
 */
export const shortLinksSchema: FeatureSchema = {
  [linkModel]: {
    fields: {
      code: { type: "string", unique: true },
      owner: { type: "string" },
      orgId: { type: "string", defaultValue: "" },
      createdBy: { type: "string" },
      url: { type: "string", required: false },
      subjectType: { type: "string", required: false },
      subjectId: { type: "string", required: false },
      grantsView: { type: "boolean", defaultValue: false },
      enabled: { type: "boolean", defaultValue: true },
      expiresAt: { type: "date", required: false },
      clicks: { type: "number", defaultValue: 0 },
      lastClickedAt: { type: "date", required: false },
      createdAt: { type: "date" },
      updatedAt: { type: "date" }
    },
    indexes: [
      { fields: ["owner", "createdAt"], name: "short_link_by_owner" },
      { fields: ["orgId", "createdAt"], name: "short_link_by_org" },
      { fields: ["subjectType", "subjectId", "createdAt"], name: "short_link_by_subject" }
    ]
  },
  [clickModel]: {
    fields: {
      linkId: { type: "string", references: { model: linkModel, field: "id", onDelete: "cascade" } },
      clickedAt: { type: "date" },
      slot: { type: "date" }
    },
    // Serves a link's clicks over a range, and removing them with their link.
    indexes: [{ fields: ["linkId", "slot"], name: "short_link_click_by_link" }]
  }
}
