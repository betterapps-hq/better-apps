# Domains spec

`@better-apps/domains` lets each organization in an app serve it on its own hostnames: a subdomain of the app's zone,
such as `acme.yourapp.com`, or a custom domain the organization owns, such as `links.acme.com`. It stores each domain,
shows the DNS records a customer must add, checks them, keeps checking on a schedule until the domain is ready, and
answers which organization a hostname belongs to, for features such as short links that serve customers' domains.

The provider that issues certificates and routes custom domains plugs into one slot, `hostnames`. The
[Cloudflare adapter](../../../adapters/hostnames-cloudflare/README.md) fills it with Cloudflare for SaaS.
`localHostnames()` fills it for tests and local development.

## Kinds of domain

| Kind        | Example            | Needs from the customer        | Needs from the provider               |
| ----------- | ------------------ | ------------------------------ | ------------------------------------- |
| `subdomain` | `acme.yourapp.com` | Nothing                        | Nothing                               |
| `custom`    | `links.acme.com`   | A CNAME record, sometimes TXTs | A custom hostname and its certificate |

Subdomains run off a wildcard DNS record and a wildcard certificate on the app's own zone, set up once (see
[setup](#one-time-cloudflare-setup)). Adding one makes no call to the provider and it's ready at once. A label is one
level deep, since a wildcard certificate covers only one level: `acme.yourapp.com`, never `eu.acme.yourapp.com`.

Custom domains are registered with the provider, which validates the hostname and issues its certificate. The customer
points the hostname at the provider's target with a CNAME record. Apex domains, such as `acme.com`, can't hold a CNAME,
so they work only where the customer's DNS flattens CNAMEs; the check then compares addresses (see
[checking records](#checking-records)).

## Configuration

```ts
domains({
  subdomains: { zone: "yourapp.com", reserved: [...defaultReservedSubdomains, "links"], minLength: 3, maxPerOrg: 1 },
  custom: { provider: cloudflareHostnames({ apiToken, zoneId, target: "customers.yourapp.com" }) },
  dns: dnsOverHttps(),
  canManage: ({ actor }) => actor.roles.includes("owner"),
  maxPerOrg: 10
})
```

| Option                 | Default                     | What it does                                                                            |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| `subdomains.zone`      | none                        | The zone subdomains go under. Without `subdomains`, organizations can't add them        |
| `subdomains.reserved`  | `defaultReservedSubdomains` | Labels nobody can take. Replaces the defaults, so spread them to add to the list        |
| `subdomains.minLength` | 3                           | The shortest label, from 1 to 63                                                        |
| `subdomains.maxPerOrg` | 1                           | How many subdomains one organization can have                                           |
| `custom.provider`      | none                        | The `hostnames` slot. Without `custom`, organizations can't add custom domains          |
| `dns`                  | `dnsOverHttps()`            | Looks up the records a customer added                                                   |
| `canManage`            | the `owner` or `admin` role | Who in an organization can add, check and remove its domains and choose its primary one |
| `maxPerOrg`            | 10                          | How many domains of both kinds one organization can have, from 1 to 100                 |

At least one of `subdomains` and `custom` is required. `domains()` throws for a zone that isn't a valid hostname or a
limit out of range.

Apps without organizations, where every actor's `orgId` is `null`, have one set of domains for the whole app, stored
with the organization `""`.

## Table

One `domain` row per hostname. Hostnames are unique across the app, so two organizations can never hold the same one.

| Field           | Type                   | Holds                                                                                            |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `id`            | string                 |                                                                                                  |
| `orgId`         | string                 | The organization, or `""` in an app without organizations                                        |
| `hostname`      | string, unique         | Lowercase ASCII, with international names in punycode, no trailing dot                           |
| `kind`          | string                 | `subdomain` or `custom`                                                                          |
| `status`        | string                 | `pending`, `active` or `failed`                                                                  |
| `certificate`   | string                 | `pending`, `active` or `failed`                                                                  |
| `records`       | json                   | The DNS records the customer must add, each with what the last check found                       |
| `providerId`    | string or null         | The provider's id for the hostname. `null` for subdomains, and until the provider answers        |
| `primaryOf`     | string or null, unique | The `orgId` when this is the organization's primary domain, so each has at most one              |
| `error`         | string or null         | Why the domain isn't ready, from the provider or the DNS check, for people to read               |
| `attempts`      | number                 | Scheduled checks since checking last started                                                     |
| `checkToken`    | string or null         | The current schedule of checks, so an older schedule stops (see [rechecks](#scheduled-rechecks)) |
| `checkingSince` | date or null           | When checking last started: when the domain was added, or the last "check now"                   |
| `nextCheckAt`   | date or null           | When the next scheduled check is due, or `null` when none is                                     |
| `lastCheckedAt` | date or null           | When it was last checked                                                                         |
| `verifiedAt`    | date or null           | When it last became `active`                                                                     |
| `createdAt`     | date                   |                                                                                                  |
| `createdBy`     | string or null         | The user who added it                                                                            |

An index on `orgId` and `createdAt` lists an organization's domains in the order they were added.

A domain is `active` when it's ready for traffic. A subdomain is `active` from the start. A custom domain is `active`
when the provider reports the hostname and its certificate active and the CNAME record is found. It's `failed` when the
provider blocks the hostname, or when it wasn't ready after 7 days of checks. Anything else is `pending`.

## Hostname rules

### Subdomain labels

A label is what goes before the zone, typed by the person adding it. It's trimmed and lowercased, then must:

- be from `minLength` to 63 characters of `a` to `z`, `0` to `9` and `-`;
- not start or end with `-`, or have `--` anywhere, which also rules out punycode labels such as `xn--`;
- not be in `reserved`.

`defaultReservedSubdomains` holds names an app is likely to want for itself or that suggest an official page: `www`,
`api`, `app`, `apps`, `admin`, `administrator`, `auth`, `login`, `logout`, `signin`, `signup`, `sso`, `oauth`,
`account`, `accounts`, `billing`, `pay`, `payments`, `checkout`, `dashboard`, `console`, `portal`, `docs`, `help`,
`support`, `status`, `blog`, `news`, `mail`, `email`, `smtp`, `imap`, `pop`, `mx`, `ftp`, `ns`, `ns1`, `ns2`, `dns`,
`cdn`, `static`, `assets`, `media`, `files`, `img`, `images`, `dev`, `staging`, `test`, `beta`, `demo`, `preview`,
`internal`, `root`, `system`, `security`, `settings` and `customers`.

The hostname `<label>.<zone>` is unique, so a label one organization holds is taken for every other. Two organizations
adding the same label at the same moment can't both get it: the unique index refuses the second with `CONFLICT`.

### Custom hostnames

The hostname is trimmed and parsed as a URL's host, so `HTTPS://Links.Acme.com/` becomes `links.acme.com` and
`bücher.example` becomes `xn--bcher-kva.example`. It must then:

- have at least two labels, each 1 to 63 characters of `a` to `z`, `0` to `9` and `-`, not starting or ending with `-`,
  and be at most 253 characters;
- not be an IP address, `localhost`, or end in `.localhost`, `.local`, `.test`, `.example`, `.invalid` or `.internal`;
- not be the subdomain zone or under it, which subdomains are for.

Wildcards, ports, paths and credentials are refused. The provider may refuse a hostname too, such as one equal to its
own zone, which returns `INVALID_INPUT` with the provider's reason.

### Taking a hostname

Adding a hostname another organization holds returns `CONFLICT`, unless that domain is `failed`: then it's removed, from
the provider too, with `domain.removed`, and the new one takes its place. So a domain nobody verified doesn't keep its
hostname from its real owner forever. Adding a hostname the same organization holds returns `CONFLICT`.

## Actions

Every action is a POST to `/api/apps/domains/<action>`, and `app.api.domains.<action>` from server code.

| Action       | Input                                                            | Returns                       | Who                         |
| ------------ | ---------------------------------------------------------------- | ----------------------------- | --------------------------- |
| `list`       | none                                                             | `DomainList`                  | Members of the organization |
| `add`        | `{ kind: "subdomain", label }` or `{ kind: "custom", hostname }` | `Domain`                      | `canManage`                 |
| `check`      | `{ domainId }`                                                   | `Domain`                      | `canManage`                 |
| `remove`     | `{ domainId }`                                                   | `{ removed: boolean }`        | `canManage`                 |
| `setPrimary` | `{ domainId: string \| null }`                                   | `{ primary: Domain \| null }` | `canManage`                 |
| `lookup`     | `{ hostname }`                                                   | `HostnameMatch \| null`       | Server only                 |
| `getPrimary` | `{ orgId: string \| null }`                                      | `Domain \| null`              | Server only                 |

- `list` returns `{ domains, canManage, subdomainZone, customDomains, maxPerOrg }`: the organization's domains in the
  order they were added, whether the caller can manage them, the zone for subdomains or `null`, and whether custom
  domains are on. A settings screen needs nothing else.
- A `Domain` has `id`, `hostname`, `kind`, `status`, `certificate`, `primary`, `records`, `error`, `createdAt`,
  `lastCheckedAt`, `nextCheckAt` and `verifiedAt`.
- The organization is the actor's. Server code that passes neither an actor nor a request is trusted, and names the
  organization with `orgId` in the input of `add`, `check`, `remove` and `setPrimary`, such as to give a new
  organization a subdomain when it signs up. A call with an actor that names another organization gets `FORBIDDEN`.
- A domain id from another organization gets `NOT_FOUND`, the same as one that doesn't exist.

### Errors

Errors are `DomainsError`s:

| Code              | Status | When                                                                                           |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED` | 401    | Nobody is signed in                                                                            |
| `FORBIDDEN`       | 403    | `canManage` refuses, or an actor names another organization                                    |
| `NOT_FOUND`       | 404    | The domain doesn't exist, or belongs to another organization                                   |
| `INVALID_INPUT`   | 400    | A label or hostname breaks the rules, a kind the app doesn't offer, or the provider refuses it |
| `CONFLICT`        | 409    | The hostname is taken, or the domain to make primary isn't `active`                            |
| `LIMIT_EXCEEDED`  | 400    | Past `maxPerOrg` or `subdomains.maxPerOrg`, or the provider's quota                            |
| `RATE_LIMITED`    | 429    | `check` within 10 seconds of the domain's last check                                           |
| `PROVIDER_ERROR`  | 502    | The provider couldn't be reached or is failing                                                 |

Errors from the provider other than those it reports as unavailable, refused or over quota, such as a bad API token,
aren't `DomainsError`s, so the handler answers 500 and they reach `onError` for the app's operators.

## Adding a domain

1. The input is checked against the [rules](#hostname-rules) and the organization's limits.
2. A `domain` row is written for the hostname, `pending`, with `checkingSince` and `nextCheckAt` set. Its unique
   hostname claims it before anything reaches the provider. A subdomain is written `active` instead, with its
   certificate `active`, no records and no checks.
3. For a custom domain, the provider creates the hostname and returns its id, status and records, which are saved on the
   row with the first DNS check. When the provider fails, the row is removed and the error returned, so nothing is left
   half-added.
4. `domain.added` is emitted, and for a custom domain the first scheduled check (see [rechecks](#scheduled-rechecks)).
5. When the domain is `active` and the organization has no primary domain, it becomes the primary one, with
   `primary.changed`.

A provider asked to create a hostname it already has returns the one it has, so a row whose provider id was never saved,
such as after a crash between the two writes, gets it on its next check.

## Showing the DNS records

Each domain's `records` lists what the customer adds at their DNS provider:

| Purpose       | Type  | Name                             | Value                 | When                                            |
| ------------- | ----- | -------------------------------- | --------------------- | ----------------------------------------------- |
| `routing`     | CNAME | the hostname                     | the provider's target | Always, for custom domains                      |
| `ownership`   | TXT   | `_cf-custom-hostname.<hostname>` | a token               | Until the provider verifies the hostname        |
| `certificate` | TXT   | `_acme-challenge.<hostname>`     | a token               | When the provider validates certificates by TXT |

Each record has `type`, `name`, `value`, `purpose` and `found`: `true` or `false` from the last check, or `null` before
the first one or when the lookup failed. The routing record is the one a customer must add. With the Cloudflare
adapter's default HTTP validation, the ownership record is optional: it lets the hostname verify before traffic moves,
such as when moving from another provider. The settings screen shows each record with a copy button and whether it was
found, and the domain's `error` in words.

## Checking records

A check of a custom domain:

1. Asks the provider for the hostname, creating it when the row has no provider id or the provider no longer has it.
2. Asks the provider to restart validation when it reports the hostname `moved`, that is no longer pointing at the app,
   or its certificate `failed`, so a fixed record gets a fresh try.
3. Looks up every record with `dns`. A TXT record is found when any of the name's TXT values equals the token. The
   routing record is found when the hostname's CNAME is the target, ignoring case and a trailing dot, or, where the
   customer's DNS flattens CNAMEs, when the hostname's A or AAAA addresses include one of the target's.
4. Saves the status, certificate, records, error and `lastCheckedAt`. A domain that became `active` gets `verifiedAt`,
   no next check, `domain.verified`, and becomes primary when the organization has none. A change of status emits
   `domain.status.changed`.

`dnsOverHttps()` asks Cloudflare's resolver, `https://cloudflare-dns.com/dns-query`, with its JSON API; pass `url` for
another resolver and `fetch` for tests. A name that doesn't exist has no records. A lookup that fails leaves `found`
`null` and doesn't fail the check.

A check of a subdomain changes nothing and returns it.

### Check now

`check` runs a check at once, for the "Check now" button. It also starts checking over: `attempts` goes back to 0,
`checkingSince` to now and the domain gets a new schedule, so a `failed` domain is checked for another 7 days and an
`active` one that stopped being ready goes back to `pending` with a schedule. A second `check` of the same domain within
10 seconds of its last check gets `RATE_LIMITED`, which keeps a held-down button from calling the provider many times a
second.

### Scheduled rechecks

A `pending` custom domain is checked on a schedule that backs off, close to the provider's own:

| Check | 1     | 2     | 3     | 4      | 5      | 6      | 7   | 8   | 9 and later   |
| ----- | ----- | ----- | ----- | ------ | ------ | ------ | --- | --- | ------------- |
| After | 1 min | 2 min | 5 min | 10 min | 15 min | 30 min | 1 h | 2 h | every 4 hours |

The schedule runs on [deferred events](../../../core/better-apps/README.md#events). Each domain being checked has one
`check.scheduled` event in the outbox, emitted with `later: true`, carrying the domain id and its `checkToken`. Every
`app.deliverEvents()` run delivers it to domains' own subscriber, which:

- stops when the domain is gone or its `checkToken` is no longer the event's, since a newer schedule replaced it;
- emits the event again for the next run when `nextCheckAt` hasn't come yet;
- otherwise checks the domain, saves the result only while its `checkToken` is still the event's, and emits the event
  again while the domain is still `pending`, with `nextCheckAt` set from the table above.

A domain still `pending` 7 days after `checkingSince` becomes `failed`, with an error that says checking stopped and to
fix the records and check again, which `check` does for another 7 days. Cloudflare stops validating a hostname after 7
days as well.

Checks happen only when `app.deliverEvents()` runs, so call it from a scheduled job, such as a Worker's cron trigger
every minute. A check that throws, such as when the provider can't be reached, leaves its event in the outbox for the
core's retry. Subscribing to its own event needs the core's outbox table, which `better-apps generate` adds.

`active` domains aren't rechecked on a schedule. A domain whose CNAME is later removed stops receiving traffic anyway;
"Check now" shows what changed.

## Removing a domain

`remove` deletes the hostname at the provider first, so a failure there keeps the row and the call can be repeated. A
hostname the provider no longer has counts as deleted. Then the row goes, with `domain.removed`, and `primary.changed`
with no domain when it was the primary one. The organization then has no primary domain until one is chosen. Removing a
domain that's already gone returns `removed: false`.

## Primary domain

Each organization has at most one primary domain, the one other features use to build links, such as short links.

- `setPrimary({ domainId })` makes an `active` domain primary, in one batch that clears the old one. A domain that isn't
  `active` returns `CONFLICT`. `setPrimary({ domainId: null })` leaves the organization without one.
- The unique `primaryOf` field holds the organization's id on its primary domain and `null` on the others, so the
  database refuses a second primary even when two changes race; the losing call returns `CONFLICT`.
- The first domain to become `active` in an organization without a primary domain becomes primary.
- A primary domain that stops being `active` stays primary, so links keep their hostname; `getPrimary` and `lookup`
  report its status.
- `primary.changed` carries the organization and the new primary domain, or `null`.

## Hostname lookup

Features that serve customers' domains, such as short links, call the server-only `lookup`:

```ts
const match = await app.api.domains.lookup({ hostname: new URL(request.url).hostname })
// { domainId, orgId, hostname, kind, status, verified, primary } or null
```

- The hostname is normalized the same way as when adding, and a port is ignored, so `Links.Acme.com:443` matches
  `links.acme.com`.
- It reads one row by the unique hostname index, so it's one indexed query per call.
- `orgId` is `null` in an app without organizations. `verified` is `true` when the domain is `active`. A caller should
  serve only verified domains.
- Anyone's request can trigger it, since it takes only a hostname, but it's server only, so browsers can't list which
  hostnames exist.
- `getPrimary({ orgId })` returns an organization's primary domain, or `null`.

## Events

| Event                   | Data                  | When                                                      |
| ----------------------- | --------------------- | --------------------------------------------------------- |
| `domain.added`          | `{ domain }`          | A domain was added                                        |
| `domain.verified`       | `{ domain }`          | A custom domain became `active`                           |
| `domain.status.changed` | `{ domain, from }`    | A domain's status changed, including to `active`          |
| `domain.removed`        | `{ domain }`          | A domain was removed, or taken over after it failed       |
| `primary.changed`       | `{ orgId, domain }`   | The organization's primary domain changed, or it has none |
| `check.scheduled`       | `{ domainId, token }` | Domains' own, for its schedule of checks                  |

`domain` is a `DomainSummary`: `id`, `orgId` (`null` in an app without organizations), `hostname`, `kind`, `status` and
`primary`. A feature that caches lookups, such as short links, can drop a hostname on `domain.removed` and
`domain.status.changed`.

## Permissions

- Signed-in members see their organization's domains with `list`. Signed-out visitors get `UNAUTHENTICATED`.
- `canManage({ actor, orgId })` says who adds, checks and removes domains and chooses the primary one. By default it's
  people with the `owner` or `admin` role. Identity providers name roles differently, such as Clerk's `org:admin`, so
  most apps pass their own.
- `lookup` and `getPrimary` are server only.

## Where the provider plugs in

`custom.provider` is the `hostnames` slot. Adapters are named `hostnames-<provider>`, such as
`@better-apps/hostnames-cloudflare`, and implement `HostnameProvider`:

```ts
interface HostnameProvider {
  create(hostname: string): Promise<ProviderHostname>
  get(id: string): Promise<ProviderHostname | null>
  refresh(id: string): Promise<ProviderHostname>
  remove(id: string): Promise<void>
}

interface ProviderHostname {
  id: string
  hostname: string
  status: "pending" | "active" | "moved" | "blocked"
  certificate: "pending" | "active" | "failed"
  records: { type: "CNAME" | "TXT"; name: string; value: string; purpose: "routing" | "ownership" | "certificate" }[]
  errors: string[]
}
```

- `create` returns the provider's hostname when it already has one with that name, so it's safe to repeat.
- `get` returns `null` for a hostname the provider doesn't have. `remove` succeeds for one.
- `refresh` restarts the provider's validation of the hostname and its certificate.
- An adapter throws `HostnameProviderError` with `INVALID_HOSTNAME`, `QUOTA_EXCEEDED` or `UNAVAILABLE` for what a person
  can act on or retry. Domains turns them into `INVALID_INPUT`, `LIMIT_EXCEEDED` and `PROVIDER_ERROR`.

`localHostnames({ target, verifyAfter })` keeps hostnames in memory and has its own DNS, `local.dns`, to pass as `dns`.
A hostname it creates is `pending` until it has been read `verifyAfter` times, 1 by default, then its records are
published in its DNS and it's `active`. `verifyAfter: Infinity` keeps it `pending` until a test calls `activate`,
`block` or `move`. It's for tests and local development, never production.

## One-time Cloudflare setup

Custom hostnames need the app's Worker and the SaaS zone in the same Cloudflare account, which means
[Void's direct Cloudflare target](../../../../docs/deploy-plan.md). Do these once per app, in the zone the app runs on,
such as `yourapp.com`:

1. **Enable Cloudflare for SaaS** on the zone: SSL/TLS, then Custom Hostnames, then enable it. The zone needs a plan
   that includes it.
2. **Create the fallback origin.** Add a proxied, originless record, `proxy-fallback.yourapp.com AAAA 100::`, and set it
   as the fallback origin on the Custom Hostnames page, or with `PUT /zones/{zone_id}/custom_hostnames/fallback_origin`.
   Wait for it to show **Active**.
3. **Create the CNAME target** customers point at: a proxied `customers.yourapp.com CNAME proxy-fallback.yourapp.com`.
   Pass it to the adapter as `target`. It's in `defaultReservedSubdomains`, so no organization can take it as a
   subdomain.
4. **Route all traffic to the Worker** with a Workers route `*/*` on the zone. It catches custom hostname traffic as
   well as the app's own hostnames. Add routes with no Worker for hostnames that should skip it.
5. **Set up subdomains**, if the app offers them: a proxied wildcard record, `*.yourapp.com AAAA 100::`, which the `*/*`
   route serves. Universal SSL's certificate covers `*.yourapp.com`, one level deep. Pass `yourapp.com` as
   `subdomains.zone`.
6. **Create an API token** scoped to the zone with **SSL and Certificates: Edit**, which covers creating, reading,
   editing and deleting custom hostnames. Store it as a secret, such as `CLOUDFLARE_API_TOKEN`, with the zone's id as
   `CLOUDFLARE_ZONE_ID`.
7. **Run checks on a schedule**: a cron trigger on the Worker that calls `app.deliverEvents()`, such as every minute.

Never add the zone name itself, `yourapp.com`, as a custom hostname; Cloudflare refuses it.
