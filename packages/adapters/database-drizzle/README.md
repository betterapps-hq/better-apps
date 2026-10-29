# @better-apps/drizzle

The [Drizzle](https://orm.drizzle.team) database adapter for [Better Apps](../better-apps/README.md). Features read and
write their tables through it on PostgreSQL, MySQL, SQLite and Cloudflare D1.

## Usage

Generate the feature tables with `better-apps generate` from [`@better-apps/cli`](../cli/README.md), then pass them to
Drizzle and create the adapter:

```ts
import { drizzleAdapter } from "@better-apps/drizzle"
import { createDatabaseAdapter } from "better-apps"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "./better-apps-schema"

const db = drizzle(env.DB, { schema })
const adapter = createDatabaseAdapter({
  database: drizzleAdapter(db, { provider: "sqlite" }),
  features: [comments]
})
```

`provider` is `pg`, `mysql` or `sqlite`. D1 and libSQL are `sqlite`. When the tables aren't in the schema passed to
`drizzle()`, pass them as `schema` instead.

## Behavior

- `findMany` sorts on one or more fields. `after` takes the previous page's last row and returns the rows that follow
  it. End the sort with a unique field, such as `id`, so rows with equal values aren't skipped.
- `countGroups` counts rows for each combination of the `groupBy` fields in one query.
- `batch` runs its writes atomically. D1, libSQL, Neon's HTTP driver and `sqlite-proxy` with a batch callback send them
  in one `batch()` call. Other drivers run them in a transaction. sqlite-proxy without a batch callback still has a
  `batch()` that fails, so pass `batch: false` to use transactions there. better-sqlite3 and Bun's SQLite driver only
  have synchronous transactions, so batches of more than one write fail on them.
- `createMany` inserts rows in chunks, atomically like `batch`. SQLite statements stay under D1's limit of 100 bound
  parameters. Other databases take up to 1,000 rows per statement.
- `update` and `incrementOne` change the first matching row only. `incrementOne` checks its `where` again as it writes,
  so a guard such as `score < 10` holds when several requests write at once.
- `contains`, `starts_with` and `ends_with` match the value literally. `%`, `_` and `\` aren't wildcards.
- Created rows get `crypto.randomUUID()` ids unless `generateId` says otherwise. MySQL needs generated ids, because it
  can't return a created row any other way. With `generateId: false`, give the generated `id` column a default, such as
  Drizzle's `$defaultFn()` or a database default: `better-apps generate` writes a text primary key without one.
- JSON and list fields are stored as JSON. Columns that hold JSON, such as `jsonb`, Postgres arrays and SQLite text in
  JSON mode, get the value, and plain text columns get its JSON text, so SQL JSON functions can read either. MySQL's
  `json` column relies on the driver to parse it, as mysql2 does. On PostgreSQL, Drizzle's `json` and `jsonb` columns
  read a JSON string that looks like another value, such as `"123"`, as that value.
- An optional field set on update, with no default, is empty when the row is created. Drizzle's `$onUpdate()` would
  otherwise fill it on insert too.

The adapter is forked from Better Auth's. See the [package docs](docs/README.md).
