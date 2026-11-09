import type { FeatureSchema } from "better-apps"

/** The model of the short links table. */
export const linkModel = "shortLink"

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

/** The short links table. Opening a link is one read through the unique index on its code. */
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
  }
}
