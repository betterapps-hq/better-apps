import type { Actor, Author, StandardSchemaV1 } from "better-apps"
import type { AnchorKind } from "./anchors.js"
import type { BodyFormat } from "./formats.js"
import type { AdditionalFields, CommentThread, InferFields } from "./schema.js"

/** Which subject an access check is about, and who is asking. */
export interface SubjectArgs {
  actor: Actor
  subjectType: string
  subjectId: string
}

type Check<Args> = (args: Args) => boolean | Promise<boolean>

/**
 * A kind of record that can have comments, such as `invoice`. The app answers who may see and act on its threads;
 * comments enforce the answers on every action.
 */
export interface SubjectType {
  /** Whether the actor can see the subject's threads. */
  canView: Check<SubjectArgs>
  /** Whether the actor can create threads, reply, and resolve or reopen threads. */
  canComment: Check<SubjectArgs>
  /** Whether the actor can delete any comment or thread, move any anchor and change a thread's visibility. Nobody, by default. */
  canModerate?: Check<SubjectArgs> | undefined
  /**
   * `canView` for many actor and subject pairs at once, for count badges and mention checks, in the same order. Apps
   * whose check is a query answer it in one. The default runs `canView` for each pair, concurrently.
   */
  canViewMany?: ((pairs: readonly SubjectArgs[]) => readonly boolean[] | Promise<readonly boolean[]>) | undefined
  /**
   * The organization that owns the subject, stored on each thread so subject ids repeated across organizations never
   * mix. Required when the identity adapter reports organizations.
   */
  getOrgId?: ((args: { subjectType: string; subjectId: string }) => string | null | Promise<string | null>) | undefined
  /** Extra visibilities, such as `staff`, each with a check saying who can see threads in it. */
  visibility?: Readonly<Record<string, Check<SubjectArgs>>> | undefined
  /** Lets signed-out visitors read threads with the `default` visibility, as text with names and no user ids. */
  publicRead?: boolean | undefined
  /** A schema that lets clients write a thread's `metadata`. Without one, only server code writes it. */
  metadata?: StandardSchemaV1<unknown, Record<string, unknown>> | undefined
  /** Whether a user can be mentioned in a thread. The default is whether they can view it. */
  canMention?: Check<{ actor: Actor; thread: CommentThread }> | undefined
}

/** What every before hook receives. */
export interface HookArgs<Input> {
  /** The signed-in user, or `null` for server code that names an author. */
  actor: Actor | null
  author: Author
  /** The thread the action targets, or `null` for `createThread`. */
  thread: CommentThread | null
  input: Input
}

type Hook<Input> = (args: HookArgs<Input>) => Input | Promise<Input>

/**
 * Checks and changes before writes, keyed by action. A hook runs after the access check, so it only sees callers who
 * may act. It returns the input, changed or not, or throws. It can't change the subject or thread the action targets.
 */
export interface BeforeHooks<Types extends CommentsTypes = CommentsTypes> {
  createThread?: Hook<CreateThreadInput<Types>> | undefined
  reply?: Hook<ReplyInput<Types>> | undefined
  editComment?: Hook<EditCommentInput<Types>> | undefined
  deleteComment?: Hook<CommentTarget> | undefined
  resolveThread?: Hook<ThreadTarget> | undefined
  /** Also runs when a reply reopens a resolved thread, so a rule on reopening can't be skipped by replying. */
  reopenThread?: Hook<ThreadTarget> | undefined
  updateThread?: Hook<UpdateThreadInput<Types>> | undefined
  updateAnchor?: Hook<UpdateAnchorInput<Types>> | undefined
  deleteThread?: Hook<ThreadTarget> | undefined
}

