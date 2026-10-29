import type { StandardSchemaV1 } from "better-apps"

/**
 * What a comment body is and how it's made safe. The server never depends on an editor: a format checks and sanitizes
 * a body, and turns it into plain text and mentions, so search, emails and notifications work with any editor.
 */
export interface BodyFormat<Name extends string = string, Body = unknown> {
  name: Name
  /** Checks a body's shape. */
  schema: StandardSchemaV1<unknown, Body>
  /** Makes a checked body safe to store and show, such as by removing markup the format doesn't allow. */
  sanitize?(body: Body): Body
  /**
   * Plain text for search, emails and previews. Without `names`, mentions stay as tokens, so a removed user's name is
   * never stored. With it, they become names, and users it can't name show as "Former user".
   */
  toText(body: Body, names?: (userId: string) => string | undefined): string
  /** The ids of the users the body mentions, each once, in order. */
  mentions(body: Body): string[]
}

/** Declares a body format and keeps its name and body types for inference. */
export function defineFormat<const Name extends string, Body>(format: BodyFormat<Name, Body>): BodyFormat<Name, Body> {
  return format
}

// A mention is `@[user:<id>]`. A literal `@[` is written `\@[`, which this matches first so it's never read as one.
const tokens = /\\@\[|@\[user:([^\]\s]{1,255})\]/g

const textSchema: StandardSchemaV1<unknown, string> = {
  "~standard": {
    version: 1,
    vendor: "better-apps",
    validate: (value) =>
      typeof value === "string" && value.trim() !== ""
        ? { value }
        : { issues: [{ message: "A text comment needs some text." }] }
  }
}

/** Builds the token that mentions a user in a `text` body. */
export function mentionToken(userId: string): string {
  return `@[user:${userId}]`
}

/** Plain text with mention tokens such as `@[user:u_123]`. It holds no markup, so there's nothing to sanitize away. */
export const textFormat: BodyFormat<"text", string> = defineFormat({
  name: "text",
  schema: textSchema,
  sanitize: (body) => body.replace(/\r\n?/g, "\n").trim(),
  toText: (body, names) =>
    names
      ? body.replace(tokens, (token, userId: string | undefined) =>
          userId === undefined ? "@[" : `@${names(userId) ?? "Former user"}`
        )
      : body,
  mentions: (body) => [
    ...new Set([...body.matchAll(tokens)].flatMap(([, userId]) => (userId === undefined ? [] : [userId])))
  ]
})
