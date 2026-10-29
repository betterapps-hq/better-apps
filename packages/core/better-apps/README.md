# better-apps

App features, such as comments, audit history and approval flows, that bring their own database tables, server actions
and events. Better Apps runs them for any framework and any auth provider: [`@better-apps/cli`](../cli/README.md)
generates the features' schema for your ORM, the way Better Auth does for its plugins, and `createBetterApps` serves
their actions over HTTP and to your server code. Apps don't need Better Auth to use it.

## Usage

```ts
import { drizzleAdapter } from "@better-apps/drizzle"
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
  scheduled: (event, env, ctx) => ctx.waitUntil(app.deliverEvents())
}
```

Server code calls the same actions through `app.api`, typed per feature:

```ts
await app.api.notes.add({ text: "Imported" }, { author: { type: "system", name: "Importer" }, silent: true })
```

Run `better-apps generate` from `@better-apps/cli` to write the schema file that `drizzle-kit` reads. Test features with
[`@better-apps/testing`](../testing/README.md).

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

An action's handler receives its checked `input`, the `db` adapter, the `actor`, the `author`, the `identity` adapter,
`now`, `silent`, `source` (`http` or `api`), the `request` and `emit`.

## Identity

The identity adapter reads the signed-in user from a standard `Request`, so one adapter works on any framework.
`getActor(request)` returns `{ userId, orgId, roles }` or `null`. `getActorsFor(userIds, orgId)` builds actors for other
users in one call, leaving out non-members. Optional `getUsers` and `searchUsers` look up names and suggestions.
`localIdentity()` is for apps without sign-in: every request acts as one local user, outside any organization.

## HTTP

`app.handler` answers `POST {basePath}/{feature}/{action}` with the input as a JSON body and the output as JSON. The
base path is `/api/apps` unless you set `basePath`. It works on any runtime with the Fetch API.

- Other methods get 405, bodies that aren't `application/json` get 415, so cross-site forms can't call actions, and
  bodies over `maxBodySize` (1 MiB by default) get 413.
- Unknown and server-only actions get 404.
- A `BetterAppsError` returns its code and message: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404,
  `INVALID_INPUT` 400 with the schema's issues, `CONFLICT` 409, `RATE_LIMITED` 429, and 400 for other codes unless the
  error names a status. Any other error returns 500 `INTERNAL_ERROR` without details and goes to `onError`.

## Events

- `emit` adds an event to the action's next `db.batch`, so it's written to the core's outbox in the same transaction as
  the change, or in the same `batch()` on D1. Events emitted outside a batch are written after the handler returns. If
  the batch fails, its events are never written.
- Once written, events are delivered to every subscriber, starting as soon as the action finishes. With a `waitUntil`,
  such as a Worker's execution context, the response doesn't wait for delivery, and `waitUntil` keeps it running after
  the response is sent. Without one, or if `waitUntil` throws, the call waits for delivery.
- An event every subscriber handled is removed from the outbox. One a subscriber failed on stays, reported through
  `onError`, and `app.deliverEvents()` retries it after a backoff: 30 seconds, doubling up to an hour. Call it from a
  scheduled job. Delivery is at least once, so subscribers skip event ids they've already handled.
- Events nobody subscribes to aren't written. The outbox table, `betterAppsEvent`, is generated only when a feature
  subscribes to events.

## Tables

- Several features can extend the same table. Later fields win, and indexes are merged.
- Feature tables can't use the names Better Auth reserves: `user`, `session`, `account`, `verification` and `rateLimit`,
  or any name that becomes the same snake_case table, such as `User` or `rate_limit`. That lets Better Auth share the
  same database. `betterAppsEvent` is reserved for the outbox.
- Besides reads and writes, `DatabaseAdapter` sorts on several fields with an `after` cursor, counts rows per group,
  creates many rows at once and runs several writes as one atomic `batch`.
