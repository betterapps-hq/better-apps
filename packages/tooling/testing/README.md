# @better-apps/testing

An in-memory SQLite database and a test identity for testing [Better Apps](../better-apps/README.md) features. The
database runs through [`@better-apps/drizzle`](../drizzle/README.md), so tests run the same queries an app does, with no
separate memory adapter to keep in step.

## Usage

```ts
import { createTestApp } from "@better-apps/testing"

const { app, identity, database } = createTestApp({
  features: [notes],
  users: [{ id: "ada", name: "Ada Lovelace", orgId: "acme", roles: ["admin"] }]
})

await app.api.notes.add({ text: "Hi" }, { actor: identity.actor("ada") })

const response = await app.handler(
  new Request("https://app.test/api/apps/notes/add", {
    method: "POST",
    headers: { "content-type": "application/json", ...identity.headers("ada") },
    body: JSON.stringify({ text: "Hi" })
  })
)

database.sqlite.prepare("SELECT COUNT(*) AS count FROM note").get()
```

`createTestApp` takes the same options as `createBetterApps`, with `users` in place of `database` and `identity`. Use
`testDatabase()` and `testIdentity(users)` on their own to pass them to `createBetterApps` yourself.

## Behavior

- `testDatabase()` creates a fresh database for each app, with every feature table and index, foreign keys enforced and
  batches that commit or roll back together. Columns use the same SQLite types as `better-apps generate`. `sqlite` gives
  the `node:sqlite` database for assertions once the app exists.
- `testIdentity(users)` acts as the user a request's `x-better-apps-test-user` header names, and as nobody without one.
  `identity.headers(userId)` sets it, and `identity.actor(userId)` returns the actor for `app.api` calls. Each user
  belongs to at most one organization, and `getActorsFor`, `getUsers` and `searchUsers` follow it. It trusts the header,
  so never use it outside tests.
- `createStatements(schema)` returns the SQL that creates the tables, for tests that build the database themselves.

Needs Node 24 or later, for `node:sqlite`.
