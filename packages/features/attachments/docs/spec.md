# Attachments spec

`@better-apps/attachments` stores files and attaches them to records. It covers four uses:

- **Files on their own**, such as a person's or an organization's uploads with no record.
- **Files on another feature's record**, such as a comment. A file can be uploaded while the comment is still a draft,
  and attached once the comment is posted.
- **Files on any record an app declares**, such as an invoice.
- **Several files per record**, in an order people can change.

The bytes live in a storage adapter, such as [`@better-apps/storage-r2`](../../../adapters/storage-r2/README.md). The
feature keeps what it knows about each file in two tables, checks every read and write through the app's subject types,
and serves uploads and downloads from `app.handler`.

## Decisions to review

- **The storage slot is the feature's `storage` option**, not a core slot. Attachments is the only feature that stores
  files, so the `StorageAdapter` contract lives in this package, and `storage-r2` imports its types. When a second
  feature needs files, the contract moves to core as a slot next to `database` and `identity`.
- **Uploads go to R2 directly when the adapter can sign URLs, and through the Worker otherwise.** Both finish the same
  way, so the browser client doesn't care which one it got. See [Uploads](#uploads).
- **No signing library.** The R2 adapter signs S3 URLs with SigV4 query signing on Web Crypto, about a hundred lines,
  checked against AWS's published example. `aws4fetch` would do the same, but adding it needs a discussion.
- **Downloads always go through the Worker**, so every download is checked against the record's access at that moment.
- **Image previews are the app's to plug in**, through a `previews` option, such as with Cloudflare's Images binding.
  Without it, the original image is served.
