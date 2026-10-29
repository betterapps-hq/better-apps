# Better Apps deploys: capability packages and the deploy service

How apps declare the cloud resources they use, and how Better Apps deploys them. This design moved out of
[scaffolder-research.md](scaffolder-research.md) on 2026-10-28; the scaffolder's side of deploys stays there (§5). The
Better Apps Features session owns it from here.

**Status (2026-10-28):**

- Nothing is built yet.
- The decisions below are settled. D6 came last and overrides the parts of §5 and §6 that assume Workers for Platforms
  in Better Apps' own account.
- Decision IDs are shared with [scaffolder-research.md](scaffolder-research.md), which holds D1 and D4.

**Verification marks:**

- No mark: checked against source code, official docs or the npm registry.
- **[3p]:** found only in third-party coverage.
- **[U]:** not verified, or an inference. Check it before relying on it.

Working notes are in the side-session notes folder,
`C:\Users\ajcra\AppData\Roaming\Claude\side-session-notes\local_5a3a22c5-d679-4df4-b644-cb77a04e167c`:

- `research-capabilities.md`: prior art for finding cloud resources from code (Encore, Nitric, Void, SST, Nitro).
- `research-deploy.md`: the first deploy research. It predates D5, so its conclusions about hosts and `cf` no longer
  apply; its platform facts still do.
- `verification-2026-10-28.md`: the Cloudflare checks (previews, D1 migrations, `cloudflare.config.ts`).

## Decisions

| #   | Decision (2026-10-28)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | What changes                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| D2  | **Not Void; the Cloudflare API.** Void is not the deploy engine. Better Apps' deploy service calls the Cloudflare API directly, not the `cf` CLI or Wrangler                                                                                                                                                                                                                                                                                                                                                    | §5                                                                                                                 |
| D3  | **Each release may rebuild for each environment.** "Build once, promote the same artifact" is not required                                                                                                                                                                                                                                                                                                                                                                                                      | Staging and production build separately from the same commit, each with the backend the deploy service names (§4)  |
| D5  | **Capability packages drive deploys, and Better Apps runs them.** Neutral capability packages (SQL, KV, storage, queues, rooms, cron, workflows, secrets) and their Cloudflare adapters are open packages in Better Apps. Any code can declare resources with them. Better Apps' paid deploy service (`better-apps deploy` plus a hosted service) picks the cloud behind the scenes and runs every deploy. The scaffolder stays in Buildkit; it picks no host and writes no cloud config. v1 is Cloudflare only | §1–§5. The scaffolder has no hosts ([scaffolder-research.md](scaffolder-research.md) §4.6)                         |
| D6  | **Apps run in the customer's own Cloudflare account, for now.**                                                                                                                                                                                                                                                                                                                                                                                                                                                 | §5 and the hosted half of the §6 spike assumed Workers for Platforms in Better Apps' account, and need rework (§8) |

## Summary

- Code declares the cloud resources it needs with open capability packages from Better Apps. App code, Better Apps
  features and starter code declare them the same way (§2).
- The Better Apps Vite plugin writes the declarations that reach the server bundle to a manifest (§3).
- Better Apps' deploy service, `better-apps deploy`, picks the backend for each capability, then provisions, binds,
  migrates and deploys each environment through the Cloudflare API (§4, §5). Projects hold no cloud config.
- v1 is Cloudflare only, in the customer's own account for now (D6).
- Only the deploy service is paid.

---

## 1. Parts and owners

| Part                                                        | Lives in    | Open or paid    | Does                                                                                                             |
| ----------------------------------------------------------- | ----------- | --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Capability packages                                         | Better Apps | Open            | One package per cloud capability, with `define*` declarations and a neutral runtime API                          |
| Adapters                                                    | Better Apps | Open            | Implement each capability on a backend. v1 has Cloudflare adapters, plus local adapters for tests                |
| Build plugin and manifest format                            | Better Apps | Open            | Find the declarations that reach the server bundle, and write them to a manifest                                 |
| Deploy service: the `better-apps` CLI plus a hosted service | Better Apps | Paid            | Picks the cloud. Provisions, binds, migrates and deploys each environment. Runs previews and rollout             |
| Services around deploys: vault, previews, custom domains    | Better Apps | No payment plan | Run with the deploy service (§5)                                                                                 |
| Scaffolder                                                  | Buildkit    | Open            | Writes app code that uses capabilities, and wires the build plugin and CI. Writes no cloud config, picks no host |

