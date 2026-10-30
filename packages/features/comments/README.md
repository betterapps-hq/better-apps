# @better-apps/comments

Comment threads on any record an app owns, such as an invoice, a ticket or a preview deploy, optionally pinned to a spot
inside it. Comments store only the record's type and id; the app's subject types say who can see it, and the rules here
who can comment. Every write is one atomic batch through [`@better-apps/drizzle`](../drizzle/README.md), on Cloudflare
D1 as on any other SQL database.

## Usage

```ts
import { elementAnchor } from "@better-apps/anchors"
import { comments, CommentsError } from "@better-apps/comments"
import { createBetterApps } from "better-apps"

export const app = createBetterApps({
  database,
  identity,
  subjects: {
    invoice: {
      getOrgId: ({ subjectId }) => invoices.orgOf(subjectId),
      canView: ({ actor, subjectId }) => invoices.canRead(actor, subjectId)
    }
  },
  features: [
    comments({
      subjects: {
        invoice: {
          canComment: ({ actor, subjectId }) => invoices.canEdit(actor, subjectId),
          canModerate: ({ actor }) => actor.roles.includes("admin"),
          visibility: { staff: ({ actor }) => actor.roles.includes("staff") }
        }
      },
      anchors: [elementAnchor()],
      hooks: {
        before: {
          resolveThread: ({ actor, thread, input }) => {
            if (thread?.createdBy !== actor?.userId) {
              throw new CommentsError("FORBIDDEN", "Only the thread's creator can resolve it.")
            }
            return input
          }
        }
      }
    })
  ]
})

const { thread } = await app.api.comments.createThread(
  { subjectType: "invoice", subjectId: "inv_42", body: "Is this total right?" },
  { request }
)
```

Browsers call the same actions through `app.handler`, at `POST /api/apps/comments/<action>`. Run `better-apps generate`
to add the `commentThread` and `comment` tables to your schema.

## Actions

- Reads: `listThreads` (by last activity or creation, 20 a page), `getThread` (comments oldest first, 50 a page),
  `countThreads` (open and total for up to 50 records in one grouped query) and `suggestMentions`.
- Writes: `createThread`, `reply`, `editComment`, `deleteComment`, `resolveThread`, `reopenThread`, `updateThread`,
  `updateAnchor` and `deleteThread`.
- Server only, through `app.api.comments`: `removeSubject`, `moveSubject`, `removeUser` and `recountThreads` for upkeep,
  `canViewThread` for other features' recipient checks, and `toClientEvent` for live updates.

Reads return the users they name, from the identity adapter's `getUsers`. Users it can't find are left out, so show them
as "Former user".

## Access

