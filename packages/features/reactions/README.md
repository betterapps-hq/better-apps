# @better-apps/reactions

Emoji reactions on any record an app owns, such as an invoice, or another feature's records, such as comments. Each
person reacts with each emoji once per record, up to a limit of emoji per person. Reactions store only the record's type
and id; the app's subject types say who can see it, so whoever can see a record sees its reactions.

## Usage

```ts
import { commentSubjectTypes, comments } from "@better-apps/comments"
import { reactions } from "@better-apps/reactions"
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
    comments(commentOptions),
    reactions({
      subjects: {
        invoice: {
          canReact: ({ actor, subjectId }) => invoices.canEdit(actor, subjectId),
          canModerate: ({ actor }) => actor.roles.includes("admin")
        },
        [commentSubjectTypes.comment]: { maxPerUser: 1 }
      },
      emojis: ["👍", "🎉", "❤️", "👀"]
    })
  ]
})
```

- `subjects` lists the subject types that can have reactions. The app or a feature must declare each one. `canReact`
  says who can add reactions; everyone who can see the record, by default. Anyone who can see it can take back their
  own. `canModerate` says who can remove anyone's; nobody, by default.
- `emojis` lists the only reactions allowed, in the order to show them. Entries that aren't emoji, such as `:shipit:`,
  are for apps that draw their own. It can be a function of the record's organization, `({ subjectType, orgId })`, for
  each workspace's own emoji. Its list is reused for a minute per organization, until server code calls
  `forgetEmojis({ orgId? })` on that server; entries in it that can't be reactions, or repeat, are skipped, and an empty
  list allows none. Without a list, any single emoji is allowed, checked with `isEmoji`.
- `maxPerUser` caps how many different emoji one person uses on one record, from 1 to 100: 20 by default. At 1, reacting
  with another emoji replaces the person's reaction, and `react` returns what it replaced as `replaced`, a list that's
  empty otherwise. The database holds the cap, so reactions sent at the same moment, such as from two tabs, can't pass
  it.
- `maxEmojis` caps how many different emoji one record has, from 1 to 500: 50 by default. A swap away from an emoji
  nobody else used makes room for its new one. Two people adding new emoji at the same moment can each pass it by one.
- `reactorVisibility` says who sees who reacted: `viewers`, everyone signed in who can see the record, by default;
  `public`, also signed-out visitors of public records; or `hidden`, for anonymous reactions, only moderators and server
  code. Everyone who can see the record sees the counts.
- `checkAfterReact`, per subject type, checks a saved reaction against its record again and takes it back when the
  record went away or out of the person's reach meanwhile, as `NOT_FOUND`, or moved to another organization, as
  `CONFLICT`. It costs an access check per reaction, and is on unless set to `false`.
- A subject type can set its own `emojis`, `maxPerUser`, `maxEmojis` and `reactorVisibility`, which replace the app's.
- Emoji are stored in one spelling, from `normalizeEmoji`, so `❤` and `❤️` are one reaction. Names that aren't emoji are
  kept as they are.

## Actions

- `listReactions({ subjectType, subjectIds })` returns each record's reactions, keyed by id:
  `{ emoji, count, reacted }`, where `reacted` says whether the caller used that emoji. Up to 50 records per call.
  Records the caller can't see come back with none. Reactions are in the `emojis` order, or in the order their emoji
  were first used, so chips keep their places as counts change.
- `listReactors({ subjectType, subjectId, emoji, cursor?, limit? })` pages through who reacted with one emoji, first
  reaction first, with names and avatars from the identity adapter. It follows `reactorVisibility`: `UNAUTHENTICATED`
  for signed-out visitors when only viewers see who reacted, and `FORBIDDEN` for non-moderators when that's hidden.
- `getSettings({ subjectType, subjectId })` returns how reactions work on a record: its `emojis`, or `null` for any,
  whether they depend on the organization as `emojisByOrg`, `maxPerUser`, `maxEmojis` and `reactorVisibility`, such as
  for a picker.
