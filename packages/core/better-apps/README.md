# better-apps

App features, such as comments, audit history and approval flows, that declare their own database tables. Better Apps
merges the tables of the features an app enables, and [`@better-apps/cli`](../cli/README.md) generates the schema for
its ORM, the way Better Auth does for its plugins. Apps don't need Better Auth or any auth provider to use it.

## Usage

```ts
import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { createDatabaseAdapter, defineFeature } from "better-apps"

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
const adapter = createDatabaseAdapter({ database, features: [comments] })
```

`createDatabaseAdapter` returns the adapter features use to read and write their tables. Run `better-apps generate` from
`@better-apps/cli` to write the schema file that `drizzle-kit` reads.

## Behavior

- Schemas use Better Auth's plugin schema format: field types, `required`, `unique`, `index`, `references`,
  `defaultValue`, table indexes and custom `modelName` or `fieldName`.
- Several features can extend the same table. Later fields win, and indexes are merged.
- Better Apps adds no tables of its own. Feature tables can't use the names Better Auth reserves: `user`, `session`,
  `account`, `verification` and `rateLimit`, or any name that becomes the same snake_case table, such as `User` or
  `rate_limit`. That lets Better Auth share the same database.
