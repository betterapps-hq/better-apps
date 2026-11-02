# Contributing to Better Apps

Use Node 24+ and pnpm 12. Run `pnpm install`, make one coherent change, then `pnpm verify`. Do not bypass Git hooks. The
[docs index](docs/README.md) describes the repo's conventions. Read each package's docs before changing it.

Put a new package in the folder for its role: `core`, `features`, `adapters`, `integrations` or `tooling` (see the
[README](README.md#packages)). Name an adapter after the slot it fills, such as `identity-clerk` or `database-drizzle`.

The Drizzle adapter also has server tests: `pnpm --filter @better-apps/database-drizzle test:servers` runs it on
PostgreSQL, Neon and MySQL in Docker.

Open a pull request with the problem, resulting behavior, and validation. Packages remain unpublished during incubation.
Contributions are MIT licensed.
