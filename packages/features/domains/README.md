# @better-apps/domains

Subdomains and custom domains for each organization in an app, such as `acme.yourapp.com` and `links.acme.com`. Domains
gives a custom domain to the organization that proves it owns it with a TXT record, shows the DNS records a customer
adds, checks them now and on a schedule, keeps one primary domain per organization and tells other features which
organization a hostname belongs to. The [spec](docs/spec.md) covers every rule, and the one-time Cloudflare setup.

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
          zone: "yourapp.com",
          target: "customers.yourapp.com"
        })
      },
      canManage: ({ actor }) => actor.roles.includes("org:admin")
    })
  ]
})
```

Call `app.deliverEvents()` from a scheduled job, such as a Worker's cron trigger every minute, so domains are checked
again. Call `app.api.domains.removeAll({ orgId })` when an organization is deleted.

- `subdomains` offers labels under the app's own zone, served by a wildcard record and certificate, so they're ready at
  once. `reserved` lists labels nobody can take, `defaultReservedSubdomains` by default; `minLength` is 3 and
  `maxPerOrg` is 1 by default.
- `custom` offers domains the organization owns, through the `hostnames` provider, such as
  [`@better-apps/hostnames-cloudflare`](../../adapters/hostnames-cloudflare/README.md). Use `localHostnames()` in tests
  and local development, and pass its `dns` as `dns`. `ownershipLabel` names the TXT record that proves ownership,
  `_verify` by default for `_verify.links.acme.com`.
- `dns` looks up the records customers add, with `dnsOverHttps()` by default.
- `canManage` says who adds, checks and removes domains and chooses the primary one: the `owner` and `admin` roles by
  default. Every signed-in member can list them. Rate-limit `add`, `remove` and `check` for each organization at the
  app's HTTP layer, since each provider registration counts against the app's shared provider API limit.
- `maxPerOrg` caps an organization's domains of both kinds, 10 by default.

## Actions

- `list()` returns the organization's domains and what a settings screen needs: `canManage`, `subdomainZone`,
  `customDomains` and `maxPerOrg`.
- `add({ kind: "subdomain", label })` or `add({ kind: "custom", hostname })`. A subdomain is taken at once. A custom
  domain is `pending` until a check finds its ownership record, so any organization may add a hostname, and the one that
  proves it owns it takes it.
- `check({ domainId })` checks the records now and starts the schedule over. It waits 10 seconds between checks of one
  domain.
- `remove({ domainId })` removes the domain from the provider, then from the app.
- `setPrimary({ domainId })` makes an active domain the primary one; `null` clears it. The first domain to become active
  in an organization without one becomes primary.
- `lookup({ hostname })`, server only, returns the domain holding a hostname as
  `{ domainId, orgId, hostname, kind, status, verified, primary }`, or `null`, ignoring case, a trailing dot and a port.
  `getPrimary({ orgId })`, server only, returns an organization's primary domain. `removeAll({ orgId })`, server only,
  removes an organization's domains, from the provider too.
- Server code that passes neither an actor nor a request names the organization with `orgId`.
- Errors are `DomainsError`s: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_INPUT`, `CONFLICT`,
  `LIMIT_EXCEEDED`, `RATE_LIMITED` and `PROVIDER_ERROR`, which answers 502.

## Hosts for other features

`domainHosts` gives a feature that serves organizations' domains, such as
[short links](../short-links/README.md#organizations-domains), whose host a request is on and where an organization's
links are shared, without that feature importing domains:

```ts
import { domainHosts } from "@better-apps/domains"

export const linkHosts = domainHosts({ url: "https://app.yourapp.com" })
const links = shortLinks({ baseUrl: "https://app.yourapp.com", hosts: linkHosts.hosts })

// Features are created before the app, so connect its domains once it exists.
const app = createBetterApps({
  database,
  identity,
  features: [links, domains({ subdomains: { zone: "yourapp.com" } })]
})
linkHosts.connect(app.api.domains)
```

- `hosts.resolve({ hostname })` answers `"app"` for the app's own hostnames, `url`'s and any in `hostnames`. It answers
  `{ orgId }` for an organization's `active` domain, or `"app"` in an app without organizations, and `null` for any
  other host, such as a pending domain.
- `hosts.origin({ orgId })` is the organization's primary domain once it's `active`, on `url`'s scheme and port, or
  `null` for the app's own.
- Both throw until `connect(app.api.domains)` runs.
- `localSuffix`, such as `"yourapp.localhost"`, is for local development with `localHostnames()` only. Browsers can't
  reach a custom domain such as `go.acme.com` on your machine, and domains refuses `.localhost` custom hostnames, so the
  app answers a custom domain at `go.acme.com.yourapp.localhost` instead, since browsers send every name under
  `localhost` to your machine. Its links are shared there too. Subdomains are reachable as they are.

## Checks

A custom domain takes its hostname once a check finds its ownership record, `_verify.<hostname>` with the domain's own
token, and is registered with the provider then. It's `active` once the provider reports its hostname and certificate
active. A domain whose holder's ownership record is gone passes to another organization that proves it owns it. Each
record shows whether the last check `found` it. Pending domains are checked again after 1, 2, 5, 10, 15 and 30 minutes,
1 and 2 hours, then every 4 hours, and active ones every 24 hours, through domains' own `check.scheduled` event, which
the outbox holds until it's due. One still pending after 7 days becomes `failed`; "check now" starts another 7 days. A
certificate being renewed, or one whose renewal stalled, doesn't make an active domain pending, but one that failed,
such as one that expired, does. A stalled renewal shows an error until the certificate is issued.

## Events

`domain.added`, `domain.verified`, `domain.status.changed`, `domain.removed` and `primary.changed` carry a
`DomainSummary`: `id`, `orgId`, `hostname`, `kind`, `status` and `primary`. A feature that caches lookups can drop a
hostname on `domain.removed` and `domain.status.changed`, which also tells when another organization took a domain over.
Events are emitted once the change they describe is saved.

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

`domain` holds one row for each hostname an organization added, with its organization, kind, the hostname it holds once
proven, its ownership token, status, certificate status, records, provider id, primary flag and check schedule. Run
`better-apps generate` from [`@better-apps/cli`](../../tooling/cli/README.md) to add it to your schema, with the core's
outbox table for scheduled checks.
