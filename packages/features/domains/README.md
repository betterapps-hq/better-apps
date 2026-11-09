# @better-apps/domains

Subdomains and custom domains for each organization in an app, such as `acme.yourapp.com` and `links.acme.com`. Domains
shows the DNS records a customer adds, checks them now and on a schedule until the domain is ready, keeps one primary
domain per organization and tells other features which organization a hostname belongs to. The [spec](docs/spec.md)
covers every rule, and the one-time Cloudflare setup.

## Usage

```ts
import { defaultReservedSubdomains, domains } from "@better-apps/domains"
import { cloudflareHostnames } from "@better-apps/hostnames-cloudflare"
import { createBetterApps } from "better-apps"

export const app = createBetterApps({
  database,
  identity,
  features: [
    domains({
      subdomains: { zone: "yourapp.com", reserved: [...defaultReservedSubdomains, "links"] },
      custom: {
        provider: cloudflareHostnames({
          apiToken: env.CLOUDFLARE_API_TOKEN,
          zoneId: env.CLOUDFLARE_ZONE_ID,
          target: "customers.yourapp.com"
        })
      },
      canManage: ({ actor }) => actor.roles.includes("org:admin")
    })
  ]
})
```

Call `app.deliverEvents()` from a scheduled job, such as a Worker's cron trigger every minute, so pending domains are
checked again.

- `subdomains` offers labels under the app's own zone, served by a wildcard record and certificate, so they're ready at
  once. `reserved` lists labels nobody can take, `defaultReservedSubdomains` by default; `minLength` is 3 and
  `maxPerOrg` is 1 by default.
- `custom` offers domains the organization owns, through the `hostnames` provider, such as
  [`@better-apps/hostnames-cloudflare`](../../adapters/hostnames-cloudflare/README.md). Use `localHostnames()` in tests
  and local development, and pass its `dns` as `dns`.
- `dns` looks up the records customers add, with `dnsOverHttps()` by default.
- `canManage` says who adds, checks and removes domains and chooses the primary one: the `owner` and `admin` roles by
  default. Every signed-in member can list them.
- `maxPerOrg` caps an organization's domains of both kinds, 10 by default.

## Actions

- `list()` returns the organization's domains and what a settings screen needs: `canManage`, `subdomainZone`,
  `customDomains` and `maxPerOrg`.
- `add({ kind: "subdomain", label })` or `add({ kind: "custom", hostname })`. Hostnames are unique across the app. A
  custom hostname another organization failed to verify is taken over.
- `check({ domainId })` checks the records now and starts the schedule over. It waits 10 seconds between checks of one
  domain.
- `remove({ domainId })` removes the domain from the provider, then from the app.
- `setPrimary({ domainId })` makes an active domain the primary one; `null` clears it. The first domain to become active
  in an organization without one becomes primary.
- `lookup({ hostname })`, server only, returns `{ domainId, orgId, hostname, kind, status, verified, primary }` or
  `null`, ignoring case, a trailing dot and a port. `getPrimary({ orgId })`, server only, returns an organization's
  primary domain.
- Server code that passes neither an actor nor a request names the organization with `orgId`.
- Errors are `DomainsError`s: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_INPUT`, `CONFLICT`,
  `LIMIT_EXCEEDED`, `RATE_LIMITED` and `PROVIDER_ERROR`, which answers 502.

## Checks

A custom domain is `active` once the provider reports its hostname and certificate active and its CNAME record is found.
Each record shows whether the last check `found` it. Pending domains are checked again after 1, 2, 5, 10, 15 and 30
minutes, 1 and 2 hours, then every 4 hours, through domains' own `check.scheduled` event left for later
`app.deliverEvents()` runs. One still pending after 7 days becomes `failed`; "check now" starts another 7 days.

## Events

`domain.added`, `domain.verified`, `domain.status.changed`, `domain.removed` and `primary.changed` carry a
`DomainSummary`: `id`, `orgId`, `hostname`, `kind`, `status` and `primary`. A feature that caches lookups can drop a
hostname on `domain.removed` and `domain.status.changed`.

## In the browser

`@better-apps/domains/client` keeps the organization's domains in a store any framework can bind to:

```ts
import { createDomainsClient } from "@better-apps/domains/client"

const domains = createDomainsClient(client)
await domains.load()
await domains.add({ kind: "custom", hostname: "links.acme.com" })
```

`load`, `add`, `check`, `remove`, `setPrimary` and `reset` keep `store` up to date, with `calls` naming what each domain
is waiting on. `@better-apps/domains/react` has `useDomains()`, which loads on first use and returns the domains, the
list's settings, its state and the same calls.

## Tables

`domain` holds one row per hostname, unique across the app, with its organization, kind, status, certificate status,
records, provider id, primary flag and check schedule. Run `better-apps generate` from
[`@better-apps/cli`](../../tooling/cli/README.md) to add it to your schema, with the core's outbox table for scheduled
checks.