- The app declares each subject type in `createBetterApps`, with `canView`, `getOrgId` and `publicRead` (see
  [Subjects](../better-apps/README.md#subjects)). Comments add `canComment` for each, and optionally `canModerate`,
  extra visibilities such as `staff`, a `metadata` schema and `canMention`.
- One rule decides whether someone can see a thread: its organization must be its subject's, the subject's `canView`
  must pass, and the actor must pass the thread's visibility check. Reads, mentions and live updates all use it.
- Threads and comments are subject types too, `comments.thread` and `comments.comment` (`commentSubjectTypes`), so other
  features can attach to them. Whoever can see a thread can see it and its comments.
- `NOT_FOUND` means the caller can't see it, and `FORBIDDEN` that they can see it but can't do this. Signed-out callers
  get `UNAUTHENTICATED`, except signed-out readers of public subjects, who get text with names and no user ids.
- Server code that passes neither an actor nor a request is trusted, so it skips access checks. It still needs an author
  to write: a user, or an external or system author with a name and an optional id.
- Before hooks run after the access check, keyed by action. They may change the input, but not the subject or thread. A
  hook that throws a `CommentsError` returns its code; any other error returns `REJECTED_BY_HOOK`.

## Writes

- Ids are ULIDs a client may generate. Repeating a write with the same ids, author and content returns what the first
  attempt wrote. Reusing your own id for different content is a `CONFLICT`, and an id someone else's row holds is
  `INVALID_INPUT`.
- `commentCount` and `lastActivityAt` change in the same batch as the comments they describe, so they're always exact.
- Deleting a comment clears its text and keeps its place. Deleting a thread's last comment deletes the thread.
- Replying to a resolved thread reopens it, running the `reopenThread` hook too.
- Bodies are capped at 16 KB, anchors and metadata at 4 KB, and mentions at 20 per comment. Mentioned users who can't
  view the thread aren't notified; only moderators are told who was dropped.

## Formats and anchors

- The built-in `text` format is plain text with mention tokens such as `@[user:u_123]` (`mentionToken(id)` builds one).
  A literal `@[` is written `\@[`. Add others with `defineFormat({ name, schema, sanitize, toText, mentions })`.
- Anchors come from [`@better-apps/anchors`](../anchors/README.md). `elementAnchor()` pins threads to an element, found
  with a selector that may use only ids, data attributes, tag names and structural positions. Add others with
  `defineAnchor({ kind, schema })`.

## In the browser

`@better-apps/comments/client` keeps threads, comments, lists and counts in a framework-free store, and
`@better-apps/comments/react` reads it with hooks. Neither has UI or an editor; apps bring their own composer and pin
styles.

```tsx
import { useCreateThread, useThreads } from "@better-apps/comments/react"
import { BetterAppsProvider } from "@better-apps/react"

function InvoiceComments({ invoiceId }: { invoiceId: string }) {
  const { threads, state } = useThreads({ subjectType: "invoice", subjectId: invoiceId })
  const createThread = useCreateThread()
  // Render the threads, and call createThread.mutate({ subjectType, subjectId, body }) from a form.
}
```

- Writes are optimistic: the client makes each new thread's and comment's ULID, so a change shows at once under its
  final id, and a retry can't duplicate it. A refused write is rolled back and rethrown with the server's code.
  `isPending(id)` from `useThread` says which items are still waiting.
- `applyEvent` takes events from `toClientEvent`, such as from a live updates feature, and ignores ones it has applied
  and comments it already has. A thread that gets a new comment moves to the top of lists by activity.
- `dehydrate()` and `hydrate(snapshot)` carry a server render's loads to the browser, so the first paint has threads.
  Each Better Apps client has one store, so a router that hydrates `createCommentsClient(client)` and hooks under a
  `BetterAppsProvider` with that client share it.
- The store holds what the signed-in person could see. If someone else signs in without a page load, call `reset()` or
  create a new Better Apps client, so they never see the previous person's threads. `reset()` also cancels calls still
  under way, which reject with `ABORTED`; a mutation hook whose write was cancelled goes back to `idle`.
- Hooks: `useThreads(subject, { status, order })`, `useThread(id)`, `useThreadCounts(subjectType, subjectIds)`, which
  splits lists over 50, `useSuggestMentions`, and a mutation hook per write, from `useCreateThread()` to
  `useDeleteThread()`, each with `mutate`, `status`, `error` and `reset`.
- To place a pin, pass a thread to `useAnchorPosition` from `@better-apps/anchors/react`, or `resolveAnchor` from
  `@better-apps/anchors/dom`.
- Dates in core fields are `Date`s again in the store. Dates in additional fields stay ISO strings.

## Events

`thread.created`, `thread.updated`, `comment.created`, `comment.edited` and `comment.deleted` (both with the previous
body), `comment.mentioned` (one per mention), `thread.resolved`, `thread.reopened`, `thread.anchorUpdated` (with the
previous anchor), `thread.deleted`, `subject.moved`, `subject.removed` and `user.removed`. They're written to the core's
outbox in the same batch as the change and delivered at least once. They stay on the server; `toClientEvent` turns one
into what a viewer's browser may see.
