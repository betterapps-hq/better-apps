import type { FeatureSchema } from "better-apps"

/** The model of the short links table. */
export const linkModel = "shortLink"

/** A short link as the table stores it. */
export type LinkRow = {
  id: string
  /** The code in the short URL, in lowercase. Unique within its `scope`. */
  code: string
  /**
   * Whose codes it's among: `""` for the app's, which the app's own hosts open, or an organization's id for a link made
   * on its domains, which they open. It never changes.
   */
  scope: string
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

/** The short links table. Opening a link is one read through the unique index on its code and scope. */
export const shortLinksSchema: FeatureSchema = {
  [linkModel]: {
    fields: {
      code: { type: "string" },
      scope: { type: "string", defaultValue: "" },
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
      { fields: ["code", "scope"], name: "short_link_code", unique: true },
      { fields: ["owner", "createdAt"], name: "short_link_by_owner" },
      { fields: ["orgId", "createdAt"], name: "short_link_by_org" },
      { fields: ["subjectType", "subjectId", "createdAt"], name: "short_link_by_subject" }
    ]
  }
}
