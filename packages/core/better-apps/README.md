# better-apps

App features, such as comments, audit history and approval flows, that bring their own database tables, server actions
and events. Better Apps runs them for any framework and any auth provider:
[`@better-apps/cli`](../../tooling/cli/README.md) generates the features' schema for your ORM, the way Better Auth does
for its plugins, and `createBetterApps` serves their actions over HTTP and to your server code. Apps don't need Better
Auth to use it.

## Usage

```ts
import { drizzleAdapter } from "@better-apps/database-drizzle"
import { createBetterApps, defineAction, defineEvent, defineFeature, localIdentity } from "better-apps"
import { z } from "zod"

const notes = defineFeature({
  id: "notes",
  schema: { note: { fields: { text: { type: "string" }, authorId: { type: "string", required: false } } } },
  events: { "note.added": defineEvent<{ noteId: string }>() },
  actions: {
    add: defineAction({
      input: z.object({ text: z.string().min(1) }),
      handler: async ({ input, db, author, emit }) => {
        const id = crypto.randomUUID()
        emit("note.added", { noteId: id })
        const authorId = author?.type === "user" ? author.userId : null
        const [note] = await db.batch([{ type: "create", model: "note", data: { id, text: input.text, authorId } }])
        return note
      }
    })
  }
})

export const app = createBetterApps({
  database: drizzleAdapter(db, { provider: "sqlite" }),
  identity: localIdentity(),
  features: [notes]
})
```

Serve `app.handler` from your server, such as a Cloudflare Worker:

```ts
export default {
  fetch: (request, env, ctx) => app.handler(request, ctx),
  scheduled: (event, env, ctx) => ctx.waitUntil(app.deliverEvents({ waitUntil: (promise) => ctx.waitUntil(promise) }))
}
```

Server code calls the same actions through `app.api`, typed per feature:

```ts
await app.api.notes.add({ text: "Imported" }, { author: { type: "system", name: "Importer" }, silent: true })
```

Run `better-apps generate` from `@better-apps/cli` to write the schema file that `drizzle-kit` reads. Test features with
[`@better-apps/testing`](../../tooling/testing/README.md).

## Features

`defineFeature` declares a feature:

- `id` names it in `app.api` and in the handler's URLs.
- `schema` declares its tables in Better Auth's plugin schema format: field types, `required`, `unique`, `index`,
  `references`, `defaultValue`, table indexes and custom `modelName` or `fieldName`. The types are forked from Better
  Auth, so Better Apps doesn't depend on it.
- `actions` are server functions, declared with `defineAction`. An optional Standard Schema, such as a zod, Valibot or
  ArkType schema, checks the input. `serverOnly` actions are only reachable through `app.api`.
- `events` declares the events it emits, with `defineEvent`. `on` handles other features' events, keyed by the emitting
  feature's id and the event type, so features never import each other.
- `subjects` declares subject types for the feature's own records, so other features can attach to them, and
  `usesSubjects` lists the subject types it needs.
