# Short links spec

`@better-apps/short-links` gives an app short URLs, such as `https://app.example/s/k3Jd9xQa`, that redirect to one of
the app's records or to any URL. A user or an organization owns each link. A link can also let anyone who has it see the
record it points to. Opening a link counts a click.

It needs two things from core `better-apps`, described in [Core support](#core-support): public routes that
`app.handler` serves outside the action URLs, and access grants that a request carries.

## Tables

One table, `shortLink`:

| Field           | Type         | Holds                                                                                                  |
| --------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `code`          | string       | The code in the short URL, in lowercase, since codes aren't case-sensitive. Unique within its `scope`. |
| `scope`         | string       | Whose codes it's among: `""` for the app's, or an organization's id for one made on its domains.       |
| `owner`         | string       | `user:{userId}` or `org:{orgId}`, so a list of a person's and their organization's links is one query. |
| `orgId`         | string       | The organization the link was made in, or `""` outside any.                                            |
| `createdBy`     | string       | The user who made it.                                                                                  |
| `url`           | string, null | The target of a URL link.                                                                              |
| `subjectType`   | string, null | The target of a record link: its subject type.                                                         |
| `subjectId`     | string, null | The target of a record link: its id.                                                                   |
| `grantsView`    | boolean      | Whether opening the link lets anyone who has it see the record.                                        |
| `enabled`       | boolean      | Whether the link opens. Turning it off keeps its code and counts.                                      |
| `expiresAt`     | date, null   | When it stops opening, or never.                                                                       |
| `clicks`        | number       | How many times it was opened.                                                                          |
| `lastClickedAt` | date, null   | When it was last opened.                                                                               |
| `createdAt`     | date         |                                                                                                        |
| `updatedAt`     | date         |                                                                                                        |

Indexes:

- The unique index on `(code, scope)` keeps codes unique within each scope. It serves opening a link, which is one read,
  and reading the links a grant cookie holds by their codes.
- `(owner, createdAt)` serves lists of a person's or an organization's links, newest first.
- `(orgId, createdAt)` serves a manager's list of every link made in their organization.
- `(subjectType, subjectId, createdAt)` serves a record's links and removing them when the record goes.

A link targets either a URL or a record, never both.

## Configuration

```ts
shortLinks({
  subjects: {
    invoice: {
      url: ({ subjectId }) => `/invoices/${subjectId}`,
      canShare: ({ actor, subjectId }) => invoices.canEdit(actor, subjectId),
      grantView: true
    }
  },
  validateUrl: ({ url }) => url.protocol === "https:" || "Links must use https.",
  canManage: ({ actor }) => actor.roles.includes("admin"),
  path: "/s",
  baseUrl: "https://go.example.com",
  codeLength: 8,
  cookie: { name: "better-apps-links", maxAge: 30 * 24 * 60 * 60, domain: "example.com" },
  notFound: ({ request }) => Response.redirect(new URL("/link-not-found", request.url), 302)
})
```

- `subjects` lists the subject types links can point to. The app or a feature must declare each one.
  - `url({ subjectType, subjectId, orgId })` returns where the record lives in the app: a path, resolved against the
    link's own address, or an absolute URL. It runs each time the link opens, so a link follows the app's routes as they
    change.
  - `canShare(args)` says who can make links to a record. Everyone who can see it, by default.
  - `grantView` says whether links to this subject type may let anyone who has them see the record: `true`, a check per
    actor and record, or `false`, the default. Setting it back to `false` ends the access existing links give.
- `validateUrl({ url, actor, orgId })` checks URL targets, with `actor` `null` for trusted server code. It returns
  `true` to allow one, or `false` or a message to refuse it. Without it, any URL is allowed, as described in
  [URL targets](#url-targets).
- `canManage({ actor, orgId })` says who manages an organization's links, the ones it owns and the ones its members made
  in it, and who makes its URL links. Every member, by default. Who shares records is up to `canShare`.
- `path` is where links open, `/s` by default. It can't be directly under the app's `basePath`, where a link's URL would
  look like an action's.
- `baseUrl` is where the short URLs the actions return start, such as a shorter domain that serves the same app. The
  request's origin, by default. `hosts` needs it. It's an `http` or `https` URL, which may have a path but no
  credentials, query or fragment, since short URLs follow it with the path and code.
- `hosts` opens links on organizations' own domains and shares them there, where each organization has codes of its own,
  as [Organizations' domains](#organizations-domains) describes. Without it, every host that serves the app opens every
  link, and codes are unique across the app.
- `codeLength` is the length of generated codes, from 6 to 32: 8 by default.
- `cookie` names the cookie that holds access grants, `better-apps-links` by default, and how long it lasts, in seconds:
  30 days by default. Its `domain` lets links on one host grant access on another under it, such as links on
  `go.example.com` for records on `app.example.com`. Without it, the cookie stays on the link's host. `baseUrl`'s host
  must be under the domain, or browsers drop the cookie.
- `notFound({ request, code })` answers a link that doesn't exist, is turned off or has expired. By default it's a plain
  404 page. It doesn't say which of those it was, so codes can't be probed for links that once existed.

## Ownership

- A link is owned by a user or an organization. `create` takes `owner: "user" | "org"`. Without one, inside an
  organization, a link belongs to the organization when its maker manages the organization's links or the link grants
  access, and to its maker otherwise. Outside any organization, it belongs to its creator.
- An organization's link stays when the person who made it leaves. A link a member made for themselves inside an
  organization is theirs, and the organization's managers manage it too, so they can turn it off after the member
  leaves.
- An organization's link to a record must target a record of that organization, or a record outside any.
- A link that grants access to an organization's record must be the organization's.

## Permissions

- **Making a link** needs someone signed in. Server code passes an `actor`, since a link is always someone's.
  - A record link needs a person who can see the record, by the app's subject rules, and whom `canShare` allows.
  - An organization's link to a record needs a member of it who may share the record, as above. An organization's URL
    link needs a member whom `canManage` allows. So `canShare` decides who shares records, and `canManage` who looks
    after the organization's links.
  - A URL link needs a URL that passes `validateUrl`.
- **Reading and managing a link**, through `get`, `list`, `update` and `remove`, is for whoever manages it. For a link
  made outside any organization, that's its owner. For a link made in one, it's the member who owns or made it, while
  they're still a member, and the members `canManage` allows. Someone who leaves can't change or remove what they left
  behind; the organization's managers can. A link someone can't manage answers `NOT_FOUND`, as if it didn't exist.
- **Server code** that passes neither an actor nor a request is trusted: it can read, change and remove any link, and
  list a record's links. It can't make links.
- **Opening a link** needs nothing. Anyone with the short URL is redirected. Whether they can then see the record is up
  to the app's subject rules, unless the link grants access.

## Codes

- Generated codes are `codeLength` characters from the 36 lowercase letters and digits, picked with
  `crypto.getRandomValues` without bias. Eight characters give about 2.8 × 10¹² codes.
- `create` takes a custom `code`, such as one the app generates, or a readable one like `spring-sale`: 1 to 64 letters,
  digits, `-` and `_`.
- Codes aren't case-sensitive. They're stored in lowercase, so databases whose default collation ignores case, such as
  MySQL's, compare them the same way as the rest, and `/s/Spring-Sale` opens `spring-sale`.
- The code of a link that grants access is all it takes to see the record, so it has 12 random characters, about 4.7 ×
  10¹⁸ codes: a generated code is at least that long, whatever `codeLength` says, and a custom one, up to 51 characters,
  gets them after a `-`, as in `invoice-1042-k3j9x0a1bz7q`. A readable code alone, such as `invoice-1042`, would make
  the record as good as public.
- Codes are unique within their scope: the app's, which every link is in without `hosts`, or an organization's, for
  links it makes on its domains, as [Codes on organizations' domains](#codes-on-organizations-domains) describes. A
  custom code that's taken in the link's scope returns `CONFLICT`, which tells the caller nothing about other scopes'
  codes. A code with a random part that collides is replaced with another, up to three times, before `CONFLICT`. A
  collision is told apart from other failed writes by reading the code back in the same scope.
- A link's code never changes. A different code is a different link.

## URL targets

- Any absolute URL can be a target, as the WHATWG URL parser reads it, except `javascript:`, `data:`, `vbscript:` and
  `file:` URLs. The app decides anything stricter, such as which hosts are allowed, in `validateUrl`.
- URLs are up to 2048 characters.
- Changing a link's URL checks the new one the same way.

## Access through a link

A link to a record can let anyone who has it see the record: `grantsView: true`, which the subject type's `grantView`
rule must allow for the person making the link. Access can't be turned on for an existing link, only off, since its code
may not have the random part such a link needs.

1. Opening such a link sets an HTTP-only cookie, `Secure` over HTTPS, with `SameSite=Lax`. It holds the link's code and,
   for a link in an organization's scope, the scope, as `code~scope` with the scope in base64url. The cookie keeps the
   last 20 such links opened, or fewer when 20 would make it longer than 3,800 characters.
2. The feature declares a core access grant (see [Access grants](#access-grants)). Core asks it once per check about
   every request in the check, such as one per live viewer. It reads their links by code, 90 codes to a query, or by
   record when the check names fewer records than that takes, and reads nothing when no checked subject type has
   `grantView` on. A link counts only for a cookie entry with both its code and its scope, so `pricing-k3j9x0a1bz7q` in
   one organization's scope never matches the same code in another's. It grants viewing a record to a request when a
   link in that request's cookie points to it, is turned on, hasn't expired, its subject type's `grantView` isn't
   `false`, and the record's organization, looked up once per record, is still the link's and owns it.
3. Read checks that pass the request, such as `app.subjects.canView(actor, ref, { request })`, then allow the record,
   for signed-in people and signed-out visitors alike.

The grant is for seeing the record only. Writes, such as commenting, keep the app's and each feature's own rules, which
don't count grants. Turning a link off, letting it expire or removing it ends its grant at once, since each request
reads the link again. A record that moves to another organization stops being granted by its old organization's links.
Turning a link that grants access back on, or giving it a later expiry, checks again, as `create` does, that the caller
can see and share the record, so someone who has since lost access can't reopen it.

Whose access a link stands for depends on where it was made:

- A link made outside any organization stands for its maker. Once per check, the maker is rebuilt with
  `identity.getActorsFor`, and the link grants access only while they can still see the record, by a check that doesn't
  pass the request, and `canShare` and `grantView` still allow them. Someone who loses access to a record, or loses the
  right to share it, takes their links' access with them. A maker the identity adapter no longer finds grants nothing,
  and when the lookup or a check fails, such as while the identity service is down, these links grant nothing to any
  request in that check while other links still count, and the error goes to the app's `onError`.
- An organization's link stands for the organization and outlives the member who made it. A `canShare` or `grantView`
  check per record, such as an invoice's own "shareable" setting, runs when the link is made or turned back on, not on
  each request, so unsetting it doesn't end the access existing links give. The app ends it with
  `update({ id, grantsView: false })` on those links, or `removeSubject`.

The cookie only reaches the link's host, or every host under `cookie.domain`. Making a link that grants access fails
with `INVALID_INPUT` when the record's page is on a host the cookie wouldn't reach from the host the link is shared on,
rather than letting the grant fail without a word. With `hosts`, that's the organization's domain when the cookie
reaches the record from there, and the app's own host otherwise, as [Links that grant access](#links-that-grant-access)
describes. Read checks only count the grant where they pass the request. The app's own pages do, and so do the reads in
comments, reactions and mentions, each deciding what a visitor with only a link sees: comments come as a signed-out
reader gets them, with names and no user ids, and who reacted shows only where it's public.

## Clicks

- Each `GET` of a link adds one to `clicks` and sets `lastClickedAt`, in one `incrementOne` statement, so clicks at the
  same moment all count. `HEAD` requests don't count.
- The click is written after the response, through the route's `waitUntil`. Without the platform's `waitUntil`, the
  response waits for it. A failed write goes to the app's `onError` and doesn't change the redirect.
- Every `GET` counts, including link previews that chat apps fetch.
- Clicks emit no events.

## Opening a link

`GET {path}/{code}`:

1. With `hosts`, asks `resolve` whose links the request's host opens: the app's scope or an organization's. A host that
   opens none gets `notFound` without reading the link. Without `hosts`, every host opens the app's scope.
2. Reads the link by its code in that scope: one read through the unique index.
3. A link that isn't in that scope, is turned off or has expired gets `notFound`.
4. A record link's target is its subject type's `url`, for a subject type the feature still has. A URL link's is its
   URL.
5. Answers `302 Found` with the target as `Location` and `Cache-Control: private, no-store`, so turning a link off or
   changing it takes effect at once. A link that grants access also sets the cookie. With `hosts`, when that cookie
   couldn't reach the record from this host, it can answer `302 Found` to the same link where the cookie does reach it
   instead, without the cookie or a click, as [Links that grant access](#links-that-grant-access) describes.
6. Records the click after the response.

## Expiry and turning a link off

- `expiresAt` must be later than now when set. `update` can change it or clear it with `null`.
- `update({ id, enabled: false })` turns a link off and `enabled: true` turns it back on. A link that's off keeps its
  code, owner and counts.
- An expired or turned-off link opens nothing and grants nothing. Both still show in lists, so their managers can turn
  them on again or extend them.

## Actions

- `create({ target, code?, owner?, grantsView?, expiresAt? })`, where `target` is `{ url }` or
  `{ subjectType, subjectId }`, returns the new link.
- `get({ id })` returns one link. The actions that manage a link take its `id`, since a code is only unique within its
  scope, so one person can manage two links with the same code.
- `list({ subjectType?, subjectId?, owner?, cursor?, limit? })` pages through links newest first, 20 by default, up to
  50: a record's links, or every link, that the caller manages. Those are the links made in their current organization
  that they manage, and their own made outside any, such as before they joined one. `owner` narrows it to the caller's
  own, `user`, or their organization's, `org`.
- `update({ id, url?, grantsView?, enabled?, expiresAt? })` changes a link and returns it. `grantsView` only takes
  `false`.
- `remove({ id })` removes a link and returns `{ removed }`.
- `removeSubject({ subjectType, subjectId })`, server only, removes a record's links in one statement and returns
  `{ removed }`.
- `removeOwner({ owner: { type, id } })`, server only, removes a person's or an organization's links in one statement
  and returns `{ removed }`.

Each link comes back as a `ShortLink`: its `id`, `code`, `shortUrl`, its `owner` as `{ type, id }`, `orgId`,
`createdBy`, its `target`, `grantsView`, `enabled`, `expiresAt`, `clicks`, `lastClickedAt`, `createdAt` and `updatedAt`.
`shortUrl` is `baseUrl`, or the request's origin, followed by the path and code. For server code with neither, it's the
path alone. With `hosts`, it's on a host that opens the link, as [Short URLs](#short-urls) describes, and `null` for a
link in an organization's scope while the organization has no ready domain.

Errors are `ShortLinksError`s: `UNAUTHENTICATED`, `FORBIDDEN` when a rule refuses, `NOT_FOUND` for links and records the
caller can't see or manage, `INVALID_INPUT` for a code, URL, target, owner or expiry that isn't allowed, and `CONFLICT`
for a code that's taken in the link's scope.

## Events

- `link.created`, `link.updated` and `link.removed` carry the link.
- `subject.removed` carries the record whose links went.
- `owner.removed` carries the owner whose links went.

Events nobody subscribes to aren't written, as with every feature.

## Cleanup

Removing a record doesn't remove its links by itself. When a record is deleted, server code calls
`app.api.shortLinks.removeSubject({ subjectType, subjectId })`, and when a person or an organization leaves the app,
`removeOwner`. Each removes every matching link with one `deleteMany`, without a page per call, since links emit one
event for the whole removal rather than one per link. The delete and its event are written in one batch, so neither
happens without the other. A record link whose record is gone, before the cleanup runs, still redirects; the app's own
page answers for the missing record.

## Organizations' domains

An organization with a ready domain, a subdomain such as `acme.yourapp.com` or its own such as `links.acme.com`, can
share its links there: `links.acme.com/s/abc123`. Short links never import the domains feature. The app connects them
through `hosts`, usually with [`@better-apps/domains`](../../domains/docs/spec.md#hosts-for-other-features)'
`domainHosts`, which answers from domains' server-only `lookup` and `getPrimary`. The app's file imports the features,
so the app connects its domains once it exists, as the [README](../README.md#organizations-domains) shows:

```ts
const appUrl = "https://app.yourapp.com"
const linkHosts = domainHosts({ url: appUrl })

shortLinks({ baseUrl: appUrl, hosts: linkHosts.hosts })
// Once the app is created:
linkHosts.connect(app.api.domains)
```

`hosts` needs `baseUrl`, the app's own origin, which `resolve` calls `"app"`. An action can be called from an
organization's domain, and the request's origin there doesn't open everyone's links.

### Codes on organizations' domains

On the app's own host, codes are unique across the app, so `/s/pricing` there is one link. An organization with a ready
domain has codes of its own on it: once Acme's domain is ready, the links Acme makes are shared there, and their codes
only need to be unique among Acme's. Globex can have `pricing` on its own domain at the same time. No two organizations
share a domain, so `/s/pricing` is still one link on each host. An organization's domains, such as a subdomain and one
of its own, share its codes.

A link's scope is set when it's made and never changes:

- An organization's own link, made while `origin` returns the organization's domain, is in the organization's scope,
  unless it grants access to a record the cookie wouldn't reach from that domain. Its `scope` is the organization's id.
- Every other link is in the app's scope: a member's own links, links made outside any organization, an organization's
  links made before its domain was ready, and links that grant access from the app's host. Its `scope` is `""`.

So a domain appearing or going away never moves a link, and two links never come to share a code on one host:

- When an organization's domain becomes ready, its links made before then keep their codes and their short URLs on the
  app's host, which still opens them. New links go on the domain.
- When an organization loses its last ready domain, the links in its scope open nowhere, and their `shortUrl` is `null`,
  until it has a ready domain again. Then they open there, whichever domain it is. The app's host never opens them,
  since another organization's link, or one in the app's scope, may have the same code. New links go in the app's scope
  meanwhile.
- An app that adds `hosts` keeps its existing links in the app's scope. An app that drops `hosts` opens only the app's
  scope, so links in organizations' scopes stop opening.

### Which host opens which links

`resolve({ hostname, request })` runs for each link opened. `hostname` is the request URL's, lowercase and without its
port or a trailing dot, so `Links.Acme.com.:443` is `links.acme.com`. Headers such as `X-Forwarded-Host` play no part.
It returns:

- `"app"`: the app's own host, which opens the links in the app's scope.
- `{ orgId }`: a domain the organization verified, which opens the links in that organization's scope.
- `null`: any other host, such as a domain that's pending or failed, or one the app has never heard of. It opens none,
  and the link isn't read.

Opening a link is one read of its code in the host's scope. A code the host's scope doesn't have answers as a missing
link does, through `notFound`, which isn't told why. So `links.acme.com` never opens Globex's links and gives nothing
away about which codes Globex has.

An app without organizations, such as one whose workspace has its own domains, can return `"app"` for its workspace's
ready domains, so they open every link. `domainHosts` does.

### Where links open

Links open at the same `path` on every host: `links.acme.com/s/abc123`, not `links.acme.com/abc123`. A route at the root
would match every one-segment path the framework passes to `app.handler`, on the app's own host too, while a literal
`path` segment keeps links apart from the app's pages. On Workers with the `*/*` route, and with a framework catch-all
route at `path`, every host already reaches the link route.

### Short URLs

`origin({ orgId })` gives the origin of an organization's ready domain, such as `https://links.acme.com`, or `null`
while it has none. It must name a host that `resolve` gives the organization, since it decides which links go in the
organization's scope. Links made outside any organization ask with `orgId` `null`, for a host `resolve` calls `"app"`,
or `null` for `baseUrl`. It runs once per organization in a call, so `list` asks once for a page of one organization's
links.

- A link in an organization's scope is shared on the domain `origin` gives, such as the organization's primary one.
  While `origin` returns `null`, its `shortUrl` is `null`.
- A link made outside any organization is shared on `origin({ orgId: null })` when it returns a host, and on `baseUrl`
  otherwise.
- Every other link is in the app's scope and shared on `baseUrl`.

An app's share dialog, and anything else that shows `shortUrl`, then shows the organization's domain for links made
since it was ready, and the app's host for links made before.

### Links that grant access

The grant cookie is set on the host that opens the link, and browsers only send it to that host, or to every host under
`cookie.domain`. On a host outside `cookie.domain`, such as an organization's own domain, it's set for that host alone,
since browsers drop a cookie for a domain that doesn't cover the host setting it.

- A subdomain such as `acme.yourapp.com`, with records on `app.yourapp.com`, works with
  `cookie: { domain: "yourapp.com" }`: the link is made in the organization's scope, shared on the subdomain, and grants
  access on the app's host.
- A domain of the organization's own, such as `links.acme.com`, can't share a cookie with `app.yourapp.com`. A link that
  grants access to a record there is made in the app's scope and shared on the app's host.
- A record the domain serves itself is reached from the domain, so such links are made in the organization's scope and
  shared there. That's a record whose `url` returns a path the app serves on every host, or an absolute URL on the
  domain, such as a white-label app's `https://billing.acme.com/invoices/1` with `origin` returning
  `https://billing.acme.com`.
- A record that neither the organization's domain nor `baseUrl` reaches can't have a link that grants access: `create`
  refuses it with `INVALID_INPUT`.

A link opened on a host whose cookie wouldn't reach the record sends the visitor on to the same link where it does,
without the cookie or a click. That host sets the cookie and counts the click. It's never the one the link was opened
on, so a link sends a visitor on once at most.

- A link in the app's scope goes to `baseUrl` when the cookie reaches the record from there, and to the record's host
  otherwise. The record's host only opens the link when `resolve` calls it the app's.
- A link in an organization's scope goes to the domain `origin` gives when the cookie reaches the record from there,
  such as from one of its own domains to its subdomain. Otherwise it opens where it is, and its cookie doesn't reach the
  record.

Writing the short URL of a link that grants access asks the record's `url`, to see which host reaches it. It's asked
once per record in a call, so `list` asks once per record on the page, however many of its links there are.

## Core support

Short links use two pieces of core `better-apps`:

- [Public routes](../../../core/better-apps/README.md#routes) serve `GET {path}/:code`. The route reads the link with
  the `db`, sees the host in its `url`, and records the click with its `waitUntil`. `createBetterApps` refuses a `path`
  where links could be mistaken for action URLs, such as one directly under `basePath`.
- [Access grants](../../../core/better-apps/README.md#access-grants) let a link's cookie widen read checks that pass the
  request. Without a request, grants play no part, so writes and checks for other people never count them.
