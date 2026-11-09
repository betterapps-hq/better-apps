import type { SubjectArgs } from "better-apps"

/** What a list of emoji that depends on the organization receives. */
export interface EmojiListArgs {
  subjectType: string
  /** The organization that owns the record, or `null` when the app has none. */
  orgId: string | null
}

/**
 * The reactions allowed, in the order to show them: a list, or a function that returns the list for an organization,
 * such as a workspace's own emoji. A function's list is reused for a minute per organization, and entries in it that
 * can't be reactions, or repeat, are skipped; an empty one allows none.
 */
export type EmojiList = readonly string[] | ((args: EmojiListArgs) => readonly string[] | Promise<readonly string[]>)

/**
 * Who sees who reacted: `viewers`, everyone signed in who can see the record; `public`, also signed-out visitors of
 * public records; `hidden`, only moderators and server code, for anonymous reactions. Everyone sees the counts.
 */
export type ReactorVisibility = "viewers" | "public" | "hidden"

/**
 * How reactions work on one subject type, such as `invoice` or comments' `comments.comment`. Who can see a record, and
 * so its reactions, comes from the subject type; the rest here can differ from one subject type to another.
 */
export interface ReactionRules {
  /** Whether the actor can add and remove their reactions. Everyone who can see the record, by default. */
  canReact?: ((args: SubjectArgs) => boolean | Promise<boolean>) | undefined
  /** Whether the actor can remove anyone's reactions, such as an admin. Nobody, by default. */
  canModerate?: ((args: SubjectArgs) => boolean | Promise<boolean>) | undefined
  /** The reactions allowed on this subject type. The app's `emojis` by default. */
  emojis?: EmojiList | undefined
  /** How many different emoji one person can react with on one record. The app's `maxPerUser` by default. */
  maxPerUser?: number | undefined
  /** How many different emoji one record can have. The app's `maxEmojis` by default. */
  maxEmojis?: number | undefined
  /** Who sees who reacted. The app's `reactorVisibility` by default. */
  reactorVisibility?: ReactorVisibility | undefined
  /**
   * Whether a saved reaction is checked against the record again, and taken back when the record went away or out of
   * the person's reach meanwhile, so a record deleted while a reaction is saved keeps none. It costs an access check per
   * reaction. On for comments' threads and comments, whose cleanup runs on their events, and off otherwise.
   */
  checkAfterReact?: boolean | undefined
}

/** How reactions are set up in an app. */
export interface ReactionsOptions {
  /** The subject types that can have reactions, keyed by name. The app or a feature declares each one. */
  subjects: Readonly<Record<string, ReactionRules>>
  /**
   * The only reactions allowed, in the order to show them, such as `["👍", "🎉", ":shipit:"]`, or a function that
   * returns them for an organization. Names that aren't emoji are for apps that draw their own. Without a list, any
   * single emoji is allowed.
   */
  emojis?: EmojiList | undefined
  /**
   * How many different emoji one person can react with on one record. 20 by default. At 1, reacting with another emoji
   * replaces the person's reaction.
   */
  maxPerUser?: number | undefined
  /** How many different emoji one record can have, so a record can't collect endless chips. 50 by default. */
  maxEmojis?: number | undefined
  /** Who sees who reacted. `viewers` by default. */
  reactorVisibility?: ReactorVisibility | undefined
}

/** The types an app's options give reactions, for typed inputs. */
export interface ReactionsTypes {
  subjectType: string
  emoji: string
}

type Listed<List> = List extends readonly (infer Emoji extends string)[] ? Emoji : string

/** The types a set of options gives reactions. The emoji are every subject type's, or any string when one allows any. */
export interface TypesOf<Options extends ReactionsOptions> {
  subjectType: keyof Options["subjects"] & string
  emoji: {
    [Type in keyof Options["subjects"]]: Options["subjects"][Type] extends { emojis: EmojiList }
      ? Listed<Options["subjects"][Type]["emojis"]>
      : Listed<Options["emojis"]>
  }[keyof Options["subjects"]]
}

/** A record reactions are on. */
export interface ReactionSubject<SubjectType extends string = string> {
  subjectType: SubjectType
  subjectId: string
}

/** One reaction on one record, for `react`, `unreact` and `listReactors`. */
export interface ReactionTarget<Types extends ReactionsTypes = ReactionsTypes> extends ReactionSubject<
  Types["subjectType"]
> {
  emoji: Types["emoji"]
}

/** Which reactions on a record `removeReactions` removes: all of them, or only one emoji's, one person's, or both. */
export interface ReactionFilter<Types extends ReactionsTypes = ReactionsTypes> extends ReactionSubject<
  Types["subjectType"]
> {
  emoji?: Types["emoji"] | undefined
  userId?: string | undefined
}

/** The input of `listReactions`. */
export interface ListReactionsInput<SubjectType extends string = string> {
  subjectType: SubjectType
  /** Up to 50. */
  subjectIds: readonly string[]
}

/** The input of `listReactors`. */
export interface ListReactorsInput<Types extends ReactionsTypes = ReactionsTypes> extends ReactionTarget<Types> {
  cursor?: string | undefined
  /** 20 by default, at most 50. */
  limit?: number | undefined
}
