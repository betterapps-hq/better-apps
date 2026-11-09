import type { FeatureSchema } from "better-apps"

/** The model of the reactions table. */
export const reactionModel = "reaction"

/** The model of the table that remembers reactions just removed, so each removal is reported once. */
export const removalModel = "reactionRemoval"

/** One person's reaction with one emoji to one record. */
export type Reaction = {
  id: string
  /** The organization that owns the record, or `""` when the app has none. */
  orgId: string
  /** The record reacted to, as a subject type, so access follows the record's. */
  subjectType: string
  subjectId: string
  userId: string
  /** An emoji, such as `👍`, or a name from the app's own list, such as `:shipit:`. */
  emoji: string
  /**
   * Which of the person's places on the record it takes, from 0 to one less than `maxPerUser`. Places are unique per
   * person, so the database refuses a reaction past the limit even when several arrive at once.
   */
  slot: number
  createdAt: Date
}

/** The reactions tables. A person reacts with each emoji once per record, and with up to `maxPerUser` emoji. */
export const reactionsSchema: FeatureSchema = {
  [reactionModel]: {
    fields: {
      orgId: { type: "string", defaultValue: "" },
      subjectType: { type: "string" },
      subjectId: { type: "string" },
      userId: { type: "string" },
      emoji: { type: "string" },
      slot: { type: "number", defaultValue: 0 },
      createdAt: { type: "date" }
    },
    indexes: [
      { fields: ["subjectType", "subjectId", "orgId", "userId", "emoji"], name: "reaction_by_user", unique: true },
      { fields: ["subjectType", "subjectId", "orgId", "userId", "slot"], name: "reaction_slot", unique: true },
      { fields: ["subjectType", "subjectId", "orgId", "emoji", "createdAt"], name: "reaction_by_emoji" },
      { fields: ["userId"], name: "reaction_of_user" }
    ]
  },
  // A removal writes a row keyed by the reaction's id, so a second removal of the same reaction, such as from another
  // tab at the same moment, fails and its event is never written. Rows older than an hour are cleared as removals run.
  [removalModel]: {
    fields: { createdAt: { type: "date" } },
    indexes: [{ fields: ["createdAt"], name: "reaction_removal_by_time" }]
  }
}
