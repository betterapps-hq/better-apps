# @better-apps/short-links

Short links, such as `https://app.example/s/k3Jd9xQa`, to records an app owns or to any URL. A user or an organization
owns each link. A link to a record can also let anyone who has it see the record. Opening a link redirects and counts
the click. The [spec](docs/spec.md) covers the design in full.

## Usage

```ts
import { shortLinks } from "@better-apps/short-links"
import { createBetterApps } from "better-apps"

export const app = createBetterApps({
  database,
  identity,
  subjects: {
    invoice: {
      getOrgId: ({ subjectId }) => invoices.orgOf(subjectId),
      canView: ({ actor, subjectId }) => invoices.canRead(actor, subjectId)
    }
  },
  features: [
    shortLinks({
      subjects: {
        invoice: {
          url: ({ subjectId }) => `/invoices/${subjectId}`,
          canShare: ({ actor, subjectId }) => invoices.canEdit(actor, subjectId),
          grantView: true
        }
      },
      validateUrl: ({ url }) => url.protocol === "https:" || "Links must use https."
    })
  ]
})
```

Links open at `GET /s/{code}`, which `app.handler` serves. Route that path to it the way you route the actions, such as
with a catch-all route at `/s` in TanStack Start.

- `subjects` lists the subject types links can point to. The app or a feature must declare each one. `url` says where a
  record lives: a path, resolved against the link's address, or an absolute URL. It runs each time a link opens.
  `canShare` says who can make links to a record: everyone who can see it, by default. `grantView` says whether links
  may let anyone who has them see the record: `true`, a check per actor and record, or `false`, the default. Setting it
  back to `false` ends the access existing links give.
- `validateUrl({ url, actor, orgId })` checks URL targets, returning `true`, or `false` or a message to refuse one.
  Without it, any URL is allowed, but not `javascript:`, `data:`, `vbscript:` and `file:` ones.
- `canManage({ actor, orgId })` says who manages an organization's links, the ones it owns and the ones its members made
  in it, and who makes its URL links: every member, by default. Who shares records is up to `canShare`.
- `path` is where links open, `/s` by default. `baseUrl`, such as `https://go.example.com`, is where the short URLs
  actions return start, before the path and code: the request's origin, by default.
