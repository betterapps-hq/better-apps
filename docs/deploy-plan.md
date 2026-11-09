# Better Apps deploys on Void

How apps that use Better Apps get deployed, and what Better Apps has to build around Void to do it. Buildkit decided on
2026-11-02 to build deployment on [Void](https://github.com/voidzero-dev/void), Cloudflare's open-source deploy platform
([build-plans.md](https://github.com/betterapps-hq/buildkit/blob/main/docs/platform-planning/build-plans.md) §
"Deployment (Void)"). That replaced the capability packages, manifest and hosted `better-apps deploy` service this plan
described before; that design is in this file's Git history.

**Status (2026-11-08):**

- Nothing is built yet.
- The questions Buildkit left open (previews, staging and production, canary) are answered below. What each answer
  leaves for Better Apps to decide is in §6.

**What was checked:** Void 1.6.2, at commit
[`bb77b77`](https://github.com/voidzero-dev/void/tree/bb77b773da73b3781b29e3ef9e52701b089c2c67), by reading its docs and
source. Nothing was deployed.

**Verification marks:**

- No mark: checked against Void's source or docs.
- **[U]:** not verified, or an inference. Check it before relying on it.

## 1. What Void does

- **Resources from code.** Void scans an app's imports of `void/db`, `void/kv`, `void/storage`, `void/queues`,
  `void/durable` and `void/live` (plus crons and secrets) and provisions what it finds. `inference.bindings` in
  `void.config.ts` can rename the bindings.
- **Two targets.** `void deploy --platform cloudflare` deploys to the customer's own Cloudflare account. The default
  target is a Void platform, which a team hosts.
- **One command.** `void deploy` builds, provisions, applies migrations and deploys. `void project status`, `logs` and
  `rollback` cover the rest.
- **CI.** `void init --github` writes one workflow, `.github/workflows/void-deploy.yml`, which deploys on push to
  `main`.

## 2. Environments

### Per-PR previews: Void has none

- Neither target makes a copy of the app per PR, so there is nothing for Void to remove when a PR closes.
- The Void platform's GitHub OIDC login refuses tokens from `pull_request` and `pull_request_target` runs, so a PR's
  workflow can't deploy to it that way.
- The workflow `void init --github` writes deploys only on push to `main`.

So Buildkit's `preview.yml` and `cleanup.yml` are ours to build: a separate Worker per PR, with its own resources, and
teardown when the PR closes (§6).

### Staging and production: separate projects

- **Direct Cloudflare:** named environments are unavailable, and the CLI refuses to run with `CLOUDFLARE_ENV` set. The
  Worker and account come from `void.config.ts` and `void.lock.json`, and `--project` is unavailable. There is no
  `--config` flag, so a second environment needs its own config and lock file, such as a second directory [U: how best
  to lay that out].
- **Void platform:** each environment is its own project, picked with `--project` or `VOID_PROJECT`.

### Promoting one build

- **Direct Cloudflare** rebuilds on every deploy. `--skip-build` works only for static, SPA and SSG output, not Worker
  apps.
- **Void platform** accepts `--skip-build`, but the build bakes in `VOID_DEPLOY_PROJECT_ID` and every `VITE_*` value, so
  one build can't serve two projects as is [U: whether anything else is baked in].

Building per environment from the same commit stays the plan for v1, as Buildkit's build-plans already says.

## 3. Rollout and rollback

- **No percentage canary.** Void refuses to deploy over a gradual rollout that's in progress. A deploy uploads the new
  version at 0%, checks it, then moves it to 100%.
- **Rollback:** `void project rollback [versionId]` puts an earlier version back at 100% and restores triggers when Void
  has snapshots of them. It refuses if production changed in the meantime, and it doesn't reverse migrations.

So Buildkit's production pipeline becomes deploy, smoke test, watch the error rate, and roll back on a regression. A
canary would need traffic splitting of our own, outside Void (§6).

## 4. Migrations

- `void deploy` applies pending SQL from `db/migrations/`. It never generates migrations.
- For Drizzle projects it first checks for schema drift, and stops if `void db generate` would write a new migration.
- On D1 it saves a Time Travel bookmark before migrating, and won't migrate without one. `void db restore --bookmark` or
  `--timestamp` restores the database. D1 keeps 7 days of history on Workers Free and 30 on Paid.

That covers Buildkit's migration rules 2 and 5. The example app keeps its migrations in `drizzle/`, so it would move
them to `db/migrations/` to deploy with Void.

## 5. Better Apps features on Void

### The database

- `void/db` exports a Drizzle instance for D1, PostgreSQL or MySQL, and `createDb(binding | connectionString)` makes one
  from a binding or URL. That instance should go straight into `drizzleAdapter` from `@better-apps/database-drizzle` [U:
  not tried].
- A library package may import `void/db` if it lists `void` in its dependencies or peer dependencies; Void then adds it
  to `ssr.noExternal`. Features don't need to: the app passes its database to `betterApps()`, as it does now.
- **Feature tables must be in the app's schema.** Void reads the schema only from `db/schema.ts` or `db/schema/`, and
  inference doesn't scan `node_modules`. So the app re-exports the tables Better Apps generates for its features from
  there, and a library can't declare a binding of its own.

### Live updates and presence

- `void/live` is a one-way server-sent events stream: `defineLiveStream` and `live.publish`. Delivery is at most once,
  with up to 256 subscriptions per topic and 64 KiB per event. It has no notion of who is connected.
- `void/ws` (`defineRoom`, `defineWebSocket`) has broadcast and connection state, but works only in native Void apps,
  not with a framework such as TanStack Start.
- `defineDurableState` from `void/durable` must live in the app's own `durable-objects/` folder, and isn't supported
  with frameworks either.

So event delivery could run on `void/live`, with clients reloading on a gap. Presence needs Durable Object classes the
app exports itself, through `cloudflare.main` on direct Cloudflare [U: on the Void platform].

### Attachments

`void/storage` is the plain R2 binding. It has no presigned URLs or direct browser uploads, so managed storage (upload
URLs, file metadata, access rules) is ours to build on top of it.

### Frameworks

- TanStack Start with server rendering is supported: `voidPlugin()` goes before `tanstackStart()`. Void's auth, custom
  Durable Objects and `.ws.ts` routes are unavailable with it.
- TanStack Start in SPA mode is not covered by Void's docs [U].
- Next.js is unsupported, except experimentally through vinext.

### Local dev and tests

- `vite dev` runs on Cloudflare's local runtime through `@cloudflare/vite-plugin`, with local state under `.void` or
  `.wrangler`. Workers AI always calls the real service.
- Void has no testing guide. `createDb`, `createKV` and `createStorage` accept injected bindings, so tests can run
  without the Cloudflare runtime.

## 6. Open decisions

1. **Previews.** Build our own: a Worker per PR with its own D1 database, seeded, removed when the PR closes. Settle
   whether each preview is a Void project (Void platform) or a separate config (direct Cloudflare), and how many
   previews fit the account's limits [U: the numbers].
2. **Staging layout on direct Cloudflare.** How the scaffolder lays out two configs and lock files in one repo.
3. **Canary.** Ship without one, using fast rollback, or split traffic ourselves in front of two Workers.
4. **Feature tables.** How the app's `db/schema.ts` picks up the tables generated for its Better Apps features, and
   whether Better Apps' schema generator writes there directly.
5. **Presence.** Durable Object classes exported by the app, and how a Better Apps feature ships them without Void's
   room or durable state helpers.
6. **Managed storage.** Presigned uploads on top of `void/storage`.

## Sources

- Void repo at [`bb77b77`](https://github.com/voidzero-dev/void/tree/bb77b773da73b3781b29e3ef9e52701b089c2c67)
- Void docs: [deployment](https://void.cloud/guide/deployment),
  [`void deploy`](https://void.cloud/reference/cli/deploy),
  [Cloudflare integration](https://void.cloud/integrations/cloudflare),
  [TanStack Start](https://void.cloud/integrations/frameworks/tanstack-start),
  [database](https://void.cloud/guide/database), [live](https://void.cloud/guide/live),
  [WebSockets](https://void.cloud/guide/websockets), [durable state](https://void.cloud/guide/durable-state),
  [storage](https://void.cloud/guide/storage), [resource inference](https://void.cloud/reference/resource-inference)
