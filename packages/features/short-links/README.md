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
  may let anyone who has them see the record: `true`, a check per actor and record, or `false`, the default.
- `validateUrl({ url, actor, orgId })` checks URL targets, returning `true`, or `false` or a message to refuse one.
  Without it, any URL is allowed, but not `javascript:`, `data:`, `vbscript:` and `file:` ones.
- `canManage({ actor, orgId })` says who manages an organization's links: every member, by default.
- `path` is where links open, `/s` by default. `baseUrl`, such as `https://go.example.com`, is the origin of the short
  URLs actions return: the request's, by default.
- `codeLength` sets the length of generated codes, from 6 to 32: 8 by default.
- `cookie` names the cookie that holds access grants, `better-apps-links` by default, and sets its `maxAge` in seconds,
  30 days by default.
- `notFound({ request, code })` answers links that don't exist, are turned off or have expired. A plain 404 page, by
  default. It isn't told which, so visitors can't tell which codes were links once.

## Owners and permissions

- `create` takes `owner: "user" | "org"`. Without one, a link made inside an organization belongs to it, and one made
  outside any belongs to its maker. An organization's links stay when the person who made them leaves.
- Making a link needs someone signed in; server code passes an `actor`. A link to a record needs someone who can see it
  and whom `canShare` allows. An organization's link needs a member `canManage` allows, and a record of that
  organization or of none.
- Only a link's managers read, change and remove it: its owner, or the organization's members `canManage` allows. Others
  get `NOT_FOUND`. Server code that passes neither an actor nor a request can manage any link.
- Opening a link needs nothing. Whether the visitor can then see the record is up to the app, unless the link grants
  access.

## Codes

Generated codes are letters and digits from `crypto.getRandomValues`, without bias. `create` also takes a custom `code`,
such as one the app generates: 1 to 64 letters, digits, `-` and `_`. Codes are case-sensitive and unique across the app.
A custom code that's taken returns `CONFLICT`; a generated one that collides is replaced, up to three times. Links that
grant access need codes of at least 8 characters; their generated codes always are, whatever `codeLength` says.

## Access through a link

A link with `grantsView: true` lets anyone who opens it see its record. Opening it adds its code to an HTTP-only cookie,
`SameSite=Lax`, and `Secure` over HTTPS, which keeps the last 20 such links. The feature declares a core
[access grant](../../core/better-apps/README.md#access-grants), so checks that pass the request allow the record:

```ts
const allowed = await app.subjects.canView(actor, { subjectType: "invoice", subjectId }, { request })
```

The grant is for seeing the record only, for signed-in people and signed-out visitors alike. Writes keep the app's and
each feature's own rules. A link that's turned off, has expired or was removed grants nothing from the next request on,
and nor does one whose record moved to another organization. Only the app's own read checks that pass the request count
the grant: comments and reactions don't pass it yet.

## Actions

- `create({ target, code?, owner?, grantsView?, expiresAt? })`, where `target` is `{ url }` or
  `{ subjectType, subjectId }`, returns the new link.
- `get({ code })` returns a link.
- `list({ subjectType?, subjectId?, owner?, cursor?, limit? })` pages through the links the caller manages, newest
  first: 20 by default, up to 50. Pass `subjectType` and `subjectId` for one record's, and `owner` for only the caller's
  own, `user`, or their organization's, `org`.
- `update({ code, url?, grantsView?, enabled?, expiresAt? })` changes a link and returns it. `url` is for URL links,
  `enabled: false` turns a link off, and `expiresAt: null` clears its expiry. Each change is checked like `create`.
- `remove({ code })` removes a link and returns `{ removed }`. Its code is free again.
- Each link comes back with its `code`, `shortUrl`, `owner` as `{ type, id }`, `orgId`, `createdBy`, `target`,
  `grantsView`, `enabled`, `expiresAt`, `clicks`, `lastClickedAt`, `createdAt` and `updatedAt`.
- Errors are `ShortLinksError`s: `UNAUTHENTICATED`, `FORBIDDEN` when a rule refuses, `NOT_FOUND` for links and records
  the caller can't see or manage, `INVALID_INPUT`, and `CONFLICT` for a code that's taken.

## Opening a link

`GET {path}/{code}` reads the link by its code, then answers `302 Found` to its target with
`Cache-Control: private, no-store`, so a change to the link takes effect at once. Each `GET` adds a click and sets
`lastClickedAt` in one statement, after the response, through the request's `waitUntil`; without one, the response
waits. `HEAD` requests don't count. Every `GET` does, including link previews chat apps fetch.

## Records and owners that go

Call `app.api.shortLinks.removeSubject({ subjectType, subjectId })` when a record is deleted, and
`removeOwner({ owner: { type, id } })` when a person or an organization leaves. Both are server only, remove every
matching link in one statement, and return `{ removed }`. Until then, a link to a deleted record still redirects, and
the app's page answers for the missing record.

## Events

`link.created`, `link.updated` and `link.removed` carry the link. `subject.removed` and `owner.removed` carry what was
removed and how many links went. Opening a link emits nothing.

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
- `create` puts the new link first in the loaded lists it belongs in. `update` and `remove` show in every list.
- Dates arrive as `Date`s.
- `reset()` empties the store and cancels calls under way, for when someone else signs in without a page load.

`@better-apps/short-links/react` has hooks over the same store, with no UI:

```tsx
import { useLinks } from "@better-apps/short-links/react"

const { links, state, cursor, loadMore, client } = useLinks({ subjectType: "invoice", subjectId })
```

## Tables

`shortLink` holds the links, with a unique index on `code`, an index on the owner and creation time for lists, and one
on the record and creation time for a record's links and their cleanup. Run `better-apps generate` from
[`@better-apps/cli`](../../tooling/cli/README.md) to add it to your schema.
