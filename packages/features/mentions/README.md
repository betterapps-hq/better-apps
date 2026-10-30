# @better-apps/mentions

Mentions of people in text, such as `@Ada` in a comment, shared by every feature that has them. It has the mention
tokens, checks of who may be mentioned, suggestions as someone types, and a `mentions` feature that records who was
mentioned where, so each user can list their mentions, such as in an inbox.

## Tokens

A mention is stored as a token, `@[user:<id>]`, so a renamed user's mentions stay right. A literal `@[` is written
`\@[`.

- `mentionToken(userId)` builds one.
- `parseMentions(text)` returns the users a text mentions, each once, in order.
- `replaceMentions(text, names)` turns tokens into `@Name` for previews and emails, with "Former user" for users `names`
  can't name.

## Checks and suggestions

Features check mentions through a scope: the identity adapter, the organization of the record, and an `allowed` callback
that says which users may be mentioned there, such as whoever can see it.

- `checkMentions(scope, userIds, authorId)` splits the users a text mentions into `allowed` and `dropped`. Users outside
  the organization are dropped, and the author is skipped.
- `suggestMentions(scope, query, limit)` searches the organization's members with the identity adapter's `searchUsers`,
  keeping only users who may be mentioned.

## The mentions feature

```ts
import { commentMentions, comments } from "@better-apps/comments"
import { mentions } from "@better-apps/mentions"

createBetterApps({
  database,
  identity,
  subjects,
  features: [comments(options), mentions({ sources: [commentMentions] })]
})
```

- Sources turn another feature's events into mentions, such as comments' `commentMentions`. Declare one with
  `defineMentionSource({ feature, subjectTypes, events })`, where each event returns mentions to `add`, records to
  `edit` or `remove`, groups to remove with `removeGroups`, and users to remove with `removeUsers`. Redelivered events
  are safe.
- Each mention has the user mentioned, the author, the record holding it as a subject, such as `comments.comment`, an
  optional group, such as the thread, and an excerpt of up to 280 characters with mentions as tokens.
- `listMentions({ cursor, limit })` lists the signed-in user's mentions in the organization they're acting in, newest
  first, 20 a page by default and at most 50, with the users they name. Access is checked when listing, through the
  app's subject types, so mentions in records the user can no longer see stay hidden.
- `removeUser({ userId })`, from server code only, removes every mention a user made or received.

Run `better-apps generate` to add the `mention` table to your schema.
