# Forked Better Auth source

This adapter started as a copy of Better Auth 1.7.14's Drizzle adapter and adapter factory. Unlike the
[vendored generator in the CLI](../../cli/docs/vendoring.md), the forked code belongs to Better Apps: edit it like any
other source. `upstream.json` records the upstream files and their hashes at the base release, so upstream fixes can
still be found and ported.

## Where the code came from

| File                     | Upstream source in `better-auth/better-auth`                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/factory.ts`         | `packages/core/src/db/adapter/factory.ts`, plus `get-default-model-name.ts`, `get-default-field-name.ts`, `get-model-name.ts` and `get-field-name.ts` beside it |
| `src/drizzle-adapter.ts` | `packages/drizzle-adapter/src/drizzle-adapter.ts`                                                                                                               |
| `src/query-builders.ts`  | `packages/drizzle-adapter/src/query-builders.ts`                                                                                                                |
| `src/date-columns.ts`    | `packages/drizzle-adapter/src/date-columns.ts`                                                                                                                  |

The `better-apps` package forks the schema types from `packages/core/src/db/type.ts` and `plugin.ts` into
`src/schema.ts`, and `toSnakeCase` from `packages/core/src/utils/string.ts` into `src/string.ts`. `upstream.json` tracks
those files too.

## What changed

- Better Apps' own types replace Better Auth's, so no Better Auth package is needed at runtime.
- The factory maps model and field names and converts values. The Drizzle code only builds queries.
- `findMany` sorts on several fields and takes an `after` cursor.
- `countGroups`, `batch` and `createMany` are new.
- `update` changes the first matching row only, the way `incrementOne` already did.
- `contains`, `starts_with` and `ends_with` escape `%`, `_` and `\` in the value.
- JSON and list values are encoded only for columns that store plain text (`src/json-columns.ts`). Upstream encoded them
  for every database except PostgreSQL, so the JSON-mode text that generated SQLite schemas use, and MySQL's `json`
  column, stored a JSON string of the JSON.
- An optional field with `onUpdate` and no default starts empty on create, instead of taking the value Drizzle's
  `$onUpdate()` writes on insert.
- Joins, the Drizzle schema check, debug logging and the `transaction` option are gone. Better Apps doesn't use them,
  and batches choose `batch()` or a transaction on their own. `batch: false` forces the transaction for sqlite-proxy
  without a batch callback.

## Finding upstream fixes

```sh
pnpm --filter @better-apps/drizzle upstream:changes
```

The script compares each tracked file at the base release with the latest Better Auth release, or the version you pass,
and prints the files that changed, the forked files they feed and a link to the full diff. Port the fixes that apply,
then record the release as the new base:

```sh
pnpm --filter @better-apps/drizzle upstream:changes 1.8.0 --update
```

A file that upstream moved or removed stops `--update`. Point `upstream.json` at its new path first.

Better Auth is MIT licensed. `LICENSE` names the files derived from it and includes its notice.
