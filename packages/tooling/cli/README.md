# @better-apps/cli

Generates the database schema for the [Better Apps](../better-apps/README.md) features an app enables. It reuses Better
Auth's schema generator, so the output matches what Better Auth writes for its plugins, without Better Auth's own
tables.

## Usage

Create `better-apps.config.ts` with a default export of your database adapter and features:

```ts
import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { defineFeature, type BetterAppsOptions } from "better-apps"
import { db } from "./db.ts"

const comments = defineFeature({
  id: "comments",
  schema: { comment: { fields: { body: { type: "string", required: true } } } }
})

export default { database: drizzleAdapter(db, { provider: "pg" }), features: [comments] } satisfies BetterAppsOptions
```

Then generate the schema:

```sh
better-apps generate
```

This writes `better-apps-schema.ts`, which `drizzle-kit` reads to create migrations. Pass `--config` to load another
config file and `--output` to write the schema somewhere else. Code can call `generateSchema` from this package to get
the same output without writing a file.

## Behavior

- Schema generation supports the Drizzle adapter.
- The config is loaded with Node's own TypeScript support. Relative imports need their file extension, such as
  `./db.ts`, and the config can't use syntax that Node can't strip, such as enums.
- An existing schema file is replaced.

See the [package docs](docs/README.md).
