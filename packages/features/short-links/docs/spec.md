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
| `code`          | string, unique | The code in the short URL. Codes are case-sensitive.                                                   |
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
  cookie: { name: "better-apps-links", maxAge: 30 * 24 * 60 * 60 },
  notFound: ({ request }) => Response.redirect(new URL("/link-not-found", request.url), 302)
})
```

- `subjects` lists the subject types links can point to. The app or a feature must declare each one.
  - `url({ subjectType, subjectId, orgId })` returns where the record lives in the app: a path, resolved against the
    link's own address, or an absolute URL. It runs each time the link opens, so a link follows the app's routes as they
    change.
  - `canShare(args)` says who can make links to a record. Everyone who can see it, by default.
  - `grantView` says whether links to this subject type may let anyone who has them see the record: `true`, a check per
    actor and record, or `false`, the default.
- `validateUrl({ url, actor, orgId })` checks URL targets, with `actor` `null` for trusted server code. It returns
  `true` to allow one, or `false` or a message to refuse it. Without it, any URL is allowed, as described in
  [URL targets](#url-targets).
- `canManage({ actor, orgId })` says who manages an organization's links. Every member, by default.
- `path` is where links open, `/s` by default. It can't be directly under the app's `basePath`, where a link's URL would
  look like an action's.
- `baseUrl` is the origin of the short URLs the actions return, such as a shorter domain that serves the same app. The
  request's origin, by default.
- `codeLength` is the length of generated codes, from 6 to 32: 8 by default.
- `cookie` names the cookie that holds access grants, `better-apps-links` by default, and how long it lasts, in seconds:
  30 days by default.
- `notFound({ request, code })` answers a link that doesn't exist, is turned off or has expired. By default it's a plain
  404 page. It doesn't say which of those it was, so codes can't be probed for links that once existed.

## Ownership

- A link is owned by a user or an organization. `create` takes `owner: "user" | "org"`. Without one, a link made inside
  an organization belongs to it, and one made outside any belongs to its creator.
- An organization's link stays when the person who made it leaves. A user's link is theirs alone.
- An organization's link to a record must target a record of that organization, or a record outside any.

## Permissions

- **Making a link** needs someone signed in. Server code passes an `actor`, since a link is always someone's.
  - A record link needs a person who can see the record, by the app's subject rules, and whom `canShare` allows.
  - An organization's link needs a member of it whom `canManage` allows.
  - A URL link needs a URL that passes `validateUrl`.
- **Reading and managing a link**, through `get`, `list`, `update` and `remove`, is for whoever manages it: its owner,
  for a user's link, or the members `canManage` allows, for an organization's. A link someone can't manage answers
  `NOT_FOUND`, as if it didn't exist.
- **Server code** that passes neither an actor nor a request is trusted: it can read, change and remove any link, and
  list a record's links. It can't make links.
- **Opening a link** needs nothing. Anyone with the short URL is redirected. Whether they can then see the record is up
  to the app's subject rules, unless the link grants access.

## Codes

- Generated codes are `codeLength` characters from the 62 letters and digits, picked with `crypto.getRandomValues`
  without bias. Eight characters give about 2 × 10¹⁴ codes.
- `create` takes a custom `code`, such as one the app generates, or a readable one like `spring-sale`: 1 to 64 letters,
  digits, `-` and `_`.
- A link that grants access needs a code of at least 8 characters, since the code is all it takes to see the record.
  Such links' generated codes are at least 8 characters, whatever `codeLength` says.
- Codes are unique across the app. A custom code that's taken returns `CONFLICT`. A generated code that collides is
  replaced with another, up to three times, before `CONFLICT`. A collision is told apart from other failed writes by
  reading the code back.
- A link's code never changes. A different code is a different link.

## URL targets

- Any absolute URL can be a target, as the WHATWG URL parser reads it, except `javascript:`, `data:`, `vbscript:` and
  `file:` URLs. The app decides anything stricter, such as which hosts are allowed, in `validateUrl`.
- URLs are up to 2048 characters.
- Changing a link's URL checks the new one the same way.

## Access through a link

A link to a record can let anyone who has it see the record: `grantsView: true`, which the subject type's `grantView`
rule must allow for the person making or changing the link.

1. Opening such a link sets an HTTP-only cookie, `Secure` over HTTPS, with `SameSite=Lax`, that holds the code. The
   cookie keeps the codes of the last 20 such links opened.
2. The feature declares a core access grant (see [Access grants](#access-grants)). For a request with that cookie, it
   reads the links by their codes in one query, and grants viewing a record when one of them points to it, is turned on,
   hasn't expired, and the record's organization is still the link's.
3. Read checks that pass the request, such as `app.subjects.canView(actor, ref, { request })`, then allow the record,
   for signed-in people and signed-out visitors alike.

The grant is for seeing the record only. Writes, such as commenting, keep the app's and each feature's own rules, which
don't count grants. Turning a link off, letting it expire or removing it ends its grant at once, since each request
reads the link again. A record that moves to another organization stops being granted by its old organization's links.

## Clicks

- Each `GET` of a link adds one to `clicks` and sets `lastClickedAt`, in one `incrementOne` statement, so clicks at the
  same moment all count. `HEAD` requests don't count.
- The click is written after the response, through the route's `waitUntil`. Without the platform's `waitUntil`, the
  response waits for it. A failed write goes to the app's `onError` and doesn't change the redirect.
- Every `GET` counts, including link previews that chat apps fetch.
- Clicks emit no events.

## Opening a link

`GET {path}/{code}`:

1. Reads the link by code: one read through the unique index.
2. A link that doesn't exist, is turned off or has expired gets `notFound`.
3. A record link's target is its subject type's `url`, for a subject type the feature still has. A URL link's is its
   URL.
4. Answers `302 Found` with the target as `Location` and `Cache-Control: private, no-store`, so turning a link off or
   changing it takes effect at once. A link that grants access also sets the cookie.
5. Records the click after the response.

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
  50: a record's links, or every link, that the caller manages. `owner` narrows it to the caller's own, `user`, or their
  organization's, `org`.
- `update({ code, url?, grantsView?, enabled?, expiresAt? })` changes a link and returns it.
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
- `subject.removed` carries the record and how many of its links went.
- `owner.removed` carries the owner and how many of their links went.

Events nobody subscribes to aren't written, as with every feature.

## Cleanup

Removing a record doesn't remove its links by itself. When a record is deleted, server code calls
`app.api.shortLinks.removeSubject({ subjectType, subjectId })`, and when a person or an organization leaves the app,
`removeOwner`. Each removes every matching link with one `deleteMany`, without a page per call, since links emit one
event for the whole removal rather than one per link. A record link whose record is gone, before the cleanup runs, still
redirects; the app's own page answers for the missing record.

## Custom domains

Links open on whatever host serves the app today, and codes are unique across the app. Links on customers' own domains
come once `@better-apps/domains` exists. The plan:

- Each request passes the route its `url`, so the route sees the host. The domains feature will resolve a host to its
  organization.
- Opening a link on a customer's domain will only open that organization's links, and `shortUrl` will use the
  organization's primary domain.
- Codes reused across organizations, such as `pricing` on two customers' domains, will need uniqueness per domain. That
  means adding the domain to the code's unique index, and a lookup by host and code, still one read.

## Core support

Short links use two pieces of core `better-apps`:

- [Public routes](../../../core/better-apps/README.md#routes) serve `GET {path}/:code`. The route reads the link with
  the `db`, sees the host in its `url`, and records the click with its `waitUntil`. `createBetterApps` refuses a `path`
  where links could be mistaken for action URLs, such as one directly under `basePath`.
- [Access grants](../../../core/better-apps/README.md#access-grants) let a link's cookie widen read checks that pass the
  request. Without a request, grants play no part, so writes and checks for other people never count them.