- `routes` are public pages and endpoints outside the action URLs, such as a short link's redirect. See
  [Routes](#routes).
- `grants` widens who can see subjects through what a request carries, such as a share link. See
  [Access grants](#access-grants).

An action's handler receives its checked `input`, the `db` adapter, the `actor`, the `author`, the `identity` adapter,
`subjects`, `now`, `silent`, `source` (`http` or `api`), the `request` and `emit`.

## Subjects

Features attach things to records the app owns, such as comments, reactions or attachments on an invoice. The app
declares each kind of record once, as a subject type, with who can see one. Every feature checks the same rules.

```ts
export const app = createBetterApps({
  database,
  identity,
  subjects: {
    invoice: {
      getOrgId: ({ subjectId }) => invoices.orgOf(subjectId),
      canView: ({ actor, subjectId }) => invoices.canRead(actor, subjectId)
    },
    page: { canView: () => true, publicRead: true }
  },
  features: [
    comments({ subjects: { invoice: { canComment: ({ actor, subjectId }) => invoices.canEdit(actor, subjectId) } } })
  ]
})
```

- `canView` says whether a signed-in user can see a subject, and so what features attach to it. `canViewMany` answers
  for many pairs at once, such as with one query; without it, `canView` runs for each pair.
- `getOrgId` returns the organization that owns a subject. Features store it with what they attach, so ids repeated
  across organizations never mix. It's required when the identity adapter reports organizations. `getOrgIds` answers for
  many subjects at once, for lists; without it, `getOrgId` runs for each.
- `publicRead` lets signed-out visitors see subjects: `true` for all of them, or a check per subject. Nobody, by
  default. `publicReadMany` answers for many subjects at once; without it, `publicRead` runs for each.
- Each feature adds its own rules on top, such as who can comment. A feature that uses a subject type the app doesn't
  declare stops `createBetterApps` with an error.
- Features declare subject types for their own records, such as comments' `comments.comment`, so a reaction on a comment
  follows the comment's access.
- Actions and subscribers check access through `context.subjects`, and server code through `app.subjects`:
  `canView(actor, { subjectType, subjectId })`, `canViewMany`, `isPublic`, `isPublicMany`, `getOrgId` and `getOrgIds`.
  The lists make one call per subject type. `null` as the actor is a signed-out visitor. Checks receive the `db`,
  `identity` and `subjects` as a second argument, for subject types that read Better Apps' tables.

## Access grants

A feature can let a request see subjects the app's rules don't let its sender see, such as a record shared through a
link. It declares `grants`, whose `canViewMany(refs, { request }, context)` says which subjects the request may see.

```ts
const shares = defineFeature({
  id: "shares",
  grants: { canViewMany: async (refs, { request }) => sharedWith(request, refs) }
})

await app.subjects.canView(actor, { subjectType: "invoice", subjectId }, { request })
```

- Grants count only in checks that pass the request: `canView(actor, ref, { request })`, or `request` on a check given
  to `canViewMany`. Without it, only the app's rules answer.
- Pass the request only for checks about the person who made it, and only for reading. Checks for other people, such as
  who a mention reaches, and checks before a write leave it out, so a grant never lets anyone change anything.
- Only the checks the app's rules refuse are asked of grants: each feature's once per request, with that request's
  subjects in one call.
- A signed-in user and a signed-out visitor are granted alike. `isPublic` stays about the app's rules.

## Identity

The identity adapter reads the signed-in user from a standard `Request`, so one adapter works on any framework.
`getActor(request)` returns `{ userId, orgId, roles }` or `null`. `getActorsFor(userIds, orgId)` builds actors for other
users in one call, leaving out non-members. Optional `getUsers` and `searchUsers` look up names and suggestions.
`localIdentity()` is for apps without sign-in: every request acts as one local user, outside any organization.
[`@better-apps/identity-better-auth`](../../adapters/identity-better-auth/README.md),
[`@better-apps/identity-clerk`](../../adapters/identity-clerk/README.md) and
[`@better-apps/identity-workos`](../../adapters/identity-workos/README.md) read users from those providers.

## HTTP

`app.handler` answers `POST {basePath}/{feature}/{action}` with the input as a JSON body and the output as JSON, and
serves the features' [routes](#routes). The base path is `/api/apps` unless you set `basePath`. It works on any runtime
with the Fetch API.

- Other methods get 405, bodies that aren't `application/json` get 415, so cross-site forms can't call actions, and
  bodies over `maxBodySize` (1 MiB by default) get 413.
- Unknown and server-only actions get 404.
- A `BetterAppsError` returns its code and message: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404,
  `INVALID_INPUT` 400 with the schema's issues, `CONFLICT` 409, `RATE_LIMITED` 429, and 400 for other codes unless the
  error names a status. Any other error returns 500 `INTERNAL_ERROR` without details and goes to `onError`.

## Routes

Features serve public pages and endpoints from `app.handler` besides actions, such as a short link's redirect at
`GET /s/:code` or a file upload at `PUT /api/apps/attachments/uploads/:fileId`. Each is declared with `defineRoute`
under the feature's `routes`, keyed by name:

```ts
const links = defineFeature({
  id: "links",
  routes: {
    open: defineRoute({
      path: "/s/:code",
      method: "GET",
      handler: async ({ params, db, waitUntil }) => {
        const link = await db.findOne<{ id: string; url: string }>({
          model: "link",
          where: [{ field: "code", value: params.code }]
        })
        if (!link) {
          return new Response("Not found", { status: 404 })
        }
        waitUntil(
          db.incrementOne({ model: "link", where: [{ field: "id", value: link.id }], increment: { clicks: 1 } })
        )
        return Response.redirect(link.url, 302)
      }
    })
  }
})
```

- `path` starts at the site's root. A segment starting with `:` matches any one segment and reaches the handler in
  `params`, decoded. A literal segment wins over a parameter, so `/s/new` is matched before `/s/:code`.
- A route may sit under `basePath` when it can't match an action's URL, `{basePath}/{feature}/{action}`: any number of
  segments below `basePath` but two, such as `GET /api/apps/attachments/files/:fileId/:name`. The app's catch-all route
  at the base path then serves it too.
- The handler gets the `request` as it arrived, its body unread, so an upload can stream straight to storage. Actions'
  `maxBodySize` and JSON checks don't apply; a route checks what it accepts itself.
- The response goes out as the handler returns it: streamed bodies, statuses such as 206 and 304, and headers.
- `GET` routes also answer `HEAD`, without a body: the handler's body is cancelled, so a stream it opened closes. A path
  that matches with another method gets 405 with `Allow`.
- The handler receives the `request`, its parsed `url`, such as for its host, `params`, `db`, `identity`, `subjects`,
  `now`, `getActor()`, which reads the signed-in user only when called, and `waitUntil(promise)`.
- `waitUntil` keeps work running after the response, such as recording a click, with the platform's `waitUntil` that
  `app.handler` receives. Without one, or when it throws, the response waits for the work. A failure goes to `onError`
  with the feature and route, and never changes the response.
- A `BetterAppsError` answers as actions' errors do. Any other error answers 500 and goes to `onError`.
- Creating the app fails for a malformed path, one that could match an action's URL, or two routes with the same method
  and path.
- Frameworks route paths outside the base path to `app.handler` the way they route the base path, such as with a
  catch-all route at `/s`.

## Client

`better-apps/client` calls the actions from the browser, with no framework and no server code in the bundle. Pass the
app's type for typed calls; the import is type-only.

```ts
import { createBetterAppsClient } from "better-apps/client"
import type { app } from "./server/app"

const client = createBetterAppsClient<typeof app>()
await client.notes.add({ text: "Hi" })
```

- Server-only actions are left out of the client's types, and `app.handler` answers them with 404.
- Outputs arrive as JSON, so dates are ISO strings, and the types say so. Feature clients, such as comments', turn the
  dates they know back into `Date`s.
- A failed call throws a `BetterAppsClientError` with the server's `code`, `status` and `issues`, or `NETWORK_ERROR`
  when the server can't be reached.
- Each call takes a `signal` as its last argument, such as `client.notes.add(input, { signal })`. A cancelled call
  throws `ABORTED`. One cancelled while `headers` resolve is never sent, so a sign-out can stop calls that would
  otherwise go out with the next person's token.
- `baseURL`, `basePath`, `headers`, `credentials` and `fetch` change how calls are sent. Tests can pass a `fetch` that
  calls `app.handler` directly.
- `createStore(initial)` makes the store feature clients keep their state in: `getSnapshot`, `subscribe` and `setState`,
  which framework layers such as [`@better-apps/react`](../../integrations/react/README.md) bind to.

## Events

- `emit` adds an event to the action's next `db.batch`, so it's written to the core's outbox in the same transaction as
  the change, or in the same `batch()` on D1. Events emitted outside a batch are written after the handler returns. If
  the batch fails, its events are never written. Several events go in one `createMany`.
- Once written, events are delivered to every subscriber, starting as soon as the action finishes. With a `waitUntil`,
  such as a Worker's execution context, the response doesn't wait for delivery, and `waitUntil` keeps it running after
  the response is sent. Without one, or if `waitUntil` throws, the call waits for delivery.
- An event every subscriber handled is removed from the outbox. One a subscriber failed on stays, reported through
  `onError`, and `app.deliverEvents()` retries it after a backoff: 30 seconds, doubling up to an hour. Call it from a
  scheduled job. Delivery is at least once, so subscribers skip event ids they've already handled.
- When delivery has a `waitUntil`, a report `onError` is still making is handed to it too, so it isn't cut off. Pass a
  scheduled job's own `waitUntil` to `app.deliverEvents({ waitUntil })` for the same.
- `emit(type, data, { later: true })` writes an event the same way but leaves it for the next `app.deliverEvents()` run,
  so a bulk job can do a step per run and continue in the next instead of in one long request. A subscriber's later
  events are written with its event's removal, so a delivery that fails or is retried emits them once.
- Events nobody subscribes to aren't written. The outbox table, `betterAppsEvent`, is generated only when a feature
  subscribes to events.

## Tables

- Several features can extend the same table. Later fields win, and indexes are merged.
- Feature tables can't use the names Better Auth reserves: `user`, `session`, `account`, `verification` and `rateLimit`,
  or any name that becomes the same snake_case table, such as `User` or `rate_limit`. That lets Better Auth share the
  same database. `betterAppsEvent` is reserved for the outbox.
- Besides reads and writes, `DatabaseAdapter` sorts on several fields with an `after` cursor, counts rows per group,
  creates many rows at once and runs several writes as one atomic `batch`, which can include a `createMany`.
