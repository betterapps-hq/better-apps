import { defineEvent } from "better-apps"

/** What both reaction events carry, so a subscriber never needs to query back. */
export interface ReactionEventData {
  subjectType: string
  subjectId: string
  orgId: string
  userId: string
  emoji: string
  /**
   * How many reactions with this emoji the record had just after the change, as the change read it, when it knew. Two
   * changes at the same moment can both be one off, so treat it as a hint, such as for a browser to reload on a mismatch.
   */
  count?: number | undefined
}

/**
 * Why a reaction went: the person took it back, chose another emoji when each person has one, or a moderator removed
 * it; its record or person was removed; it was `merged` into the person's same reaction, or had no room, when its record
 * moved to another organization; or it was `withdrawn` because its record went away, or out of the person's reach,
 * while it was saved.
 */
export type RemovalReason =
  | "unreacted"
  | "replaced"
  | "moderated"
  | "subjectRemoved"
  | "userRemoved"
  | "merged"
  | "withdrawn"

/** What `reaction.removed` carries. */
export interface ReactionRemovedData extends ReactionEventData {
  reason: RemovalReason
  /**
   * Whether it was one of many removed at once, such as by removing a record or a person. Those reach server subscribers
   * one by one, and browsers as one change of each record, from `subject.changed` or `subject.moved`, if any.
   */
  bulk?: boolean | undefined
}

/** What `move.finished` carries. */
export interface MoveFinishedData {
  /** The subject type of the record whose move reactions followed, such as `comments.thread`. */
  subjectType: string
  /** That record's id. */
  subjectId: string
  /** The organization it moved from, or `""` for none. */
  fromOrgId: string
  /** The organization it moved to, or `""` for none. */
  toOrgId: string
  /**
   * How many records of each subject type moved: the thread, and the comments it had when it moved, with reactions or
   * not, and whether or not reactions are set up on that subject type.
   */
  records: { subjectType: string; count: number }[]
}

/** The events reactions emit. Browsers get them through `toClientEvent`, which checks the viewer can see the record. */
export const reactionEvents = {
  "reaction.added": defineEvent<ReactionEventData>(),
  "reaction.removed": defineEvent<ReactionRemovedData>(),
  "subject.moved": defineEvent<{ subjectType: string; subjectId: string; toOrgId: string }>(),
  /** Many of a record's reactions changed at once, such as when a moderator removed them. */
  "subject.changed": defineEvent<{ subjectType: string; subjectId: string }>(),
  "subject.removed": defineEvent<{ subjectType: string; subjectId: string }>(),
  /** A person's reactions were removed, in one organization, or in all of them when `orgId` is `null`. */
  "user.removed": defineEvent<{ userId: string; orgId: string | null }>(),
  /**
   * Reactions finished moving after a record that moved to another organization, such as a comments' thread: the
   * reactions on it, and on the records it had when it moved, are in the new organization. Browsers never get it.
   */
  "move.finished": defineEvent<MoveFinishedData>(),
  /**
   * Reactions' own: what's left of cleaning up after records that went away or moved, such as comments' threads, which
   * reactions continue in the next `app.deliverEvents()` run. Browsers never get it.
   */
  "cleanup.continued": defineEvent<{
    records: { subjectType: string; subjectIds: string[] }[]
    /** For a move, the record it follows, such as a thread for its comments, and what `move.finished` reports. */
    move?:
      | (Omit<MoveFinishedData, "subjectType" | "subjectId"> & { subject: { subjectType: string; subjectId: string } })
      | undefined
  }>()
}

/** The data of each reactions event, by type. */
export type ReactionsEventData = {
  [Type in keyof typeof reactionEvents]: (typeof reactionEvents)[Type] extends { "~data"?: infer Data }
    ? NonNullable<Data>
    : never
}