- These three reads count the [access grants](../../core/better-apps/README.md#access-grants) the request carries, such
  as a share link to the record. Someone who sees the record only through one isn't among its viewers, so they see who
  reacted only when that's `public`. `react`, `unreact` and `removeReactions` never count a grant, so a link never lets
  anyone react.
- `react` and `unreact` take `{ subjectType, subjectId, emoji }`. Both are safe to repeat: `react` returns
  `added: false` when the person had already reacted, and `unreact` returns `removed: false` when they hadn't, or when
  another removal, such as from another tab, got there first.
- `removeReactions({ subjectType, subjectId, emoji?, userId? })` removes reactions on a record, for callers
  `canModerate` allows and for server code: all of them, or one emoji's, one person's, or both. Each call removes up to
  100 and returns `{ removed, done }`; call it again until `done` is `true`. The browser client does that for you.
- Server code calls them for a user by passing `actor`. Server code that passes neither an actor nor a request reads
  without access checks, but can't react, since a reaction is always someone's.
- Errors are `ReactionsError`s: `UNAUTHENTICATED`, `NOT_FOUND` for records the caller can't see, `FORBIDDEN` when
  `canReact` or `canModerate` refuses, `INVALID_INPUT` for an emoji the record doesn't allow, `LIMIT_EXCEEDED` past
  `maxPerUser` or `maxEmojis`, and `CONFLICT` when a person's reactions on a record keep changing while one is saved.

## Records that change

Reactions keep the organization of the record when they were made. When a record moves to another organization, its
reactions stay hidden, and don't count toward anyone's limit there, until server code calls
`app.api.reactions.moveSubject({ subjectType, subjectId, toOrgId })`. A person who reacted with the same emoji in both
organizations keeps one, and the other is removed with the reason `merged`. Call
`removeSubject({ subjectType, subjectId })` when a record is deleted, and `removeUser({ userId, orgId? })` when a person
leaves the app, or one organization. These actions are server only. Each call does one page, removing up to 100
reactions or moving up to 30, and returns `done`, so no request outgrows a database's limits however busy the record or
person; call again, such as from a queue or a scheduled job, until `done` is `true`. A page whose batch fails, such as
one that lost a race with another removal, is read again. Each page's removal rows go in one `createMany`, a few
statements per page.

With reactions on comments' threads or comments, reactions follow comments' events instead: a deleted comment or thread
loses its reactions, a deleted comment can't get new ones, even one saved while it was being deleted, and a thread that
moves takes its and its comments' reactions along. Each delivery handles one page's worth of reactions, reading at most
ten lists of 90 ids to find them, so a thread of any size stays under D1's 50 queries per request on its free plan, and
the rest continues with reactions' own `cleanup.continued` event in the next `app.deliverEvents()` run, so call it from
a scheduled job. A move continues only while the thread is still in the organization it moved to, so an older move never
undoes a newer one. Subject types reactions are no longer set up on are skipped. Subscribing to events needs the core's
outbox table, which `better-apps generate` adds.

## Events

`reaction.added` and `reaction.removed` carry the record, its organization, the user and the emoji. A person's own
changes also carry `count`, how many reactions with that emoji the record had just after, as the change read it.
`reaction.removed` also says why, as `reason`: `unreacted`, `replaced` by another emoji, `moderated`, `subjectRemoved`,
`userRemoved`, `merged` when its record moved, or `withdrawn` when its record went away while it was saved. Each removal
is reported once, even when two removals of one reaction race, and removing a record or a person emits it for each of
their reactions, marked `bulk`. Every removal writes a row to `reactionRemoval` for that. Each page of a bulk removal
also emits `subject.changed` for every record it touched, written with the page, so browsers hear of the pages done even
when a job stops partway. Each page of a move emits `subject.moved` for every record it moved reactions on, the same
way, so a record without reactions gets none, and a busy one may get one per page. `subject.removed` and `user.removed`
follow the actions above once they're done.

`toClientEvent({ event, viewer, request? })`, a server-only action, turns a reaction event into one a viewer's browser
may see, or `null` when they can't see the record. With the viewer's request, grants it carries count as they do for
reads. Its `mine` says whether the viewer made the change, and its `userId` is `""` when `reactorVisibility` keeps who
reacted from that viewer. Removals marked `bulk` aren't sent to browsers; instead `subject.changed` and `subject.moved`
become one `subject.changed` client event for the record, so browsers load it again.
`toClientEvents({ event, viewers })` does the same for many viewers, in order, with one `canViewMany` call, for a live
updates feature with many connections.

## In the browser

`@better-apps/reactions/client` keeps reactions in a store any framework can bind to, with no server code in the bundle:

```ts
import { createReactionsClient } from "@better-apps/reactions/client"

const reactions = createReactionsClient(client)
await reactions.load("invoice", ["inv-1", "inv-2"])
await reactions.toggle({ subjectType: "invoice", subjectId: "inv-1", emoji: "👍" })
```

- `load` batches: loads asked for in the same tick go out together, 50 records per call. The first load of a subject
  type also loads its settings, so a swap shows at once when each person has one reaction.
- `react`, `unreact` and `toggle` show the change at once. The store keeps what the server confirmed apart from this
  tab's writes still going, which show on top of it, so a load or live event that lands meanwhile keeps them, and a
  refused write simply stops showing. Writes to one record go to the server in order, so quick toggles end where the
  last one left them. Emoji are stored in the server's spelling.
- `subjects[key].pending` lists the emoji still waiting for the server.
- Each record has a version, raised by every answer, write and live event, even before it first loads. The viewer's own
  changes made while a load was under way are made again on its answer, since they're set rather than counted, so an
  older answer never undoes them. When someone else's change or a `subject.changed` event came meanwhile, the answer may
  or may not have it, so it's dropped and the record loads again.
- `applyEvent` applies an event from `toClientEvent` once. A `subject.changed` event loads the record again. The
  viewer's own changes are set, not counted, so one that arrives both as an answer and as a live event counts once.
  Someone else's shows at once. When its `count` doesn't match what the store then shows, such as for a change already
  in a load, the record loads again; changes that come while it loads make it load once more.
- When the record's settings list its emoji, a new chip shows where a load will put it. Lists that depend on the
  organization are used per record, once `loadSettings` has loaded that record's. `loadReactors` and `isPending` take
  any spelling of an emoji.
- `removeReactions` removes reactions for moderators, calling the server until it's done, then loads the record again.
- `loadReactors` and `loadMoreReactors` fill `reactors` and `users` for tooltips. Lists of who reacted aren't changed in
  place: any write, live event or removal on a record marks its lists `stale`, including one whose page was on its way
  meanwhile, and a stale list keeps showing until it loads again. `useReactors` loads a stale list again, one load at a
  time, and returns `stale`. `loadSettings` fills `settings`.
- `dehydrate` and `hydrate` carry a server render's loads to the browser. `reset` empties the store and cancels calls
  under way when the signed-in person changes without a page load.
- `normalizeEmoji` is exported here too, for pickers that compare emoji.

`@better-apps/reactions/react` has hooks over the same store, with no UI:

```tsx
import { useReactionSettings, useReactors, useSubjectReactions } from "@better-apps/reactions/react"

const { reactions, toggle, isPending, writeError } = useSubjectReactions({ subjectType: "invoice", subjectId })
const { userIds, users } = useReactors({ subjectType: "invoice", subjectId }, "👍")
const { settings } = useReactionSettings({ subjectType: "invoice", subjectId })
```

Records that mount together, such as every comment in a thread, load in one call.

## Tables

`reaction` holds the reactions. Unique indexes on the record, its organization, the user and either the emoji or the
reaction's `slot`, its place among the person's reactions on the record, keep each emoji once per person and the limit.
Counts and first uses are grouped from an index on the record, organization and emoji. `reactionRemoval` remembers each
reaction removed in the last hour by its id, so a second removal of it fails rather than being reported twice. Run
`better-apps generate` from [`@better-apps/cli`](../../tooling/cli/README.md) to add them to your schema.
