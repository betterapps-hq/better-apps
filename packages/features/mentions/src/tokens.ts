// A mention is `@[user:<id>]`. A literal `@[` is written `\@[`, which this matches first so it's never read as one.
const tokens = /\\@\[|@\[user:([^\]\s]{1,255})\]/g

/** Builds the token that mentions a user in text. */
export function mentionToken(userId: string): string {
  return `@[user:${userId}]`
}

/** The ids of the users a text mentions with tokens, each once, in order. */
export function parseMentions(text: string): string[] {
  return [...new Set([...text.matchAll(tokens)].flatMap(([, userId]) => (userId === undefined ? [] : [userId])))]
}

/** The start of a text, at most `length` characters, ending before a mention token the limit would cut in half. */
export function truncateText(text: string, length: number): string {
  for (const match of text.matchAll(tokens)) {
    if (match.index >= length) {
      break
    }
    if (match.index + match[0].length > length) {
      return text.slice(0, match.index).trimEnd()
    }
  }
  return text.slice(0, length)
}

/**
 * Text with each mention token turned into `@Name`, for previews, emails and screen readers. Users `names` can't name
 * show as "Former user", and an escaped `\@[` becomes `@[`.
 */
export function replaceMentions(text: string, names: (userId: string) => string | undefined): string {
  return text.replace(tokens, (_, userId: string | undefined) =>
    userId === undefined ? "@[" : `@${names(userId) ?? "Former user"}`
  )
}
