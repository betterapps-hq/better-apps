# Domains spec

`@better-apps/domains` lets each organization in an app serve it on its own hostnames: a subdomain of the app's zone,
such as `acme.yourapp.com`, or a custom domain the organization owns, such as `links.acme.com`. It stores each domain,
shows the DNS records a customer must add, gives a custom domain to the organization that proves it owns it, checks it
until it's ready and daily after that, and answers which organization a hostname belongs to, for features such as short
links that serve customers' domains.

The provider that issues certificates and routes custom domains plugs into one slot, `hostnames`. The
[Cloudflare adapter](../../../adapters/hostnames-cloudflare/README.md) fills it with Cloudflare for SaaS.
`localHostnames()` fills it for tests and local development.

## Kinds of domain

| Kind        | Example            | Needs from the customer                     | Needs from the provider               |
| ----------- | ------------------ | ------------------------------------------- | ------------------------------------- |
| `subdomain` | `acme.yourapp.com` | Nothing                                     | Nothing                               |
| `custom`    | `links.acme.com`   | A TXT record proving ownership, and a CNAME | A custom hostname and its certificate |

Subdomains run off a wildcard DNS record and a wildcard certificate on the app's own zone, set up once (see
[setup](#one-time-cloudflare-setup)). Adding one makes no call to the provider and it's ready at once. A label is one
level deep, since a wildcard certificate covers only one level: `acme.yourapp.com`, never `eu.acme.yourapp.com`.

A custom domain first proves its organization owns the hostname, with a TXT record holding a token only that domain
knows. Then it's registered with the provider, which validates it and issues its certificate. The customer points the
hostname at the provider with the records the provider's `routing` asks for, a CNAME to its target with Cloudflare. Apex
domains, such as `acme.com`, can't hold a CNAME, so with Cloudflare they work only where the customer's DNS flattens
CNAMEs; the check then compares addresses (see [checking records](#checking-records)).

## Configuration

```ts
domains({
  subdomains: { zone: "yourapp.com", reserved: [...defaultReservedSubdomains, "links"], minLength: 3, maxPerOrg: 1 },
  custom: {
    provider: cloudflareHostnames({ apiToken, zoneId, zone: "yourapp.com", target: "customers.yourapp.com" }),
    ownershipLabel: "_verify"
  },
  dns: dnsOverHttps(),
  canManage: ({ actor }) => actor.roles.includes("owner"),
  maxPerOrg: 10
})
```

| Option                  | Default                     | What it does                                                                               |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `subdomains.zone`       | none                        | The zone subdomains go under. Without `subdomains`, organizations can't add them           |
| `subdomains.reserved`   | `defaultReservedSubdomains` | Labels nobody can take. Replaces the defaults, so spread them to add to the list           |
| `subdomains.minLength`  | 3                           | The shortest label, from 1 to 63                                                           |
| `subdomains.maxPerOrg`  | 1                           | How many subdomains one organization can have                                              |
| `custom.provider`       | none                        | The `hostnames` slot. Without `custom`, organizations can't add custom domains             |
| `custom.ownershipLabel` | `_verify`                   | The first label of the ownership record's name, an underscore label such as `_acme-verify` |
| `dns`                   | `dnsOverHttps()`            | Looks up the records a customer added                                                      |
| `canManage`             | the `owner` or `admin` role | Who in an organization can add, check and remove its domains and choose its primary one    |
| `maxPerOrg`             | 10                          | How many domains of both kinds one organization can have, from 1 to 100                    |

At least one of `subdomains` and `custom` is required. `domains()` throws for a zone that isn't a valid hostname, an
ownership label that doesn't start with an underscore, or a limit out of range.

Apps without organizations, where every actor's `orgId` is `null`, have one set of domains for the whole app, stored
with the organization `""`.

## Table

One `domain` row for each hostname an organization added. Several organizations may add the same custom hostname, but
only one domain holds it, through the unique `claimedHostname`.

| Field             | Type                   | Holds                                                                                                                 |
| ----------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`              | string                 |                                                                                                                       |
| `orgId`           | string                 | The organization, or `""` in an app without organizations                                                             |
| `hostname`        | string                 | Lowercase ASCII, with international names in punycode, no trailing dot                                                |
| `slot`            | number                 | Its place among its organization's domains, below `maxPerOrg` (see [adding a domain](#adding-a-domain))               |
| `kindSlot`        | number                 | Its place among its organization's domains of its kind, below `subdomains.maxPerOrg` for subdomains                   |
| `claimedHostname` | string or null, unique | The hostname while this domain holds it: a subdomain at once, a custom domain once it's proven                        |
| `ownershipToken`  | string or null         | The value of a custom domain's ownership record, random for each domain. `null` for subdomains                        |
| `kind`            | string                 | `subdomain` or `custom`                                                                                               |
| `status`          | string                 | `pending`, `active` or `failed`                                                                                       |
| `certificate`     | string                 | `pending`, `active`, `stalled` or `failed`                                                                            |
| `records`         | json                   | The DNS records the customer must add, each with what the last check found                                            |
| `providerId`      | string or null         | The provider's id for the hostname, once it's registered                                                              |
| `releasingAt`     | date or null           | When it last started deleting its hostname at the provider (see [removing a domain](#removing-a-domain))              |
| `primaryOf`       | string or null, unique | The `orgId` when this is the organization's primary domain, so each has at most one                                   |
| `error`           | string or null         | Why the domain isn't ready, from the provider or the DNS check, for people to read                                    |
| `attempts`        | number                 | Scheduled checks since checking last started                                                                          |
| `checkToken`      | string or null         | The current schedule of checks, so an older schedule stops (see [rechecks](#scheduled-rechecks))                      |
| `checkingSince`   | date or null           | While pending, when checking started: when the domain was added, the last "check now", or when it stopped being ready |
| `nextCheckAt`     | date or null           | When the next scheduled check is due, or `null` when none is                                                          |
| `lastCheckedAt`   | date or null           | When it was last checked                                                                                              |
| `verifiedAt`      | date or null           | When it last became `active`                                                                                          |
| `createdAt`       | date                   |                                                                                                                       |
| `createdBy`       | string or null         | The user who added it                                                                                                 |

An index on `orgId` and `createdAt` lists an organization's domains in the order they were added. A unique index on
`orgId` and `hostname` keeps an organization from adding a hostname twice. Unique indexes on `orgId` and `slot`, and on
`orgId`, `kind` and `kindSlot`, hold the organization's limits.

A domain is `active` when it's ready for traffic. A subdomain is `active` from the start. A custom domain is `active`
when it holds its hostname and the provider reports the hostname and its certificate active. It stays `active` while the
provider serves the hostname with a certificate that still works, as when a renewal is under way or stalled, but not
once the certificate failed, such as when it expired. It's `failed` when the provider blocks the hostname, when it
wasn't ready after 7 days of checks, or when another organization proved it owns the hostname. Anything else is
`pending`.

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
`internal`, `root`, `system`, `security`, `settings`, `customers` and `proxy-fallback`.

A subdomain holds `<label>.<zone>` from the moment it's added, so a label one organization holds is taken for every
other. Two organizations adding the same label at the same moment can't both get it: the unique `claimedHostname`
refuses the second with `CONFLICT`.

### Custom hostnames

The hostname is trimmed and parsed as a URL's host, so `HTTPS://Links.Acme.com/` becomes `links.acme.com` and
`bücher.example` becomes `xn--bcher-kva.example`. It must then:

- have at least two labels, each 1 to 63 characters of `a` to `z`, `0` to `9` and `-`, not starting or ending with `-`,
  and be at most 253 characters;
- not be an IP address, `localhost`, or end in `.localhost`, `.local`, `.test`, `.example`, `.invalid` or `.internal`;
- not be the subdomain zone or under it, which subdomains are for;
- not be the provider's `zone` or under it, which holds the app's own hostnames, such as its CNAME target.

Wildcards, ports, paths and credentials are refused. The provider may refuse a hostname too, which fails the domain with
the provider's reason when it's registered.

### Proving ownership

Anyone can type any hostname, so a custom domain holds nothing until its organization proves it controls the hostname's
DNS. Each custom domain gets a random token and asks for a TXT record, `<ownershipLabel>.<hostname>`, such as
`_verify.links.acme.com`, with the token as its value. Only someone who can add records for the hostname can add it.

- Adding a hostname another organization added returns a new `pending` domain, with its own token. A domain that hasn't
  proven ownership blocks nobody, and nothing about it reaches the provider, so it costs no custom hostname.
- The first check that finds a domain's ownership record takes the hostname for it, through the unique
  `claimedHostname`, and only then registers it with the provider.
- When another domain holds the hostname, that domain's own ownership record is looked up. If it's still in place, the
  hostname stays with its holder, and the new domain says the other organization's record must go first. If it's gone,
  the hostname passes to the organization that just proved it owns it: the old domain becomes `failed`, loses its
  primary place and its provider id, and says another organization proved it owns the domain. The provider's hostname
  stays for the new holder, which registering it again returns.
- A holder that's deleting the hostname at the provider, as when it's being removed, keeps it until that's done, and the
  new domain says the other organization is giving up the domain. Its scheduled checks try again.
- A CNAME left behind after a domain was removed proves nothing, since the CNAME target is the same for every
  organization. Only the TXT record does.
- The ownership record is needed only to take the hostname. A customer may remove it afterwards, but then another
  organization that proves it owns the hostname can take it.

Adding a hostname the same organization added returns `CONFLICT`.

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
| `removeAll`  | `{ orgId: string \| null }`                                      | `{ removed: number }`         | Server only                 |

- `list` returns `{ domains, canManage, subdomainZone, customDomains, maxPerOrg }`: the organization's domains in the
  order they were added, whether the caller can manage them, the zone for subdomains or `null`, and whether custom
  domains are on. A settings screen needs nothing else.
- A `Domain` has `id`, `hostname`, `kind`, `status`, `certificate`, `primary`, `records`, `error`, `createdAt`,
  `lastCheckedAt`, `nextCheckAt` and `verifiedAt`.
- The organization is the actor's. Server code that passes neither an actor nor a request is trusted, and names the
  organization with `orgId` in the input of `list`, `add`, `check`, `remove` and `setPrimary`, such as to give a new
  organization a subdomain when it signs up. A call with an actor that names another organization gets `FORBIDDEN`.
- A domain id from another organization gets `NOT_FOUND`, the same as one that doesn't exist.

### Errors

Errors are `DomainsError`s:

| Code              | Status | When                                                                                              |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED` | 401    | Nobody is signed in                                                                               |
| `FORBIDDEN`       | 403    | `canManage` refuses, or an actor names another organization                                       |
| `NOT_FOUND`       | 404    | The domain doesn't exist, or belongs to another organization                                      |
| `INVALID_INPUT`   | 400    | A label or hostname breaks the rules, or a kind the app doesn't offer                             |
| `CONFLICT`        | 409    | The organization already added the hostname, the subdomain is taken, or the domain isn't `active` |
| `LIMIT_EXCEEDED`  | 400    | Past `maxPerOrg` or `subdomains.maxPerOrg`                                                        |
| `RATE_LIMITED`    | 429    | `check` within 10 seconds of the domain's last check                                              |
| `PROVIDER_ERROR`  | 502    | The provider couldn't be reached or is failing                                                    |

A provider that refuses a hostname or is out of quota fails the domain with its reason instead. Errors from the provider
other than those it reports as unavailable, refused or over quota, such as a bad API token, aren't `DomainsError`s, so
the handler answers 500 and they reach `onError` for the app's operators.

## Adding a domain

1. The input is checked against the [rules](#hostname-rules), the organization's limits, and the hostnames the
   organization already added. The domain takes the lowest free `slot` among the organization's domains and the lowest
   free `kindSlot` among those of its kind. Each is unique in the organization, so adds that run at once can't pass
   `maxPerOrg` or `subdomains.maxPerOrg`: the database refuses a second domain in a place, and the add that lost looks
   again, up to three tries, finding the next place or the limit.
2. A subdomain is written `active`, holding its hostname, with its certificate `active`, no records and no checks, with
   `domain.added`. When the organization has no primary domain, it becomes the primary one, with `primary.changed`.
3. A custom domain is written `pending`, with a new ownership token, its records unchecked and `nextCheckAt` a minute
   away. Its first `check.scheduled` event, due then, and `domain.added` are written in the same batch, so a domain is
   never left without a schedule. Nothing is checked yet, since no DNS holds the new token, and nothing reaches the
   provider.

## Showing the DNS records

Each custom domain's `records` lists what the customer adds at their DNS provider:

| Purpose         | Type             | Name                                                     | Value               | When                                                      |
| --------------- | ---------------- | -------------------------------------------------------- | ------------------- | --------------------------------------------------------- |
| `routing`       | CNAME, A or AAAA | the hostname                                             | what `routing` says | Always                                                    |
| `ownership`     | TXT              | `<ownershipLabel>.<hostname>`                            | the domain's token  | Until the domain holds its hostname                       |
| `prevalidation` | TXT              | the provider's, such as `_cf-custom-hostname.<hostname>` | a token             | Once registered, until the provider verifies the hostname |
| `certificate`   | TXT              | the provider's, such as `_acme-challenge.<hostname>`     | a token             | When the provider validates certificates by TXT           |

Each record has `type`, `name`, `value`, `purpose` and `found`: `true` or `false` from the last check, or `null` before
the first one or when the lookup failed. The routing and ownership records are the ones a customer must add. A
prevalidation record lets the provider verify the hostname before traffic moves, such as when moving from another
provider. The settings screen shows each record with a copy button and whether it was found, and the domain's `error` in
words.

## Checking records

A check of a custom domain:

1. When the domain doesn't hold its hostname, looks up its ownership record. Once it's found, the domain takes the
   hostname, as [proving ownership](#proving-ownership) describes. Until then, it looks up the routing records to show,
   and asks for the ownership record.
2. For a domain that holds its hostname, asks the provider for it, registering it when the domain has no provider id or
   the provider no longer has it. Registering a hostname the provider already has returns it, so a check that stopped
   before saving the provider's id gets it the next time.
3. Asks the provider to restart validation when it reports the hostname `moved`, that is no longer pointing at the app,
   or its certificate `stalled` or `failed`, so a fixed record gets a fresh try.
4. Looks up every record with `dns`. A TXT record is found when any of the name's TXT values equals the token. An A or
   AAAA record is found when the name has the address. A CNAME is found when the hostname's CNAME is the target,
   ignoring case and a trailing dot, or, where the customer's DNS flattens CNAMEs, when the hostname's addresses include
   one of the target's.
5. Saves the status, certificate, records, error, `lastCheckedAt` and the next check, only while the domain still holds
   or lacks its hostname as the check found, and, for a scheduled check, while its schedule is still the current one. A
   domain that became `active` gets `verifiedAt`, `domain.verified`, and becomes primary when the organization has none.
   A change of status emits `domain.status.changed`. Events are emitted only once the save has changed the domain.

The provider reporting the hostname and its certificate active makes the domain `active`. A domain that's already
`active` stays so while the provider serves the hostname and renews its certificate: a certificate being renewed reports
a pending state while the current one still serves, and a renewal mustn't take the domain's links down. This holds
whether or not the routing records are found: a customer whose own Cloudflare zone proxies the CNAME answers lookups
with its own addresses, and a prevalidated hostname is verified before traffic moves. The routing records' `found` still
shows what DNS answers.

A renewal can stall, such as when a CAA record blocks the provider's certificate authority, while the current
certificate still serves until it expires. The provider reports the certificate `stalled`. The check asks for it again,
and the domain stays `active` with an error, the provider's reason or one saying it asked again, so the organization can
fix the record in time. The error stays until the certificate is issued.

A certificate that failed, such as one that expired, no longer serves. The check asks for it again, and the domain
becomes `pending`, with the provider's reason or one saying it asked again, until the certificate is issued. A domain
that was never `active` becomes `pending` the same way when its first certificate stalls.

A provider that refuses the hostname when it's registered fails the domain with its reason. One that can't be reached
leaves the domain as it was: `check` returns `PROVIDER_ERROR`, and a scheduled check stays in the outbox for the core's
retry.

`dnsOverHttps()` asks Cloudflare's resolver, `https://cloudflare-dns.com/dns-query`, with its JSON API; pass `url` for
another resolver and `fetch` for tests. A name that doesn't exist has no records. A lookup that fails leaves `found`
`null` and doesn't fail the check.

A check of a subdomain changes nothing and returns it.

### Check now

`check` runs a check at once, for the "Check now" button. It also starts checking over: `attempts` goes back to 0,
`checkingSince` to now and the domain gets a new schedule, so a `failed` domain is checked for another 7 days. A second
`check` of the same domain within 10 seconds of its last check gets `RATE_LIMITED`, which keeps a held-down button from
calling the provider many times a second.

### Scheduled rechecks

A `pending` custom domain is checked on a schedule that backs off, close to the provider's own:

| Check | 1     | 2     | 3     | 4      | 5      | 6      | 7   | 8   | 9 and later   |
| ----- | ----- | ----- | ----- | ------ | ------ | ------ | --- | --- | ------------- |
| After | 1 min | 2 min | 5 min | 10 min | 15 min | 30 min | 1 h | 2 h | every 4 hours |

An `active` custom domain is checked again every 24 hours. One that stopped being ready, such as when the provider
reports it `moved`, becomes `pending`, with `domain.status.changed`, and starts the schedule above. `lookup` then
reports it unverified. One still `pending` 7 days later becomes `failed`.

The schedule runs on [deferred events](../../../core/better-apps/README.md#events). Each custom domain being checked has
one `check.scheduled` event in the outbox, carrying the domain id and its `checkToken`, emitted with `availableAt` set
to the domain's `nextCheckAt`. From `add` and `check`, it's written with the save that set it. From a scheduled check,
the outbox writes it as it removes the event it delivered, so a run that stops after saving the check and before then
gets that event again. The outbox doesn't read the event before it's due, so a scheduled check costs nothing until then.
The first `app.deliverEvents()` run after that delivers it to domains' own subscriber, which:

- stops when the domain is gone or its `checkToken` is no longer the event's, since a newer schedule replaced it, or the
  domain failed;
- emits the event again for the domain's `nextCheckAt` when that's still to come, as when a run stopped after saving a
  check but before the outbox heard;
- otherwise checks the domain, and emits the event again for its next check while the domain is `pending` or `active`.

A domain still `pending` 7 days after `checkingSince` becomes `failed`, with an error that says checking stopped and to
fix the records and check again, which `check` does for another 7 days. A failed domain that held a hostname at the
provider is removed there, so it costs nothing, and keeps its hostname in the app; checking it again registers it again.
The check holds the domain first, as a [removal](#removing-a-domain) does, so the hostname can't be taken over while
it's deleted. Cloudflare stops validating a hostname after 7 days as well.

Checks happen only when `app.deliverEvents()` runs, so call it from a scheduled job, such as a Worker's cron trigger
every minute. A check that throws, such as when the provider can't be reached, leaves its event in the outbox for the
core's retry. Subscribing to its own event needs the core's outbox table, which `better-apps generate` adds.

## Removing a domain

`remove` deletes the hostname at the provider first, when the domain registered it, so a failure there keeps the row and
the call can be repeated. A hostname the provider no longer has counts as deleted. Then the row goes, with
`domain.removed`, and `primary.changed` with no domain when it was the primary one. The organization then has no primary
domain until one is chosen. Removing a domain that's already gone returns `removed: false`, with no events.

Before it deletes the hostname at the provider, `remove` holds the domain: one write sets `releasingAt` and returns the
domain's provider id as it is then, not as the removal first read it. For 10 minutes after, no other organization can
take the hostname over, so the provider never gives a new holder the hostname being deleted. A domain whose hostname
passed to another organization after the removal read it no longer holds the hostname, so its removal leaves the
provider's hostname to the new holder. A removal that fails at the provider keeps the hostname until those 10 minutes
are up, and calling it again holds the domain again.

A check that registered the hostname with the provider while the domain was being removed finds no domain to save to. It
then deletes that hostname at the provider, unless another domain holds the hostname, such as one that took it over or a
newer check of the same domain that saved it.

`removeAll({ orgId })`, server only, removes every domain of an organization the same way and returns how many it
removed. Call it when an organization is deleted, such as from the identity provider's webhook for deleted
organizations, so its hostnames are free and stop costing anything at the provider. A provider failure stops it with the
domains removed so far gone, so calling it again finishes the rest.

## Primary domain

Each organization has at most one primary domain, the one other features use to build links, such as short links.

- `setPrimary({ domainId })` makes an `active` domain primary, in one batch that clears the old one. A domain that isn't
  `active` returns `CONFLICT`, and so does one that stopped being `active` or was removed while the call ran, which
  leaves the organization without a primary domain. `setPrimary({ domainId: null })` leaves the organization without
  one.
- The unique `primaryOf` field holds the organization's id on its primary domain and `null` on the others, so the
  database refuses a second primary even when two changes race; the losing call returns `CONFLICT`.
- The first domain to become `active` in an organization without a primary domain becomes primary.
- A primary domain that stops being `active` stays primary, so links keep their hostname; `getPrimary` and `lookup`
  report its status. One that another organization takes over loses its primary place.
- `primary.changed` carries the organization and the new primary domain, or `null`.

## Hostname lookup

Features that serve customers' domains, such as [short links](../../short-links/docs/spec.md#organizations-domains),
call the server-only `lookup`:

```ts
const match = await app.api.domains.lookup({ hostname: new URL(request.url).hostname })
// { domainId, orgId, hostname, kind, status, verified, primary } or null
```

- The hostname is normalized the same way as when adding, and a port is ignored, so `Links.Acme.com:443` matches
  `links.acme.com`.
- It returns the domain that holds the hostname, read by the unique `claimedHostname` index, so it's one indexed query
  per call. A hostname no organization has proven it owns has no match.
- `orgId` is `null` in an app without organizations. `verified` is `true` when the domain is `active`. A caller should
  serve only verified domains.
- Anyone's request can trigger it, since it takes only a hostname, but it's server only, so browsers can't list which
  hostnames exist.
- `getPrimary({ orgId })` returns an organization's primary domain, or `null`.

## Hosts for other features

A feature that serves organizations' domains needs to know whose host a request is on and where an organization's links
are shared. [Short links](../../short-links/docs/spec.md#organizations-domains) take both as `hosts`, without importing
domains. `domainHosts` builds them from `lookup`, `getPrimary` and `list`:

```ts
const appUrl = "https://app.yourapp.com"
const linkHosts = domainHosts({ url: appUrl, hostnames: ["www.yourapp.com"] })
shortLinks({ baseUrl: appUrl, hosts: linkHosts.hosts })
// Once the app is created:
linkHosts.connect(app.api.domains)
```

| Option        | Default | What it does                                                                                           |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `url`         | none    | The app's own URL. Its hostname is the app's, and domains' origins use its scheme and port             |
| `hostnames`   | none    | More hostnames that are the app's own, such as `localhost` beside `127.0.0.1`, without a port          |
| `localSuffix` | none    | For local development with `localHostnames()` only: answers custom domains under this `localhost` name |

- `domainHosts` throws for a `url` that isn't an `http` or `https` URL, such as `localhost:3000` without its scheme. Its
  hostname is normalized like the others, so a trailing dot doesn't matter.
- Short links' `baseUrl` must be on `url`'s host or one in `hostnames`. Links that no organization's domain opens are
  shared on `baseUrl`, and only the app's own hosts open them, so a `baseUrl` elsewhere would open none. Nothing can
  check this, since the two are separate features' options, so pass both from one constant.
- It throws for a `hostnames` entry that isn't a hostname, such as `localhost:4190` or `::1`, which could never match.
  Write an IPv6 address in brackets, as `[::1]`.
- `hosts.resolve({ hostname })` normalizes the hostname as `lookup` does, so case, a trailing dot and a port don't
  matter, and answers `null` without a lookup for one no domain could hold. It returns `"app"` for the app's own
  hostnames without a lookup. Otherwise it looks the hostname up and returns `{ orgId }` for a `verified` domain,
  `"app"` for one in an app without organizations, and `null` for a domain that isn't `active` or a hostname no domain
  holds.
- `hosts.origin({ orgId })` returns the origin of the organization's primary domain once it's `active`, on `url`'s
  scheme and port, such as `https://links.acme.com`. Without an `active` primary domain, such as after it's removed or
  while it's failing, it's the first `active` domain the organization added, which still opens its links, read with
  `list`. With no `active` domain, it's `null`, which means the app's own.
- Features are created before the app, and `app.api.domains` exists only once it is, so the app calls
  `connect(app.api.domains)` then. Until it does, both throw an error that says so, rather than every domain answering
  as unknown. A later `connect` replaces the earlier one.

### Custom domains on your machine

Browsers can't reach a customer's domain, such as `go.acme.com`, on a developer's machine, and domains refuses custom
hostnames under `.localhost` (see [custom hostnames](#custom-hostnames)). Browsers send every name under `localhost` to
the machine, so with `localSuffix: "yourapp.localhost"` the app answers a custom domain at
`go.acme.com.yourapp.localhost`:

- `resolve` looks the hostname up as it is first, and answers for a subdomain there, such as `acme.yourapp.localhost`
  for the zone `yourapp.localhost`. So a custom domain's alias never takes a subdomain's place, even with the suffix
  `localhost` above the zone. A subdomain never answers at an alias.
- Otherwise it strips the suffix from a hostname under it and looks the rest up, answering only for a custom domain. A
  custom domain answers only there, so `go.acme.com` itself answers `null`. An alias costs two lookups.
- `origin` adds the suffix to a primary custom domain's hostname, so links are shared where the browser reaches them.
- `domainHosts` throws for a suffix that isn't `localhost` or under it. It's for the local provider only, never
  production.

## Events

| Event                   | Data                  | When                                                                           |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------ |
| `domain.added`          | `{ domain }`          | A domain was added                                                             |
| `domain.verified`       | `{ domain }`          | A custom domain became `active`                                                |
| `domain.status.changed` | `{ domain, from }`    | A domain's status changed, including to `failed` when another one took it over |
| `domain.removed`        | `{ domain }`          | A domain was removed                                                           |
| `primary.changed`       | `{ orgId, domain }`   | The organization's primary domain changed, or it has none                      |
| `check.scheduled`       | `{ domainId, token }` | Domains' own, for its schedule of checks                                       |

`domain` is a `DomainSummary`: `id`, `orgId` (`null` in an app without organizations), `hostname`, `kind`, `status` and
`primary`. A feature that caches lookups can drop a hostname on `domain.removed` and `domain.status.changed`.

## Permissions

- Signed-in members see their organization's domains with `list`. Signed-out visitors get `UNAUTHENTICATED`.
- `canManage({ actor, orgId })` says who adds, checks and removes domains and chooses the primary one. By default it's
  people with the `owner` or `admin` role. Identity providers name roles differently, such as Clerk's `org:admin`, so
  most apps pass their own.
- A custom domain serves an organization only once it proves it owns the hostname, whatever `canManage` allows.
- Domains doesn't rate-limit its actions. Rate-limit `add`, `remove` and `check` for each organization at the app's HTTP
  layer, such as with a Workers rate limiting binding. Otherwise an organization with a DNS API could remove and add a
  proven domain again and again, and each time the provider registers and deletes a hostname, which uses up the app's
  shared provider API limit.
- `lookup`, `getPrimary` and `removeAll` are server only.

## Where the provider plugs in

`custom.provider` is the `hostnames` slot. Adapters are named `hostnames-<provider>`, such as
`@better-apps/hostnames-cloudflare`, and implement `HostnameProvider`:

```ts
interface HostnameProvider {
  readonly zone?: string
  routing(hostname: string): DnsRecord[]
  create(hostname: string): Promise<ProviderHostname>
  get(id: string): Promise<ProviderHostname | null>
  refresh(id: string): Promise<ProviderHostname>
  remove(id: string): Promise<void>
}

interface DnsRecord {
  type: "CNAME" | "TXT" | "A" | "AAAA"
  name: string
  value: string
  purpose: "routing" | "ownership" | "prevalidation" | "certificate"
}

interface ProviderHostname {
  id: string
  hostname: string
  status: "pending" | "active" | "moved" | "blocked"
  certificate: "pending" | "active" | "stalled" | "failed"
  records: DnsRecord[]
  errors: string[]
}
```

- `zone` is the app's own zone at the provider, which serves its CNAME target. Domains refuses it and hostnames in it.
- `routing` returns the records that point a hostname at the provider, such as a CNAME to its target, or A records for
  an apex domain. Domains shows them before the provider hears of the hostname.
- `records` on a `ProviderHostname` are the provider's other records, such as prevalidation and certificate TXTs.
- `active` means the provider serves the hostname: traffic reaches it, or the customer prevalidated it.
- A `certificate` is `stalled` when a new one wasn't issued in time but one issued before still serves until it expires,
  and `failed` when none serves, such as once it expired. Report a renewal under way as `pending`.
- `create` returns the provider's hostname when it already has one with that name, so it's safe to repeat.
- `get` returns `null` for a hostname the provider doesn't have. `remove` succeeds for one.
- `refresh` restarts the provider's validation of the hostname and its certificate.
- An adapter throws `HostnameProviderError` with `INVALID_HOSTNAME`, `QUOTA_EXCEEDED` or `UNAVAILABLE` for what a person
  can act on or retry. Domains fails the domain with the reason for the first two, and returns `PROVIDER_ERROR` for the
  third.

`localHostnames({ target, zone })` keeps hostnames in memory and has its own DNS, `local.dns`, to pass as `dns`, which
holds only the records `local.dns.publish` adds. Its `zone` is the target without its first label by default. Like a
real provider, a hostname it registers is `active` once its DNS points the hostname at the target, or holds the
hostname's prevalidation record, and `moved` once an active hostname stops pointing at it, until `refresh`. Like
Cloudflare, `refresh` keeps a hostname it still serves `active` while it issues the certificate again. `block`,
`holdCertificate` and `failNext` set up what tests need: `holdCertificate` sets a served hostname's certificate, which
`refresh` issues again when it's `stalled` or `failed`. It's for tests and local development, never production.

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
   Pass it to the adapter as `target`, with the zone's name as `zone`. `customers` and `proxy-fallback` are in
   `defaultReservedSubdomains`, so no organization can take them as subdomains.
4. **Route all traffic to the Worker** with a Workers route `*/*` on the zone. It catches custom hostname traffic as
   well as the app's own hostnames. Add routes with no Worker for hostnames that should skip it.
5. **Set up subdomains**, if the app offers them: a proxied wildcard record, `*.yourapp.com AAAA 100::`, which the `*/*`
   route serves. Universal SSL's certificate covers `*.yourapp.com`, one level deep. Pass `yourapp.com` as
   `subdomains.zone`.
6. **Create an API token** scoped to the zone with **SSL and Certificates: Edit**, which covers creating, reading,
   editing and deleting custom hostnames. Store it as a secret, such as `CLOUDFLARE_API_TOKEN`, with the zone's id as
   `CLOUDFLARE_ZONE_ID`.
7. **Run checks on a schedule**: a cron trigger on the Worker that calls `app.deliverEvents()`, such as every minute.
8. **Remove an organization's domains when it's deleted**: call `app.api.domains.removeAll({ orgId })` from the identity
   provider's webhook for deleted organizations.

Domains refuses the zone name itself, `yourapp.com`, and every hostname in it as custom domains, through the adapter's
`zone`.