- **Users never see a cloud.** App code, `vite.config.ts` and `buildkit.jsonc` name capabilities, never Cloudflare. The
  project has no Wrangler config, no `cloudflare.config.ts`, no account ID and no binding names.
- **Anyone can declare a resource,** and discovery treats every declaration the same:
  - app code;
  - a Better Apps feature (presence declares its room inside its own package);
  - starter code the scaffolder writes (the database add-on's `main` database).
- **The manifest format is open,** so others could build their own deploy tools against it. That is accepted: what
  Better Apps sells is provisioning and operations. Encore works the same way, with an open framework and a paid cloud.

**Capabilities in v1** [U: package and function names not settled]:

| Capability      | Package                 | Declares with    | Cloudflare backing (v1)                         |
| --------------- | ----------------------- | ---------------- | ----------------------------------------------- |
| SQL             | `@better-apps/sql`      | `defineDatabase` | D1                                              |
| Key-value       | `@better-apps/kv`       | `defineStore`    | KV                                              |
| Object storage  | `@better-apps/storage`  | `defineBucket`   | R2, deployed as managed storage                 |
| Queues          | `@better-apps/queue`    | `defineQueue`    | Queues                                          |
| Real-time rooms | `@better-apps/realtime` | `defineRoom`     | Durable Objects                                 |
| Workflows       | `@better-apps/workflow` | `defineWorkflow` | Workflows                                       |
| Cron            | `@better-apps/cron`     | `defineCron`     | Cron Triggers [U: for user Workers, §6]         |
| Secrets         | `@better-apps/secrets`  | `defineSecret`   | Worker secrets, written from Better Apps' vault |

## 2. Declaring a resource

```ts
// src/server/storage.ts: app code
import { defineBucket } from "@better-apps/storage"
export const uploads = defineBucket("uploads")

// src/server/db.ts: a seed file from the database add-on
import { defineDatabase } from "@better-apps/sql"
export const db = defineDatabase("main", { dialect: "sqlite", migrations: "./migrations/main" })

// inside @better-apps/presence: a Better Apps feature
import { defineRoom } from "@better-apps/realtime"
export const presenceRoom = defineRoom("presence", {
  onMessage(room, socket, message) {
    /* … */
  }
})

// anywhere on the server
await uploads.put(key, body)
```

**Rules,** enforced by the build plugin (from the prior-art research in `research-capabilities.md`):

1. Use named imports of the `define*` functions only, with no wrapper factories.
2. Declare at module top level only, and export the handle.
3. The name is a string literal, and so is every option that shapes provisioning (dialect, migrations folder, queue
   retries). Handlers can be functions.
4. Names are unique per capability. To share a resource, import its handle.
5. The `define*` functions are marked `/*#__NO_SIDE_EFFECTS__*/` and the packages are `sideEffects: false`, so a
   declaration that nothing uses drops out of the bundle.
6. Runtime access goes through the handle, which resolves the backend's binding. Code never reads `env.X`.
7. Declarations are server only. One that reaches the client bundle fails the build.
8. The name is the resource's identity. A rename shows in the deploy plan as a delete plus a create, and deleting data
   is always a decision.

## 3. Finding what's used

The Better Apps Vite plugin builds the manifest during `vite build`:

1. **`transform`**, with a hook filter on the capability packages:
   - parse the module with `this.parse`;
   - check the rules;
   - record each declaration and stamp it with a unique id literal.

   `transform` sees every module that loads, including ones later tree-shaken, so this list is a superset.

2. **`generateBundle`:** keep only the declarations whose id is still in the emitted server chunks, then write the
   manifest with `this.emitFile`.
3. **Environments:** the plugin runs on the server environment (`applyToEnvironment`). A declaration in the client
   environment fails the build.

```jsonc
// dist/server/better-apps.json [U: file name]
{
  "schemaVersion": 1,
  "resources": [
    {
      "capability": "sql",
      "name": "main",
      "options": { "dialect": "sqlite", "migrations": "./migrations/main" },
      "declaredIn": "src/server/db.ts"
    },
    { "capability": "storage", "name": "uploads", "declaredIn": "src/server/storage.ts" },
    { "capability": "realtime", "name": "presence", "declaredIn": "@better-apps/presence" }
  ]
}
```

- **Dev** has no bundle. The plugin collects declarations from the modules it transforms. A new declaration restarts the
  dev server, so the local runtime gets its binding [U: design, untested].
- **Next.js** (not in v1): Turbopack has no module-graph hook. Instead, a loader stamps the ids, and a scan of the
  server output through the Adapters API (`onBuildComplete`) finds which survived. The fallback is a reachability scan
  from the entry points with oxc-parser and oxc-resolver.
- **Rejected:**
  - Running the app to collect declarations, as Nitric does. It executes app code at build time and misses lazy paths.
  - Inferring resources from imports alone, as Void does with `void/*` imports and folder conventions. An import can't
    carry a resource name, Void's binding names are fixed, and it is Cloudflare only (`target: node` turns `void/db`
    into a compile error). Void isn't the deploy engine either (D2): its named environments are "unavailable", and it
    doesn't support Next.js.

