# Short links spec

`@better-apps/short-links` gives an app short URLs, such as `https://app.example/s/k3Jd9xQa`, that redirect to one of
the app's records or to any URL. A user or an organization owns each link. A link can also let anyone who has it see the
record it points to. Opening a link counts a click.

It needs two things from core `better-apps`, described in [Core support](#core-support): public routes that
`app.handler` serves outside the action URLs, and access grants that a request carries.

## Tables

One table, `shortLink`:

| Field           | Type           | Holds                                                                                                  |
| --------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `code`          | string, unique | The code in the short URL, in lowercase, since codes aren't case-sensitive.                            |
| `owner`         | string         | `user:{userId}` or `org:{orgId}`, so a list of a person's and their organization's links is one query. |
| `orgId`         | string         | The organization the link was made in, or `""` outside any.                                            |
| `createdBy`     | string         | The user who made it.                                                                                  |
| `url`           | string, null   | The target of a URL link.                                                                              |
| `subjectType`   | string, null   | The target of a record link: its subject type.                                                         |
| `subjectId`     | string, null   | The target of a record link: its id.                                                                   |
| `grantsView`    | boolean        | Whether opening the link lets anyone who has it see the record.                                        |
| `enabled`       | boolean        | Whether the link opens. Turning it off keeps its code and counts.                                      |
| `expiresAt`     | date, null     | When it stops opening, or never.                                                                       |
| `clicks`        | number         | How many times it was opened.                                                                          |
| `lastClickedAt` | date, null     | When it was last opened.                                                                               |
| `createdAt`     | date           |                                                                                                        |
| `updatedAt`     | date           |                                                                                                        |

Indexes:

- The unique index on `code` serves opening a link, which is one read.
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
- `baseUrl` is the origin of the short URLs the actions return, such as a shorter domain that serves the same app. The
  request's origin, by default.
- `hosts` opens links on organizations' own domains and shares them there, as
  [Organizations' domains](#organizations-domains) describes. Without it, every host that serves the app opens every
  link.
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
- Codes are unique across the app. A custom code that's taken returns `CONFLICT`. A code with a random part that
  collides is replaced with another, up to three times, before `CONFLICT`. A collision is told apart from other failed
  writes by reading the code back.
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

1. Opening such a link sets an HTTP-only cookie, `Secure` over HTTPS, with `SameSite=Lax`, that holds the code. The
   cookie keeps the codes of the last 20 such links opened.
2. The feature declares a core access grant (see [Access grants](#access-grants)). For a request with that cookie, it
   reads the links by their codes in one query, and grants viewing a record when one of them points to it, is turned on,
   hasn't expired, its subject type's `grantView` isn't `false`, and the record's organization is still the link's and
   owns it.
3. Read checks that pass the request, such as `app.subjects.canView(actor, ref, { request })`, then allow the record,
   for signed-in people and signed-out visitors alike.

The grant is for seeing the record only. Writes, such as commenting, keep the app's and each feature's own rules, which
don't count grants. Turning a link off, letting it expire or removing it ends its grant at once, since each request
reads the link again. A record that moves to another organization stops being granted by its old organization's links.
Turning a link that grants access back on, or giving it a later expiry, checks again, as `create` does, that the caller
can see and share the record, so someone who has since lost access can't reopen it.

Whose access a link stands for depends on where it was made:

- A link made outside any organization stands for its maker. Once per request, the maker is rebuilt with
  `identity.getActorsFor`, and the link grants access only while they can still see the record, by a check that doesn't
  pass the request, and `canShare` and `grantView` still allow them. Someone who loses access to a record, or loses the
  right to share it, takes their links' access with them. A maker the identity adapter no longer finds grants nothing,
  and when the lookup or a check fails, such as while the identity service is down, these links grant nothing for that
  request while other links still count, and the error is logged with `console.error`.
- An organization's link stands for the organization and outlives the member who made it. A `canShare` or `grantView`
  check per record, such as an invoice's own "shareable" setting, runs when the link is made or turned back on, not on
  each request, so unsetting it doesn't end the access existing links give. The app ends it with
  `update({ code, grantsView: false })` on those links, or `removeSubject`.

The cookie only reaches the link's host, or every host under `cookie.domain`. Making a link that grants access fails
when the record's page is on a host the cookie wouldn't reach, rather than letting the grant fail without a word. With
`hosts`, an organization's domain shares only the links whose cookie reaches the record from it, as
[Links that grant access](#links-that-grant-access) describes. Read checks only count the grant where they pass the
request. The app's own pages do; comments and reactions don't yet, since each feature decides what a visitor with only a
link sees, such as people's names.

## Clicks

- Each `GET` of a link adds one to `clicks` and sets `lastClickedAt`, in one `incrementOne` statement, so clicks at the
  same moment all count. `HEAD` requests don't count.
- The click is written after the response, through the route's `waitUntil`. Without the platform's `waitUntil`, the
  response waits for it. A failed write goes to the app's `onError` and doesn't change the redirect.
- Every `GET` counts, including link previews that chat apps fetch.
- Clicks emit no events.

## Opening a link

`GET {path}/{code}`:

1. With `hosts`, asks `resolve` whose links the request's host opens. A host that opens none gets `notFound` without
   reading the link.
2. Reads the link by code: one read through the unique index.
3. A link that doesn't exist, is turned off, has expired, or isn't one the host opens gets `notFound`.
4. A record link's target is its subject type's `url`, for a subject type the feature still has. A URL link's is its
   URL.
5. Answers `302 Found` with the target as `Location` and `Cache-Control: private, no-store`, so turning a link off or
   changing it takes effect at once. A link that grants access also sets the cookie. With `hosts`, when that cookie
   couldn't reach the record from this host, it answers `302 Found` to the same link on the record's host instead,
   without the cookie or a click.
6. Records the click after the response.

## Expiry and turning a link off

- `expiresAt` must be later than now when set. `update` can change it or clear it with `null`.
- `update({ code, enabled: false })` turns a link off and `enabled: true` turns it back on. A link that's off keeps its
  code, owner and counts.
- An expired or turned-off link opens nothing and grants nothing. Both still show in lists, so their managers can turn
  them on again or extend them.

## Actions

- `create({ target, code?, owner?, grantsView?, expiresAt? })`, where `target` is `{ url }` or
  `{ subjectType, subjectId }`, returns the new link.
- `get({ code })` returns one link.
- `list({ subjectType?, subjectId?, owner?, cursor?, limit? })` pages through links newest first, 20 by default, up to
  50: a record's links, or every link, that the caller manages. Those are the links made in their current organization
  that they manage, and their own made outside any, such as before they joined one. `owner` narrows it to the caller's
  own, `user`, or their organization's, `org`.
- `update({ code, url?, grantsView?, enabled?, expiresAt? })` changes a link and returns it. `grantsView` only takes
  `false`.
- `remove({ code })` removes a link and returns `{ removed }`.
- `removeSubject({ subjectType, subjectId })`, server only, removes a record's links in one statement and returns
  `{ removed }`.
- `removeOwner({ owner: { type, id } })`, server only, removes a person's or an organization's links in one statement
  and returns `{ removed }`.

Each link comes back as a `ShortLink`: its `code`, its `shortUrl`, its `owner` as `{ type, id }`, `orgId`, `createdBy`,
its `target`, `grantsView`, `enabled`, `expiresAt`, `clicks`, `lastClickedAt`, `createdAt` and `updatedAt`. `shortUrl`
is `baseUrl`, or the request's origin, followed by the path and code. For server code with neither, it's the path alone.

Errors are `ShortLinksError`s: `UNAUTHENTICATED`, `FORBIDDEN` when a rule refuses, `NOT_FOUND` for links and records the
caller can't see or manage, `INVALID_INPUT` for a code, URL, target, owner or expiry that isn't allowed, and `CONFLICT`
for a code that's taken.

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
through `hosts`, usually with [`@better-apps/domains`](../../domains/docs/spec.md)' server-only `lookup` and
`getPrimary`:

```ts
hosts: {
  resolve: async ({ hostname }) => {
    if (hostname === "app.yourapp.com") {
      return "app"
    }
    const match = await app.api.domains.lookup({ hostname })
    return match?.verified && match.orgId ? { orgId: match.orgId } : null
  },
  origin: async ({ owner }) => {
    if (owner.type !== "org") {
      return null
    }
    const primary = await app.api.domains.getPrimary({ orgId: owner.id })
    return primary?.status === "active" ? `https://${primary.hostname}` : null
  }
}
```

### Which host opens which links

`resolve({ hostname, request })` runs for each link opened, with the host lowercase and without its port:

- `"app"`: the app's own host, which opens every link, such as ones shared before the organization had a domain.
- `{ orgId }`: a domain the organization verified, which opens only the links that organization owns. A link a member
  owns, even one made in the organization, stays on the app's host, and so does every link made outside any
  organization.
- `null`: any other host, such as a domain that's pending or failed, or one the app has never heard of. It opens none,
  and the link isn't read.

A link the host doesn't open answers as a missing one does, through `notFound`, which isn't told why. So
`links.acme.com` never opens Globex's links and gives nothing away about which codes Globex has. Codes stay unique
across the app, so a code means the same link on every host that opens it, and opening one is still one read.

An app without organizations, such as one whose workspace has its own domains, can return `"app"` for its workspace's
ready domains, so they open every link.

### Where links open

Links open at the same `path` on every host: `links.acme.com/s/abc123`, not `links.acme.com/abc123`. A route at the root
would match every one-segment path the framework passes to `app.handler`, on the app's own host too, while a literal
`path` segment keeps links apart from the app's pages. On Workers with the `*/*` route, and with a framework catch-all
route at `path`, every host already reaches the link route.

### Short URLs

`origin({ owner, orgId })` gives the origin of a link's short URL, such as `https://links.acme.com`, or `null` for the
app's own: `baseUrl`, or the request's origin. It runs once per owner in a call, so `list` asks once for a page of one
organization's links. It should name a host that opens the link: the owning organization's domain for its links, or a
host `resolve` calls `"app"`. An app's share dialog, and anything else that shows `shortUrl`, then shows the
organization's primary domain once it's ready, and the app's host before then.

### Links that grant access

The grant cookie is set on the host that opens the link, and browsers only send it to that host, or to every host under
`cookie.domain`.

- A subdomain such as `acme.yourapp.com`, with records on `app.yourapp.com`, works with
  `cookie: { domain: "yourapp.com" }`: the link is shared on the subdomain and grants access on the app's host.
- A domain of the organization's own, such as `links.acme.com`, can't share a cookie with `app.yourapp.com`. A link that
  grants access to a record there keeps its short URL on the app's host. Opened on the domain anyway, it sends the
  visitor to the same link on the record's host, which sets the cookie there and counts the click.
- A record the domain serves itself, when `url` returns a path the app serves on every host, is reached from the domain,
  so such links are shared there.

## Core support

Short links use two pieces of core `better-apps`:

- [Public routes](../../../core/better-apps/README.md#routes) serve `GET {path}/:code`. The route reads the link with
  the `db`, sees the host in its `url`, and records the click with its `waitUntil`. `createBetterApps` refuses a `path`
  where links could be mistaken for action URLs, such as one directly under `basePath`.
- [Access grants](../../../core/better-apps/README.md#access-grants) let a link's cookie widen read checks that pass the
  request. Without a request, grants play no part, so writes and checks for other people never count them.
