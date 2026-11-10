import type { FeatureSchema } from "better-apps"

/** The model of the reactions table. */
export const reactionModel = "reaction"

/** The model of the table that remembers reactions just removed, so each removal is reported once. */
export const removalModel = "reactionRemoval"

/** The model of the table that holds where reactions expect each record whose moves they follow to be. */
export const moveModel = "reactionMove"

/**
 * Where reactions expect a record whose moves they follow, such as a comments' thread, to be: the organization the move
 * they're following took it to, or deleted. A move takes the row only once the record is in its organization, and its
 * pages write only while the row still names that organization, so an older move never writes after a newer one.
 */
export type ReactionMove = {
  /** The record, as `JSON.stringify([subjectType, subjectId])`. */
  id: string
  /** The organization the move being followed took the record to, or `""` for none. */
  toOrgId: string
  /** Whether the record was deleted, which stops any move of it while the row is kept. */
  deleted: boolean
  /** A new value on each claim, so a move that read the row before another claim can't write over it. */
  claim: string
  /** When the row was last written, so rows no move has used for 30 days can be cleared. */
  heldAt: Date
}

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
  },
  // One row per record whose move or deletion reactions followed. Rows no move has written for 30 days are cleared as
  // moves start.
  [moveModel]: {
    fields: {
      toOrgId: { type: "string", defaultValue: "" },
      deleted: { type: "boolean", defaultValue: false },
      claim: { type: "string" },
      heldAt: { type: "date" }
    },
    indexes: [{ fields: ["heldAt"], name: "reaction_move_by_time" }]
  }
}