## 4. Choosing the backend

- **Mechanism:** each capability package imports its backend through one internal specifier (`#adapter`), mapped by
  custom export conditions in its `package.json`. The build plugin adds the chosen backend's condition, for example
  `better-apps-cloudflare`, to Vite's `resolve.conditions`. The default condition is the local adapter. [U: untested]
- **The deploy service picks the backend.** `better-apps deploy` asks the service which backend each environment uses
  and builds with it. Each environment builds separately anyway (D3). In v1 the answer is always Cloudflare.
- **Local dev runs the Cloudflare adapters on Cloudflare's local runtime,** through the Cloudflare Vite plugin. The
  Better Apps integration adds that plugin and configures it from the declarations, so dev matches production. Local
  adapters (in memory, SQLite, the filesystem) cover unit tests and machines without that runtime. [U: whether the
  Cloudflare Vite plugin accepts its bindings inline, with no config file; spike #2]
- **A second cloud** is a new set of open adapters plus support in the deploy service. App code doesn't change (§7).

**Runtime glue per target,** owned by the Better Apps integration, not the scaffolder:

| App                             | Cloudflare (v1)                                                                                                                                                                 | Elsewhere (later)                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TanStack Start SSR              | Cloudflare Vite plugin (`viteEnvironment: { name: "ssr" }`), entry `@tanstack/react-start/server-entry`, bindings through `cloudflare:workers`                                  | `nitro()` with a preset (Nitro v3 is still beta); Netlify's TanStack Start plugin; Railway through Nitro. Start's hosting partners are Cloudflare, Netlify and Railway |
| Start SPA, static only          | Assets only, with the SPA fallback to `/index.html`, plus the #7740 workaround ([scaffolder-research.md](scaffolder-research.md) §4.8)                                          | any CDN                                                                                                                                                                |
| Start SPA with server functions | Worker + assets. The deploy service renders `run_worker_first: ["/_serverFn/*", "/api/*"]`, because navigation requests skip the Worker unless listed [U: end to end, spike #9] | same split                                                                                                                                                             |
| Next.js                         | vinext (Cloudflare's default; beta; Next 16 only) or OpenNext (doesn't support Node middleware, so `proxy.ts` may not work [U])                                                 | `next start` on Node; Vercel; Next Adapter API adapters (stable since 16.2; verified adapters are Vercel and Bun)                                                      |
| Browser game                    | SpawnKit's own platform deploys games, not Better Apps' deploy service ([scaffolder-research.md](scaffolder-research.md) §6.2)                                                  | —                                                                                                                                                                      |

## 5. The deploy service on Cloudflare (v1)

**Needs rework (D6).** For now apps run in the customer's own Cloudflare account. The design below assumed Workers for
Platforms in Better Apps' account, so where apps run, credentials, resource naming, previews and rollout change. The
plan, bindings, secrets and migrations steps likely carry over [U].

**Where apps run** [superseded by D6]: customer apps run in Better Apps' Cloudflare account, as user Workers in a
Workers for Platforms dispatch namespace. A Better Apps dispatch Worker routes each hostname to its user Worker. Checked
in Cloudflare's docs on 2026-10-28:

- User Workers can bind D1, KV, R2, Durable Objects, Queues and Workflows. Each one sees only the bindings attached to
  it.
- There's no limit on the number of user Workers or Durable Object namespaces.
- Gradual deployments aren't supported for user Workers.
- `caches.default` is disabled, and the request's `cf` object needs trusted mode.

**Environments** stay in the repo, with no cloud in them, in `better-apps.environments.jsonc` (a `seed` file):

- environments: preview (per PR), staging, production;
- kind (per-PR or long-lived) and protection;
- rollout policy;
- **resource policy per capability and environment:** `per-pr | shared | none`, for example "a fresh database per PR".

| Step                      | How (v1)                                                                                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build                     | `better-apps deploy --env <env>` builds in the customer's CI with the backend the service names. It uploads the build, the manifest and the committed migrations. Remote builds can come later                                                |
| Plan                      | The service diffs the manifest against the environment's recorded resources: creates, deletes (always a decision) and renames (rule 8). `better-apps deploy plan` posts the diff on every PR                                                  |
| Provision                 | Create D1, KV, R2 and Queues through the Cloudflare API, named `<project>-<env>-<capability>-<name>`. The IDs stay in the service; customers never see them                                                                                   |
| Bind                      | At upload, render each user Worker's bindings and assets config (including `run_worker_first`) from the manifest and the build. Binding names derive from the capability and the name, and the adapters resolve them                          |
| Secrets                   | Better Apps' vault is the only writer. Secrets are set on the user Worker at upload                                                                                                                                                           |
| SQL migrations            | Committed `drizzle-kit` output, applied before deploy, with a D1 Time Travel bookmark taken first. Applied through the D1 API, and recorded in a migrations table in the database [U: design]                                                 |
| Durable Object migrations | An append-only journal that the service keeps from the manifest's `realtime` declarations. Deleting a class is always a decision                                                                                                              |
| Rollout                   | User Workers can't use gradual deployments, so a canary is a second user Worker and the dispatch Worker splits traffic by percentage. Rolling back points the dispatcher at the previous Worker [U: design, spike #7]                         |
| Previews                  | One user Worker per PR in the namespace, which gives it its own Durable Object namespaces, plus resources by the resource policy. Removed when the PR closes. Not Worker Previews: they share D1, Queues, Cron and Workflows between previews |
| Custom domains            | Cloudflare for SaaS custom hostnames [U: not researched]                                                                                                                                                                                      |

**Tooling inside the service:** it calls the Cloudflare API directly through the `cloudflare` SDK, not the `cf` CLI or
Wrangler (D2). The service holds Better Apps' Cloudflare credentials; customers never get any.

**Services around deploys** belong to Better Apps too: preview environments and custom domains (the rows above), the
environment variables vault, managed storage (what `@better-apps/storage` deploys), and the preview, deploy and cleanup
workflows with their migrate action. Their designs are in [build-plans.md](build-plans.md) § "Better Apps services".

**Not supported in v1:**

- Native Node addons and long-running processes: apps run on Workers only.
- Self-hosting: it is possible with the open packages and the manifest, but Better Apps ships no self-host deploy tool.

## 6. Spike: a decision gate (about a day)

| #   | Hypothesis                                                                                                                                                 | Pass                                                                                | If it fails                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | The Vite plugin's manifest lists exactly the declarations that reach a Start SSR app's server bundle                                                       | An unused declaration is absent, and one imported from client code fails the build  | Use an oxc reachability scan from the entry points                                  |
| 2   | `vite dev` runs on Cloudflare's local runtime with bindings from the declarations, and no config file in the project                                       | D1, R2, a Queue and a room all work in dev                                          | Generate a gitignored Wrangler config under `.better-apps/` for dev only            |
| 3   | A user Worker with D1, R2, a Queue and a Durable Object deploys into a dispatch namespace through the API, and the dispatch Worker routes a hostname to it | Requests reach it and every binding resolves                                        | Deploy ordinary Workers in Better Apps' account, which count against account limits |
| 4   | Queue consumers and Cron Triggers work for user Workers                                                                                                    | A consumer runs and a schedule fires                                                | The dispatch Worker owns queues and cron, and forwards to user Workers              |
| 5   | Durable Object migrations apply to user Workers from the journal                                                                                           | A new class deploys; deleting one stops for a decision                              | Version classes by name instead of deleting them                                    |
| 6   | A per-PR preview gets its own user Worker, D1 database and Durable Objects, and is removed when the PR closes                                              | State is isolated, and cleanup works                                                | Share one preview database, with a prefix per PR                                    |
| 7   | The dispatch Worker splits traffic between two user Workers by percentage, and rollback restores the previous one                                          | The split is observable, and shifting back restores the previous version            | Deploy all at once, with fast rollback only                                         |
| 8   | The service applies committed migrations through the D1 API and records them, after taking a Time Travel bookmark                                          | Applied to staging, and a forced failure restores from the bookmark                 | Apply them from a Worker that has the D1 binding                                    |
| 9   | Start SPA with server functions works with `outputPath: "/index.html"`, `run_worker_first` and the #7740 workaround                                        | Deep links serve a shell without loader data, and server functions reach the Worker | Add an explicit fallback rewrite in the Worker                                      |

## 7. Other clouds

A second cloud is a new adapter set in Better Apps, plus support in the deploy service. App code doesn't change.

- Every capability needs a backing on that cloud. Real-time rooms are the hardest: outside Cloudflare they need a
  stateful service, such as a Node WebSocket server [U].
- Later candidates: Node, Railway or Docker through a Nitro preset; Vercel; Netlify.

## 8. Open questions and risks

1. **Hosting (D6).** Apps run in the customer's own Cloudflare account for now. §5 and spike rows #3–#7 assumed Workers
   for Platforms in Better Apps' account: credentials for the customer's account, resource naming, previews and rollout
   need rework.
2. **Preview and account limits.** Each preview's Worker, D1 database, queues and buckets count against the customer's
   account limits [U: the numbers].
3. **Capabilities (D5):**
   - How Better Apps' schema layer (forked from Better Auth's) feeds `@better-apps/sql` migrations, and how a feature
     reaches the app's `main` database through its handle (rule 4) instead of declaring its own.
   - Durable Object classes must be exported from the Worker entry. The integration would generate an entry that
     re-exports Start's server entry plus one class per room [U].
   - Dev discovery: restarting on a new declaration, and inline bindings for the Cloudflare Vite plugin (§6 #2).
   - Custom domains through Cloudflare for SaaS, and usage metering for billing: not researched.
   - Package and function names (`@better-apps/sql`, `defineDatabase` and the rest) aren't settled.

---

## Sources

**Capabilities and hosted deploys (2026-10-28):**

- Prior art: Encore's [application model](https://encore.dev/docs/ts/concepts/application-model) and
  [infra config](https://encore.dev/docs/ts/self-host/configure-infra);
  [how Nitric works](https://nitric.io/docs/concepts/how-nitric-works); Void's
  [resource inference](https://void.cloud/reference/resource-inference)
- Bundler hooks: [Rolldown `RenderedModule`](https://rolldown.rs/reference/Interface.RenderedModule),
  [Rolldown dead code elimination](https://rolldown.rs/in-depth/dead-code-elimination),
  [Vite environment plugins](https://vite.dev/guide/api-environment-plugins),
  [Next.js `adapterPath`](https://nextjs.org/docs/app/api-reference/config/next-config-js/adapterPath)
- Workers for Platforms:
  [bindings](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/bindings/),
  [limits](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/limits/)

**Runtime glue and Cloudflare:**

- TanStack Start: [on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/),
  [hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)
- Next.js: [on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/),
  [OpenNext Cloudflare](https://opennext.js.org/cloudflare),
  [Next.js across platforms](https://nextjs.org/blog/nextjs-across-platforms)
- Cloudflare: [Workers static assets](https://developers.cloudflare.com/workers/static-assets/),
  [SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/),
  [Vite plugin environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/),
  [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
  [Worker Previews resources](https://developers.cloudflare.com/workers/previews/resources/),
  [version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
- Void: [Cloudflare integration](https://void.cloud/integrations/cloudflare),
  [`void deploy`](https://void.cloud/reference/cli/deploy), [config](https://void.cloud/reference/config),
  [repo](https://github.com/voidzero-dev/void)
