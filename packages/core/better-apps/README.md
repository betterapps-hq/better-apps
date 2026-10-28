# @buildkitgg/better-apps

App features, such as comments, audit history and approval flows, that declare their own database tables. Better Apps
merges the tables of the features an app enables and generates the schema for its ORM, the way Better Auth does for its
plugins. Apps don't need Better Auth or any auth provider to use it.

## Usage

```ts
import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { defineFeature, generateSchema } from "@buildkitgg/better-apps"

const comments = defineFeature({
  id: "comments",
  schema: {
    comment: {
      fields: {
        subjectId: { type: "string", required: true, index: true },
        body: { type: "string", required: true }
      }
    }
  }
})

const database = drizzleAdapter(db, { provider: "pg" })
const { code } = await generateSchema({ database, features: [comments] })
```

Write `code` to a schema file that `drizzle-kit` reads, then generate migrations as usual. At runtime,
`createDatabaseAdapter({ database, features })` returns the adapter features use to read and write their tables.

## Behavior

- Schemas use Better Auth's plugin schema format: field types, `required`, `unique`, `index`, `references`,
  `defaultValue`, table indexes and custom `modelName` or `fieldName`.
- Several features can extend the same table. Later fields win, and indexes are merged.
- Better Apps adds no tables of its own. Feature tables can't use the names Better Auth reserves: `user`, `session`,
  `account`, `verification` and `rateLimit`, or any name that becomes the same snake_case table, such as `User` or
  `rate_limit`. That lets Better Auth share the same database.
- Schema generation supports the Drizzle adapter.

See the [package docs](docs/README.md).