/** How comments are set up in an app. */
export interface CommentsOptions {
  /** The kinds of records that can have comments. Register at least one. */
  subjects: Readonly<Record<string, SubjectType>>
  /** Anchor kinds threads may use. Without any, threads are always on the whole subject. */
  anchors?: readonly AnchorKind[] | undefined
  /** Body formats besides the built-in `text`. */
  formats?: readonly BodyFormat[] | undefined
  hooks?: { before?: BeforeHooks | undefined } | undefined
  additionalFields?: AdditionalFields | undefined
}

/** The types an app's options give comments, for typed inputs and records. */
export interface CommentsTypes {
  subjectType: string
  visibility: string
  anchor: { kind: string; value: unknown; version?: string | null | undefined }
  content: { format?: string | undefined; body: unknown }
  threadFields: Record<string, unknown>
  commentFields: Record<string, unknown>
}

type VisibilityOf<Subject> = Subject extends { visibility?: infer Visibility }
  ? Visibility extends Readonly<Record<string, unknown>>
    ? keyof Visibility & string
    : never
  : never

type AnchorOf<Anchors> = Anchors extends readonly (infer Anchor)[]
  ? Anchor extends AnchorKind<infer Kind, infer Value>
    ? { kind: Kind; value: Value; version?: string | null | undefined }
    : never
  : never

type ContentOf<Formats> =
  | { format?: "text" | undefined; body: string }
  | (Formats extends readonly (infer Format)[]
      ? Format extends BodyFormat<infer Name, infer Body>
        ? { format: Name; body: Body }
        : never
      : never)

/** The types a set of options gives comments. */
export interface TypesOf<Options extends CommentsOptions> {
  subjectType: keyof Options["subjects"] & string
  visibility:
    | "default"
    | { [Name in keyof Options["subjects"]]: VisibilityOf<Options["subjects"][Name]> }[keyof Options["subjects"]]
  anchor: AnchorOf<Options["anchors"]>
  content: ContentOf<Options["formats"]>
  threadFields: Options["additionalFields"] extends { thread: infer Fields }
    ? InferFields<Fields>
    : Record<never, never>
  commentFields: Options["additionalFields"] extends { comment: infer Fields }
    ? InferFields<Fields>
    : Record<never, never>
}

/** A thread id, for actions on a thread. */
export interface ThreadTarget {
  threadId: string
}

/** A comment id, for actions on a comment. */
export interface CommentTarget {
  commentId: string
}

/** The input of `createThread`. */
export type CreateThreadInput<Types extends CommentsTypes = CommentsTypes> = Types["content"] & {
  /** The thread's ULID, so a retry can't create it twice. The server makes one when it's left out. */
  id?: string | undefined
  /** The first comment's ULID. */
  commentId?: string | undefined
  subjectType: Types["subjectType"]
  subjectId: string
  visibility?: Types["visibility"] | undefined
  anchor?: Types["anchor"] | null | undefined
  metadata?: Record<string, unknown> | null | undefined
  fields?: Partial<Types["threadFields"]> | undefined
  commentFields?: Partial<Types["commentFields"]> | undefined
}

/** The input of `reply`. */
export type ReplyInput<Types extends CommentsTypes = CommentsTypes> = Types["content"] & {
  /** The comment's ULID, so a retry can't create it twice. */
  id?: string | undefined
  threadId: string
  fields?: Partial<Types["commentFields"]> | undefined
}

/** The input of `editComment`. */
export type EditCommentInput<Types extends CommentsTypes = CommentsTypes> = Types["content"] & { commentId: string }

/** The input of `updateThread`. */
export interface UpdateThreadInput<Types extends CommentsTypes = CommentsTypes> {
  threadId: string
  metadata?: Record<string, unknown> | null | undefined
  /** Moderators only. */
  visibility?: Types["visibility"] | undefined
  fields?: Partial<Types["threadFields"]> | undefined
}

/** The input of `updateAnchor`. */
export interface UpdateAnchorInput<Types extends CommentsTypes = CommentsTypes> {
  threadId: string
  /** `null` moves the thread to the whole subject. */
  anchor: Types["anchor"] | null
}