- **The browser client has its own small upload queue and hooks**, and exposes the two steps around the bytes,
  `prepareUpload` and `finishUpload`, for an engine that sends the bytes itself, such as
  [UploadCN](https://uploadcn.dev)'s.
- **A signed upload address can't be revoked**, so attachments never trusts storage to hold what it confirmed. Downloads
  serve only bytes whose etag matches the one recorded when the upload finished, and a deleted file's row waits until
  its upload address has closed, so bytes that arrive late are deleted too.

## Core support

Uploads and downloads stream bytes, which JSON actions can't do. They're feature routes, declared with core's
`defineRoute`: a `path`, a `method` and a `handler` that receives the raw `request`, its parsed `url`, `params`, `db`,
`subjects`, `now`, `getActor()` and `waitUntil`.

- Attachments' routes live under the app's base path, three segments below it, where no action URL can match:
  `PUT /api/apps/attachments/uploads/:fileId` and `GET /api/apps/attachments/files/:fileId/:name`. An app's existing
  catch-all for the base path serves them.
- The upload route reads the request body itself, so `maxBodySize` doesn't apply.
- Responses pass through untouched, including streamed bodies, `206` and `304`.
- Reads pass the request to subject checks, so access a request carries, such as a share link's grant, reaches the
  record's files too: downloads, `listFiles` and `getFile`. Writes leave it out, so a grant never lets anyone add or
  remove files.

Routes can't emit events, and attachments doesn't need them to: an upload finishes with the `completeUpload` action.

## Tables

### `attachmentFile`

One row per stored file.

| Field             | Type         | Holds                                                                                            |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `orgId`           | string       | The organization the file belongs to, or `""` outside any.                                       |
| `owner`           | string, null | `user:{userId}` or `org:{orgId}` for a file kept on its own. `null` for a file kept by a record. |
| `createdBy`       | string       | The user who uploaded it.                                                                        |
| `name`            | string       | The file name, cleaned up: no folders or control characters, at most 255 characters.             |
| `contentType`     | string       | The media type, lowercased, such as `image/png`.                                                 |
| `size`            | number       | Bytes.                                                                                           |
| `storageKey`      | string       | Where the bytes are in the storage adapter: `attachments/{id}`.                                  |
| `status`          | enum         | `pending` until its bytes are confirmed, `ready` after, `deleted` while its bytes are removed.   |
| `subjectType`     | string, null | For a file uploaded for records of one subject type: that type, whose limits it was checked by.  |
| `target`          | string, null | For a file uploaded straight onto a record: that record's id, linked once the upload finishes.   |
| `uploadTokenHash` | string, null | The SHA-256 of the token that lets the Worker route take its bytes. Cleared once it's uploaded.  |
| `expiresAt`       | date, null   | When an unfinished upload or an unattached draft is removed. `null` once something keeps it.     |
| `uploadClosesAt`  | date         | When its upload address stops taking bytes. A deleted file's row stays until an hour after this. |
| `etag`            | string, null | The stored bytes' etag when the upload finished. Downloads serve only bytes that still match it. |
| `createdAt`       | date         |                                                                                                  |
| `uploadedAt`      | date, null   | When its bytes were confirmed.                                                                   |

Indexes:

- `(owner, createdAt)` serves lists of a person's or an organization's own files, newest first.
- `(createdBy, status)` serves removing a person's drafts, and counting them against `maxDrafts`.
- `(status, expiresAt)` serves the sweep of expired files.
- `(status, uploadClosesAt)` serves the sweep of deleted files whose upload address has closed.

### `attachment`

One row per file on a record.

| Field         | Type   | Holds                                                                                           |
| ------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `fileId`      | string | The file, referencing `attachmentFile.id`.                                                      |
| `orgId`       | string | The record's organization when the file was attached, or `""`.                                  |
| `subjectType` | string | The record, as a subject type, so a file follows its record's access.                           |
| `subjectId`   | string |                                                                                                 |
| `position`    | number | Its place in the record's order, from 0.                                                        |
| `slot`        | number | Which of the record's `maxFiles` places it takes. Unique per record, so the limit always holds. |
| `createdBy`   | string | Who attached it.                                                                                |
| `createdAt`   | date   |                                                                                                 |

Indexes:

- `(subjectType, subjectId, orgId, fileId)`, unique: a file is on a record once.
- `(subjectType, subjectId, orgId, slot)`, unique: no record holds more than `maxFiles`, even when two uploads finish at
  the same moment. This is how reactions hold `maxPerUser`.
- `(fileId)` serves a file's records.

`attachmentRemoval` remembers each attachment removed in the last hour, by its id, so a second removal of the same
attachment, such as one racing a cleanup, fails and is reported once. Reactions does the same.

## Ownership

Every file is kept by something, or it expires:

- **A record keeps it** while it's attached there. A file uploaded for a record, or as a draft for one, is kept by one
  record at most. When it leaves that record, it's deleted.
- **A person or an organization keeps it** when it was uploaded on its own: `owner` is `user:{userId}` or `org:{orgId}`.
  Without an `owner` in the upload, a file uploaded inside an organization belongs to it, and one outside any belongs to
  its uploader. Such a file stays until it's deleted, even when it's attached to records and taken off them again. It
  can be on several records at once, such as a logo on many invoices.
- **Nothing keeps it yet** while it's uploading, or while it's a draft waiting for its record. It has an `expiresAt`,
  and the sweep removes it after that.

## Settings

```ts
attachments({
  storage: r2Storage({ bucket: env.FILES }),
  subjects: {
    invoice: {
      canUpload: ({ actor, subjectId }) => invoices.canEdit(actor, subjectId),
      canModerate: ({ actor }) => actor.roles.includes("admin"),
      contentTypes: ["application/pdf", "image/*"],
      maxSize: 20 * 1024 * 1024,
      maxFiles: 10
    },
    [commentSubjectTypes.comment]: { contentTypes: ["image/*"], maxFiles: 4 }
  },
  standalone: {
    canUpload: ({ actor }) => actor.orgId !== null,
    canManage: ({ actor }) => actor.roles.includes("admin")
  },
  maxSize: 10 * 1024 * 1024,
  secret: env.ATTACHMENTS_SECRET
})
```

- `subjects` lists the subject types files can be attached to. The app or a feature must declare each one. For each:
  - `canUpload(args)` says who can add files to a record. Everyone who can see it, by default.
  - `canModerate(args)` says who can take anyone's files off a record. Nobody, by default. Anyone who can see the record
    can take off the files they attached.
  - `contentTypes` lists the media types allowed, exactly or as `type/*`. Any, by default.
  - `maxSize` is the largest file in bytes. `maxFiles` is how many files one record holds, from 1 to 30: 10 by default.
- `standalone` allows files on their own, with no record. It's off without it.
  - `canUpload(actor)` says who can upload one. Everyone signed in, by default.
  - `canManage({ actor, orgId })` says who can delete an organization's files. Every member, by default. A person's own
    files are theirs alone.
  - `contentTypes` and `maxSize` work as above.
- `contentTypes` and `maxSize` at the top are the defaults for every subject type and for `standalone`. `maxSize` is 25
  MiB by default.
- `path` is where the routes are, `/api/apps/attachments` by default. Set it with the app's `basePath`.
- `baseUrl` is the origin of the URLs the actions return, such as for emails. Without it, they're paths on the same
  origin.
- `secret`, at least 32 characters, signs download URLs, so `<img src>` works for apps whose sign-in is a bearer token,
  and a link in an email works for a while. Without it, downloads need the request's own sign-in, such as a cookie.
- `uploadTtl` is how long an upload URL works, 15 minutes by default. `draftTtl` is how long a draft waits for its
  record, 24 hours by default. `downloadTtl` is how long a signed download URL works, an hour by default.
- `maxDrafts` is how many files one person can have uploading or waiting as drafts at once, from 1 to 1000: 50 by
  default. Deleted uploads count until their address closes, since it still takes bytes; files a record or an owner
  keeps don't count. The count comes after the new row is written, and an upload over the cap removes its row, so
  uploads started at once can't pass it together.
- `previews` turns on image previews. See [Image previews](#image-previews).

Limits are checked when the upload starts, against what the browser declares, and again when it finishes, against what
storage holds. A file attached later is checked against its record's subject type again.

## Permissions

All of them go through subject types, so a file follows its record's access.

- **Seeing a file** needs one of:
  - a record it's on that the person can see, by `subjects.canViewMany`, in one call per subject type;
  - for a file kept on its own, being its owner, or a member of its owning organization;
  - for an unfinished upload or a draft, having uploaded it. Signed-out visitors see files on public records.
- **Uploading onto a record** needs someone who can see it and whom `canUpload` allows.
- **Uploading a draft** needs someone signed in. The draft is checked against its subject type's limits, but its record
  doesn't exist yet, so `canUpload` waits for the attach. `maxDrafts` bounds the bytes a person can store that way.
- **Attaching** a draft needs its uploader. Attaching a file kept on its own needs someone who can see it. Either way
  the record must be one the person can see and `canUpload` allows. Files go only on records in their own organization,
  except that a person can put their own files on records in any organization they're in.
- **Taking a file off a record** needs the person who attached it, or someone `canModerate` allows. **Reordering** needs
  `canUpload`.
- **Deleting a file kept on its own** needs its owner, or a member `canManage` allows. It comes off every record too.
- **Server code** that passes neither an actor nor a request is trusted: it reads and removes anything. It can't upload,
  since a file is always someone's.
- A file someone can't see answers `NOT_FOUND`, as if it didn't exist.

Attachments declares a subject type for files, `attachments.file`, with these rules, so other features can attach to a
file, such as comments on a document.

## Uploads

An upload takes three steps, the same for both ways of sending the bytes:

1. `createUpload({ name, contentType, size, ... })` checks the person and the limits, writes a `pending` row, and
   returns where to send the bytes: `{ file, upload: { url, method: "PUT", headers, expiresAt } }`.
2. The browser sends the bytes with that request.
3. `completeUpload({ fileId })` reads the stored object's size, type and etag from storage, checks them against the row
   and the limits, and marks the file `ready` with that etag. A file uploaded onto a record is attached in the same
   batch. A mismatch deletes the bytes and answers `INVALID_INPUT`. When two calls finish one file at once, one marks it
   ready, and both return it.

Where the upload is aimed:

- `subjectType` and `subjectId`: onto an existing record, such as an invoice.
- `subjectType` alone: a draft for a record of that type, such as a comment that isn't posted yet. Attach it with
  `attach({ subjectType, subjectId, fileIds })` once the record exists.
- Neither: a file on its own, with an optional `owner: "user" | "org"`. Needs `standalone`.

### Two ways to send the bytes

**Straight to R2, with a signed URL.** When the storage adapter can sign URLs, as `r2Storage` does with S3 credentials,
`upload.url` is a SigV4 presigned `PUT` to R2's S3 endpoint. The signature covers `content-type` and `content-length`,
so R2 refuses any other type or size. It works up to R2's single upload limit, about 5 GB, and the bytes never touch the
Worker. The bucket needs a CORS rule that allows `PUT` from the app's origin with those two headers. The S3 API works
only on the `r2.cloudflarestorage.com` endpoint, not on a bucket's custom domain.

**Through the Worker.** Without signing, as with Void's plain R2 binding, `upload.url` is the feature's own route,
`PUT {path}/uploads/{fileId}?token=...`. The token is random, and only its SHA-256 is stored, so the database never
holds a working upload URL. The route checks the token, that the file is still `pending` and its URL hasn't expired, and
that `content-type` and any `content-length` match the row, then streams the body straight to storage. A body without a
length, such as a chunked one or one over HTTP/2, is counted as it arrives: past the declared size, the upload stops
with `PAYLOAD_TOO_LARGE`, and one that ends short answers `INVALID_INPUT`. Storage takes exactly the declared size too:
the R2 adapter streams the body through a `FixedLengthStream`, which also gives the binding the known length it needs.
It works up to the Worker's request size limit: 100 MB on the Free and Pro plans.

Both ways send the same `PUT` with the same headers, so the browser client handles both alike and reports progress for
either. A file over those limits can't be uploaded.

## Downloads

`GET {path}/files/{fileId}/{name}` serves a file, and `HEAD` its headers.

- **Who:** a `token` and `expires` in the query, signed with `secret` over the file's id and expiry, lets anyone with
  the URL download that one file until it expires. Without a valid token, the request's own sign-in is checked as for
  seeing a file. A file someone can't see answers 404. A file that isn't `ready` answers 404.
- **Signed URLs:** `listFiles`, `getFile` and `completeUpload` return each file's `url`, signed when there's a `secret`.
  Expiry is rounded up to the next `downloadTtl` boundary, so a page that loads twice gets the same URL, and the browser
  can cache it.
- **Bytes:** streamed from storage, with `ETag`, `Last-Modified`, `Content-Length` and `Accept-Ranges: bytes`. Storage
  is read on condition that its etag still matches the one recorded when the upload finished; bytes replaced since, such
  as through a signed upload address used again, answer 409 `CONFLICT` and aren't served. An `If-None-Match` with that
  etag answers 304 without reading storage. One `Range` answers 206; a range past the end answers 416. Several ranges
  are served as the whole file.
- **Safety:** `Content-Type` is the stored type, with `X-Content-Type-Options: nosniff`. Raster images, audio, video,
  PDF and plain text are served `inline`; everything else, including SVG and HTML, as `attachment`, so a file can't run
  script on the app's origin. `?download=1` asks for `attachment` for any file. Every response but PDF's carries
  `Content-Security-Policy: sandbox`, so even an inline file has no access to the origin. The file name is sent in
  `Content-Disposition` as `filename*`, encoded per RFC 5987, with an ASCII `filename` fallback.
- **Caching:** `Cache-Control: private`, so shared caches never keep a file. A signed URL is kept until it expires.
  Without one, the browser asks again each time with the etag, `no-cache`, so a file taken off a record, or one a person
  can't see after signing out, never comes from the cache; an unchanged file costs a `304`.

### Image previews

`?w=` asks for an image at a width. With a `previews` option, the route snaps the width up to one of `widths`, by
default 96, 256, 640, 1280 and 1920, and calls `transform({ file, object, width, request })` with the stored object. The
app returns a `Response`, such as from Cloudflare's Images binding:

```ts
previews: {
  transform: async ({ object, width }) =>
    (await env.IMAGES.input(object.body).transform({ width }).output({ format: "image/webp" })).response()
}
```

Only `image/png`, `image/jpeg`, `image/gif`, `image/webp` and `image/avif` get previews. Snapping keeps the number of
distinct transformations small, which matters for Images' pricing, billed by unique transformations. A preview's etag is
the file's etag and the width, so an `If-None-Match` answers 304 before storage is read or a preview made. `HEAD` checks
storage but makes no preview, so it leaves out `Content-Type` and `Content-Length`. Without `previews`, `?w=` is ignored
and the original is served.

## Files that are never attached

- An upload that never finishes stays `pending` until its URL expires, after `uploadTtl`.
- A draft that's never attached expires after `draftTtl`.
- A file that leaves its only record is marked `deleted` at once.

`app.api.attachments.sweep()` removes all of these, a page at a time: up to 100 files whose `expiresAt` has passed or
that are `deleted`. Each page marks the expired ones `deleted` in one batch, guarded by their `expiresAt`, so a draft
attached meanwhile is never taken. It reads back which ones it marked, deletes their bytes in one storage call, then
their rows and any attachments left pointing at them. It returns `done`. Call it from a scheduled job, next to
`app.deliverEvents()`, a few pages a run: each page takes up to about ten queries, and D1 allows 50 a Worker invocation
on the Free plan, so a backlog, such as many drafts expiring at once, drains over the next runs.

A deleted file's bytes go at once, but its row stays `deleted` until an hour after `uploadClosesAt`, since a signed
upload address keeps working until it expires, and a slow upload that started in time may finish later still. The sweep
then deletes the bytes again, in case some arrived, and the row. Bytes that fail to delete are tried again the same way.

## Records that change

Attachments keep the organization of the record when they were attached. When a record moves to another organization,
its attachments stay hidden, and don't count toward its limit there, until server code calls
`app.api.attachments.moveSubject({ subjectType, subjectId, toOrgId })`, which moves the attachments and the files the
record keeps. Files kept on their own stay with their owner, and stay on the record.

`removeSubject({ subjectType, subjectId })` takes every file off a deleted record and deletes the files it kept.
`removeUser({ userId })` deletes a person's own files and drafts, and their uploads that haven't finished. Files they
attached to records stay with the records. These are server only. Each call does one page, removing up to 100
attachments or moving up to 30, and returns `done`, so no request outgrows D1's limits of 100 bound parameters a
statement and 50 queries a request; call again until `done` is `true`. A page whose batch fails, such as one that lost a
race with another removal, is read again.

With files on comments' threads or comments, attachments follow comments' events, as reactions do: a deleted comment or
thread loses its files, and a moved thread takes its and its comments' files along. Each delivery handles one page,
reading at most ten lists of 90 ids, and the rest continues with attachments' own `cleanup.continued` event, emitted
`{ later: true }` for the next `app.deliverEvents()` run. A move continues only while the thread is still in the
organization it moved to. A comment deleted while a file is attached to it can't keep the file: `attach` checks the
record again after it's written and takes the file back off when the record went away meanwhile.

## Events

- `file.uploaded` once a file's bytes are confirmed, with the file.
- `file.deleted` when a file is removed, with why: `deleted` by a person, `detached` from its only record, its record
  `subjectRemoved`, its uploader `userRemoved`, or `expired`.
- `attachment.added` and `attachment.removed`, with the record, its organization, the attachment and the file.
  `attachment.removed` says why: `detached`, `moderated`, `fileDeleted`, `subjectRemoved` or `withdrawn`. Removals of
  many at once are marked `bulk`.
- `attachments.reordered` when a record's order changes.
- `subject.changed` for each record a page of a bulk removal touched, `subject.moved` for each record a page of a move
  touched, and `subject.removed` and `user.removed` once those finish.
- `cleanup.continued`, attachments' own, for cleanups that continue in the next run.

`toClientEvent({ event, viewer })` and `toClientEvents({ event, viewers })`, server only, turn an event into what a
browser may see: `{ id, type: "subject.changed", subjectType, subjectId }` for any change to a record's files that the
viewer can see the record of, so the browser loads the record again. Files change rarely, so one kind of client event is
enough.

## Actions

- Reads: `listFiles({ subjectType, subjectIds })` returns each record's files in order, up to 20 records a call;
  `getFile({ fileId })`; `listOwnFiles({ owner, cursor?, limit? })` pages a person's or an organization's own files,
  newest first; `getSettings({ subjectType })` returns the limits, for a picker's `accept` and checks before sending.
- Writes: `createUpload`, `completeUpload`, `attach`, `detach`, `reorder({ subjectType, subjectId, fileIds })` and
  `deleteFile`, which also cancels an upload or a draft of the caller's.
- Server only: `sweep`, `removeSubject`, `moveSubject`, `removeUser`, `toClientEvent` and `toClientEvents`.

Errors are `AttachmentsError`s: `UNAUTHENTICATED`, `NOT_FOUND`, `FORBIDDEN`, `INVALID_INPUT` for a type, name or file
that doesn't fit, `PAYLOAD_TOO_LARGE` past `maxSize`, `LIMIT_EXCEEDED` past `maxFiles` or `maxDrafts`, and `CONFLICT`
for a file that changed meanwhile, such as an expired draft, one another record took first, or bytes replaced after they
were confirmed.

## In the browser

`@better-apps/attachments/client` keeps each record's files and the uploads under way in a store, with no server code:

```ts
const attachments = createAttachmentsClient(client)
await attachments.load("invoice", ["inv-1"])
const file = await attachments.upload(input.files[0], { subjectType: "invoice", subjectId: "inv-1" })
```

- `load(subjectType, subjectIds)` batches loads of the same tick, 20 records a call.
- `prepareUpload(file, target)` checks the file against the loaded limits and calls `createUpload`, and
  `finishUpload(prepared)` calls `completeUpload` and adds the file to its record's list. They're the two steps around
  the bytes, for an engine that sends them itself, such as [UploadCN](https://uploadcn.dev)'s.
- `upload(file, target)` runs the three steps. It sends the bytes with `XMLHttpRequest`, for progress, or with `fetch`
  where there's none, and takes a `transport` for tests. `uploads[id]` holds
  `{ name, size, loaded, state, error, file }` while it runs, `state` being `uploading`, `finishing`, `done`, `error` or
  `cancelled`. `startUpload` does the same and returns the upload's id at once. `cancel(id)` stops one and deletes what
  the server knew of it. A file the limits from `loadSettings` refuse fails at once, without a call.
- An upload onto a record adds the file to the record's list when it finishes. `detach` and `reorder` show at once and
  roll back when the server refuses. `attach` loads the record again once it's done.
- `applyEvent` takes events from `toClientEvent` and loads the record again. `dehydrate`, `hydrate` and `reset` work as
  in the other features.

`@better-apps/attachments/react` has hooks, with no UI:

- `useAttachments(subject)`: `{ files, state, error, detach, reorder, isPending }`, loaded on first use. Records that
  mount together load in one call.
- `useUpload(target)`: `{ upload(files), uploads, cancel, dismiss }` for a record that exists, or files on their own.
- `useDraftAttachments(subjectType)`: for a composer. `add(files)` uploads drafts, `uploads` shows them, `remove(id)`
  cancels or deletes one, `attachTo(subjectId)` attaches the finished ones once the record is saved, and `clear()`
  empties the composer.
- `useAttachmentSettings(subjectType)`: the limits, for a picker's `accept`.

Apps announce progress and errors themselves, such as with a polite live region for progress and an alert for a failure.
The example app shows one way.

## Storage adapters

```ts
interface StorageAdapter {
  id: string
  put(key, body, { size, contentType }): Promise<StoredObject>
  get(key, { range?, etagMatches? }): Promise<StoredBody | StoredObject | null>
  head(key): Promise<StoredObject | null>
  delete(keys): Promise<void>
  /** Signs a direct upload. Adapters that can't leave it out, and uploads go through the Worker. */
  createUploadUrl?(key, { contentType, size, expiresIn }): Promise<{ url; headers }>
}
```

- `get` with an `etagMatches` that isn't the object's etag returns the object without a body, so bytes replaced after an
  upload finished are never served.
- `delete` takes many keys at once; R2 takes up to 1000 in one call.

Two adapters:

- **`r2Storage({ bucket, s3? })`** in `@better-apps/storage-r2` wraps an R2 binding, such as Void's `void/storage`. With
  `s3: { accountId, accessKeyId, secretAccessKey, bucketName }`, it also signs direct uploads. The keys need only object
  read and write on that bucket.
- **`memoryStorage()`**, exported from `@better-apps/attachments`, keeps objects in memory, for tests and demos. It
  implements `createUploadUrl` only when asked, `memoryStorage({ signedUploads: true })`, so tests cover both ways.
