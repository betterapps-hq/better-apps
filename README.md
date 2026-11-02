# Better Apps

App features with their own tables, actions and events, such as comments and mentions, for any framework and auth
provider. Features are added to an app the way plugins are added to Better Auth: enable them, generate their tables, and
call their actions.

## Packages

Folders under `packages/` say what each package is for.

| Folder                                  | Packages                                                                                                                                                                                                                                                                                                                             | What they do                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [`core`](packages/core)                 | [`better-apps`](packages/core/better-apps/README.md)                                                                                                                                                                                                                                                                                 | Runs features: their tables, actions, events and subjects, and the slots adapters fill                                         |
| [`features`](packages/features)         | [`@better-apps/comments`](packages/features/comments/README.md), [`@better-apps/mentions`](packages/features/mentions/README.md), [`@better-apps/anchors`](packages/features/anchors/README.md)                                                                                                                                      | Add something to an app, with their own tables and actions. An app enables as many as it wants                                 |
| [`adapters`](packages/adapters)         | [`@better-apps/identity-better-auth`](packages/adapters/identity-better-auth/README.md), [`@better-apps/identity-clerk`](packages/adapters/identity-clerk/README.md), [`@better-apps/identity-workos`](packages/adapters/identity-workos/README.md), [`@better-apps/database-drizzle`](packages/adapters/database-drizzle/README.md) | Fill one slot each, named first: who is signed in (`identity-`) and where tables live (`database-`). An app picks one per slot |
| [`integrations`](packages/integrations) | [`@better-apps/react`](packages/integrations/react/README.md), [`@better-apps/tanstack-start`](packages/integrations/tanstack-start/README.md)                                                                                                                                                                                       | Connect Better Apps to a UI or server framework                                                                                |
| [`tooling`](packages/tooling)           | [`@better-apps/cli`](packages/tooling/cli/README.md), [`@better-apps/testing`](packages/tooling/testing/README.md)                                                                                                                                                                                                                   | Generate the schema for the features an app enables, and test features against in-memory SQLite                                |

The [example app](apps/example/README.md) runs comments on invoices with TanStack Start, Better Auth and SQLite.

## Working in this repo

Use Node 24+ and pnpm 12. Run `pnpm install`, then `pnpm dev` to start the example app. See
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

MIT