- `hosts` opens links on organizations' own domains, each only its organization's, and shares them there, with codes of
  the organization's own. It needs `baseUrl`. See [Organizations' domains](#organizations-domains).
- `codeLength` sets the length of generated codes, from 6 to 32: 8 by default.
- `cookie` names the cookie that holds access grants, `better-apps-links` by default, and sets its `maxAge` in seconds,
  30 days by default. Its `domain`, such as `example.com`, lets links on one host, such as `go.example.com`, grant
  access on another, such as `app.example.com`. Without it, the cookie stays on the link's host, and making a link that
  grants access to a record on another host fails, since the grant couldn't reach it.
- `notFound({ request, code })` answers links that don't exist, are turned off or have expired. A plain 404 page, by
  default. It isn't told which, so visitors can't tell which codes were links once.

## Owners and permissions

- `create` takes `owner: "user" | "org"`. Without one, inside an organization, a link belongs to the organization when
  its maker manages the organization's links or the link grants access, and to its maker otherwise. Outside any
  organization, it belongs to its maker. An organization's links stay when the person who made them leaves.
- Making a link needs someone signed in; server code passes an `actor`. A link to a record needs someone who can see it
  and whom `canShare` allows, and any such member can make it the organization's. An organization's URL link needs a
  member `canManage` allows. An organization's link needs a record of that organization or of none.
- Only a link's managers read, change and remove it. For a link made outside any organization, that's its owner. For a
  link made in one, it's the member who owns or made it, while they're a member, and the members `canManage` allows. So
  someone who leaves can't change what they left behind, and the organization can turn it off. Others get `NOT_FOUND`.
  Server code that passes neither an actor nor a request can manage any link.
- Opening a link needs nothing. Whether the visitor can then see the record is up to the app, unless the link grants
  access.

## Codes

Generated codes are lowercase letters and digits from `crypto.getRandomValues`, without bias. `create` also takes a
custom `code`, such as one the app generates: 1 to 64 letters, digits, `-` and `_`. Codes aren't case-sensitive: they're
stored in lowercase, so every database compares them alike, and `/s/Sale` opens `sale`. Codes are unique across the app,
except on organizations' domains, where each organization has its own, as
[Codes on organizations' domains](#codes-on-organizations-domains) describes. A custom code that's taken in the link's
scope returns `CONFLICT`; a generated one that collides is replaced, up to three times.

The code of a link that grants access is all it takes to see the record, so it always has 12 random characters: a
generated code is at least that long, whatever `codeLength` says, and a custom one, up to 51 characters, gets them after
a `-`, as in `invoice-1042-k3j9x0a1bz7q`.

## Access through a link

A link with `grantsView: true` lets anyone who opens it see its record. Opening it adds its code, and the organization
whose codes it's among, if any, to an HTTP-only cookie, `SameSite=Lax`, and `Secure` over HTTPS, which keeps the last 20
such links. So a cookie never grants another organization's link with the same code. The feature declares a core
[access grant](../../core/better-apps/README.md#access-grants), so checks that pass the request allow the record:

```ts
const allowed = await app.subjects.canView(actor, { subjectType: "invoice", subjectId }, { request })
```

The grant is for seeing the record only, for signed-in people and signed-out visitors alike. Writes keep the app's and
each feature's own rules. A link that's turned off, has expired or was removed grants nothing from the next request on,
and nor does one whose record moved to another organization, or whose subject type's `grantView` is now `false`. Only
read checks that pass the request count the grant: the app's own, and reads in comments, reactions and mentions, which
show the record's comments and reactions without letting the visitor add any.

A link to an organization's record that grants access must be the organization's, so it doesn't depend on one member. A
link outside any organization stands for its maker instead: each time it's asked, it grants access only while its maker
can still see the record, and `canShare` and `grantView` still allow them. For an organization's link, a `grantView` or
`canShare` check per record runs when the link is made or turned back on, not on each request, so unsetting it doesn't
end existing links' access. Turn those links' access off with `update({ id, grantsView: false })`, or remove them with
`removeSubject`.

Access can't be turned on for an existing link, only off: a link that grants it is made that way. Turning such a link
back on, or giving it a later expiry, checks again that the caller can see and share the record.

## Actions

- `create({ target, code?, owner?, grantsView?, expiresAt? })`, where `target` is `{ url }` or
  `{ subjectType, subjectId }`, returns the new link.
- `get({ id })` returns a link. The actions that manage a link take its `id`, since one person can manage two links with
  the same code, such as their organization's on its domain and their own on the app's host.
- `list({ subjectType?, subjectId?, owner?, cursor?, limit? })` pages through the links the caller manages, newest
  first: 20 by default, up to 50. Those are the links made in their current organization that they manage, and their own
  made outside any, such as before they joined one. Pass `subjectType` and `subjectId` for one record's, and `owner` for
  only the caller's own, `user`, or their organization's, `org`.
- `update({ id, url?, grantsView?, enabled?, expiresAt? })` changes a link and returns it. `url` is for URL links,
  `grantsView: false` ends the access a link gives, `enabled: false` turns a link off, and `expiresAt: null` clears its
  expiry. Each change is checked like `create`.
- `remove({ id })` removes a link and returns `{ removed }`. Its code is free again.
- Each link comes back with its `id`, `code`, `shortUrl`, `owner` as `{ type, id }`, `orgId`, `createdBy`, `target`,
  `grantsView`, `enabled`, `expiresAt`, `clicks`, `lastClickedAt`, `createdAt` and `updatedAt`. With `hosts`, `shortUrl`
  is `null` for a link on an organization's domain while the organization has no ready domain.
- Errors are `ShortLinksError`s: `UNAUTHENTICATED`, `FORBIDDEN` when a rule refuses, `NOT_FOUND` for links and records
  the caller can't see or manage, `INVALID_INPUT`, and `CONFLICT` for a code that's taken in the link's scope.

## Opening a link

`GET {path}/{code}` reads the link by its code, among the codes the host opens, then answers `302 Found` to its target
with `Cache-Control: private, no-store`, so a change to the link takes effect at once. Each `GET` adds a click and sets
`lastClickedAt` in one statement, after the response, through the request's `waitUntil`; without one, the response
waits. `HEAD` requests don't count. Every `GET` does, including link previews chat apps fetch.

## Organizations' domains

`hosts` lets an organization share its links on its own domain, such as `links.acme.com/s/abc123` or
`acme.yourapp.com/s/abc123`. Short links never import the domains feature. The app connects the two with
[`@better-apps/domains`](../domains/README.md)' `domainHosts`, which asks domains whose host it is and where an
organization's links are shared. The app's file imports the features, so the features can't import the app. The app
connects its domains once it exists:

```ts
// features.ts
import { domainHosts } from "@better-apps/domains"

const appUrl = "https://app.yourapp.com"
export const linkHosts = domainHosts({ url: appUrl })

export const links = shortLinks({
  subjects: { invoice: { url: ({ subjectId }) => `${appUrl}/invoices/${subjectId}`, grantView: true } },
  baseUrl: appUrl,
  hosts: linkHosts.hosts
})

// app.ts
const app = createBetterApps({ features: [links, domains({ subdomains: { zone: "yourapp.com" } })] })
linkHosts.connect(app.api.domains)
```

An app can write its own `hosts` instead, with the rules below.

- `baseUrl` is the app's own origin, which `resolve` calls `"app"`. `hosts` needs it: links that no organization's
  domain opens are shared there, whichever host an action is called from.
- `resolve({ hostname, request })` says whose links a host opens: `"app"` for the app's own host, which opens the links
  with the app's codes; `{ orgId }` for a domain the organization verified, which opens the links with the
  organization's codes; or `null` for any other host, such as a domain that's still pending, which opens none. A code
  the host doesn't open answers as a missing link does, through `notFound`, so a domain gives nothing away about other
  organizations' codes. `hostname` is the request URL's, lowercase and without its port or a trailing dot. Headers such
  as `X-Forwarded-Host` play no part.
- `origin({ orgId })` is the origin of an organization's ready domain, or `null` while it has none, asked once per
  organization in a call. It must be a host `resolve` gives the organization. Links made outside any organization ask
  with `orgId` `null`, for a host of the app's, or `null` for `baseUrl`.
- Links open at the same `path` on every host, so the catch-all route that serves `/s` serves them on every domain.
- A link that grants access sets its cookie on the host that opens it, for that host alone outside `cookie.domain`. When
  that cookie can't reach the record, such as a record on `app.yourapp.com` from a link on `links.acme.com`, the link is
  made with the app's codes and shared on the app's host. A subdomain such as `acme.yourapp.com` reaches the app's host
  with `cookie: { domain: "yourapp.com" }`. A record on the organization's own domain, such as a white-label app's
  `https://billing.acme.com/invoices/1`, is shared there when `origin` returns that domain. `create` refuses a link that
  grants access with `INVALID_INPUT` when neither the organization's domain nor `baseUrl` reaches the record. Opened on
  a host whose cookie doesn't reach the record, a link sends the visitor once to the same link where it does. Writing
  such a link's short URL asks the record's `url`, once per record in a call.

### Codes on organizations' domains

On the app's own host, codes are unique across the app. An organization with a ready domain has codes of its own there,
so Acme and Globex can both have `links.acme.com/s/pricing` and `links.globex.com/s/pricing`. No two organizations share
a domain, so a code is one link on each host. An organization's domains share its codes.

- An organization's own links, made while `origin` returns its domain, get the organization's codes and are shared on
  its domain. Every other link gets the app's codes and is shared on the app's host: a member's own links, links made
  outside any organization, and an organization's links made before its domain was ready.
- A link keeps its codes for good. Links made before an organization's domain was ready stay on the app's host, which
  still opens them, and links made on its domain open on whichever ready domain it has. While it has none, they open
  nowhere and their `shortUrl` is `null`, since the app's host may have the same code for another link.
- `create` says `CONFLICT` only for a code taken among the link's own codes, so it tells nobody about another
  organization's codes. The [spec](docs/spec.md#codes-on-organizations-domains) has the details.

## Records and owners that go

Call `app.api.shortLinks.removeSubject({ subjectType, subjectId })` when a record is deleted, and
`removeOwner({ owner: { type, id } })` when a person or an organization leaves. Both are server only, remove every
matching link in one statement, written in one batch with their event, and return `{ removed }`. Until then, a link to a
deleted record still redirects, and the app's page answers for the missing record.

## Events

`link.created`, `link.updated` and `link.removed` carry the link. `subject.removed` carries the record and
`owner.removed` the owner whose links went. Opening a link emits nothing.

## In the browser

`@better-apps/short-links/client` keeps lists of links in a store any framework can bind to, with no server code in the
bundle:

```ts
import { createShortLinksClient } from "@better-apps/short-links/client"

const links = createShortLinksClient(client)
await links.load({ subjectType: "invoice", subjectId: "inv-1" })
const link = await links.create({ target: { subjectType: "invoice", subjectId: "inv-1" }, grantsView: true })
await links.update({ code: link.code, enabled: false })
```

- `load(filter)` loads a list's first page, `loadMore(filter)` the next. A filter is a record, an `owner`, or nothing
  for every link the person manages. Lists are in `store`, keyed by `listKey(filter)`, with their `state` and `error`.
- `create` puts the new link first in the loaded lists it belongs in. `update` and `remove` show in every list. A list
  that was loading when one of them answered keeps the change, even when its answer was read before it.
- Dates arrive as `Date`s.
- `reset()` empties the store and cancels calls under way, for when someone else signs in without a page load.

`@better-apps/short-links/react` has hooks over the same store, with no UI:

```tsx
import { useLinks } from "@better-apps/short-links/react"

const { links, state, cursor, loadMore, client } = useLinks({ subjectType: "invoice", subjectId })
```

## Tables

`shortLink` holds the links, with a unique index on `code` and `scope`, the organization whose codes it's among, or `""`
for the app's, indexes on the owner and on the organization, each with the creation time, for lists, and one on the
record and creation time for a record's links and their cleanup. Run `better-apps generate` from
[`@better-apps/cli`](../../tooling/cli/README.md) to add it to your schema.
