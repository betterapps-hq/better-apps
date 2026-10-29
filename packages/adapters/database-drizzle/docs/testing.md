# Testing the adapter

Every test in `src/drizzle-adapter.test.ts` runs once for each database in `test/databases.ts`, through the Drizzle
driver an app would use. The test tables match what `better-apps generate` writes for each dialect.

| Database                | Driver                                              | Runs                     |
| ----------------------- | --------------------------------------------------- | ------------------------ |
| SQLite, with `batch()`  | `sqlite-proxy` on `node:sqlite`                     | Always                   |
| SQLite, transactions    | `sqlite-proxy` on `node:sqlite`, without `batch()`  | Always                   |
| Cloudflare D1           | `d1` on a local D1 database in Miniflare            | Always                   |
| MySQL dialect on SQLite | `mysql-proxy` on `node:sqlite`, with small rewrites | Always                   |
| PostgreSQL              | `node-postgres`, as with Hyperdrive                 | With `pnpm test:servers` |
| Neon over HTTP          | `neon-http`, Neon's serverless driver               | With `pnpm test:servers` |
| Neon over WebSockets    | `neon-serverless`, Neon's serverless driver         | With `pnpm test:servers` |
| MySQL                   | `mysql2`                                            | With `pnpm test:servers` |

`pnpm test` skips the databases that need a server. To run them, start Docker and run:

```sh
pnpm --filter @better-apps/drizzle test:servers
```

It starts PostgreSQL 17, MySQL 8.4 and Neon's proxy from `test/compose.yaml`, then runs every test against all eight
databases. The servers keep their data in memory and stay up for the next run. Stop them with `pnpm test:servers:down`.
They listen on ports 15432, 13306 and 14444, outside the ranges Windows reserves for Hyper-V.

The Neon proxy image is a community build of Neon's open-source proxy that Neon's local development guide points to. It
serves the serverless driver's HTTP and WebSocket protocols, so no Neon account is needed. The compose file pins it by
digest.

CI runs `test:servers` in its `databases` job on Linux. Releases wait for it.
