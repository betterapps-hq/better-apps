# @better-apps/attachments

Files on any record an app owns, such as an invoice, on another feature's records, such as comments, or on their own.
Files store only their record's type and id; the app's subject types say who can see the record, so whoever can see it
sees its files. Bytes go to a storage adapter, such as [`@better-apps/storage-r2`](../../adapters/storage-r2/README.md),
straight from the browser when the adapter signs uploads, or through the app's server otherwise.

The [spec](docs/spec.md) explains the design: the tables, ownership, how uploads and downloads work, cleanup, and what's
left for later.

## Usage

```ts
import { attachments } from "@better-apps/attachments"
import { commentSubjectTypes, comments } from "@better-apps/comments"
import { r2Storage } from "@better-apps/storage-r2"
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
    comments(commentOptions),
    attachments({
      storage: r2Storage({ bucket: env.FILES }),
      subjects: {
        invoice: {
          canUpload: ({ actor, subjectId }) => invoices.canEdit(actor, subjectId),
          canModerate: ({ actor }) => actor.roles.includes("admin"),
          contentTypes: ["application/pdf", "image/*"],
          maxFiles: 10
        },
        [commentSubjectTypes.comment]: { contentTypes: ["image/*"], maxFiles: 4 }
      },
      standalone: {},
      secret: env.ATTACHMENTS_SECRET
    })
  ]
})
```

Call the sweep from a scheduled job, next to event delivery, so uploads that never finish and drafts that are never
attached are removed:

```ts
export default {
  fetch: (request, env, ctx) => app.handler(request, ctx),
  scheduled: (event, env, ctx) =>
    ctx.waitUntil(
      (async () => {
        await app.deliverEvents({ waitUntil: (promise) => ctx.waitUntil(promise) })
        let swept = await app.api.attachments.sweep()
        while (!swept.done) {
          swept = await app.api.attachments.sweep()
        }
      })()
    )
}
```

- `storage` keeps the bytes. `memoryStorage()` from this package keeps them in memory, for tests and demos.
- `subjects` lists the subject types files can go on. `canUpload` says who adds files, everyone who can see the record
  by default; `canModerate` says who takes anyone's off, nobody by default. `contentTypes` takes exact types or
  `image/*`, `maxSize` is in bytes, 25 MiB by default, and `maxFiles` is from 1 to 30, 10 by default.
- `standalone` allows files on their own, owned by a person or an organization. `canManage` says who deletes an
  organization's files.
- `secret`, at least 32 characters, signs download URLs so they work without the request's sign-in for an hour, such as
  in `<img src>` with a bearer token.
- `path` is where the upload and download routes are, `/api/apps/attachments` by default. `baseUrl` makes returned URLs
  absolute. `uploadTtl`, `draftTtl` and `downloadTtl` are in seconds. `previews` makes image previews with the app's
  transform, such as Cloudflare's Images binding.

The routes, `PUT {path}/uploads/:fileId` and `GET {path}/files/:fileId/:name`, are core routes, so `app.handler` serves
them besides actions, and an app's catch-all route for its base path reaches them.

## Uploads

1. `createUpload({ name, contentType, size, subjectType?, subjectId?, owner? })` checks the person and the limits and
   returns `{ file, upload: { url, method, headers } }`. With `subjectType` and `subjectId`, the file goes onto that
   record. With `subjectType` alone, it's a draft for a record that doesn't exist yet, such as a comment being written.
   With neither, it's a file on its own.
2. The browser sends the bytes: `PUT` to `upload.url` with `upload.headers`.
3. `completeUpload({ fileId })` checks what storage holds and marks the file ready, attaching it to its record.

Attach drafts with `attach({ subjectType, subjectId, fileIds })` once the record exists. Drafts that aren't attached
expire after `draftTtl`, a day by default.

## Actions

- Reads: `listFiles({ subjectType, subjectIds })` for up to 20 records, in each record's order; `getFile({ fileId })`;
  `listOwnFiles({ owner: "user" | "org", cursor?, limit? })`; and `getSettings({ subjectType? })`.
- Writes: `createUpload`, `completeUpload`, `attach`, `detach({ subjectType, subjectId, fileId })`,
  `reorder({ subjectType, subjectId, fileIds })` and `deleteFile({ fileId })`.
- Server only, through `app.api.attachments`: `sweep`, `removeSubject`, `moveSubject` and `removeUser`, which each do
  one page and return `done`, and `toClientEvent` and `toClientEvents` for live updates.
- Errors are `AttachmentsError`s: `UNAUTHENTICATED`, `NOT_FOUND` for files and records the caller can't see,
  `FORBIDDEN`, `INVALID_INPUT`, `PAYLOAD_TOO_LARGE` (413) past `maxSize`, `LIMIT_EXCEEDED` past `maxFiles`, and
  `CONFLICT` for an upload that expired or hasn't arrived.

With files on comments' threads or comments, attachments follow comments' events: a deleted comment or thread loses its
files, and a moved thread takes them along. Attachments also declares `attachments.file` as a subject type, so other
features can attach to a file.

## Downloads

`GET {path}/files/:fileId/:name` checks the file's records on every request, or a signed URL's token, and streams the
file with `ETag`, `Range` and `HEAD` support. Access the request carries, such as a share link's grant, counts for
downloads, `listFiles` and `getFile`, but never for changes. Files that could run script, such as SVG and HTML, always
download rather than open, and every response but a PDF's carries `Content-Security-Policy: sandbox` and
`X-Content-Type-Options: nosniff`. `?download=1` asks for a download; `?w=` asks for a preview when `previews` is set.

## In the browser

`@better-apps/attachments/client` keeps records' files and uploads in a store. `@better-apps/attachments/react` has
hooks over it, with no UI:

```tsx
import { useAttachments, useDraftAttachments, useUpload } from "@better-apps/attachments/react"

const { files, detach, reorder } = useAttachments({ subjectType: "invoice", subjectId })
const { upload, uploads, cancel } = useUpload({ subjectType: "invoice", subjectId })
const drafts = useDraftAttachments("comments.comment")
// drafts.add(files) while writing, then drafts.attachTo(comment.id) once the comment is posted.
```

- Uploads report `loaded` bytes as they go, through `XMLHttpRequest`, and `state`: `uploading`, `finishing`, `done`,
  `error` or `cancelled`. Announce them in the app, such as in a polite live region.
- `prepareUpload(file, target)` and `finishUpload(prepared)` on the client are the steps around the bytes, for an engine
  that sends them itself, such as [UploadCN](https://uploadcn.dev)'s. The [spec](docs/spec.md#uploadcn) maps an UploadCN
  adapter onto them.
- `useAttachmentSettings(subjectType)` loads the limits, for a file input's `accept`. Once loaded, files they refuse
  fail at once, without a call.
- `detach` and `reorder` show at once and roll back when the server refuses. `applyEvent` loads a record again for an
  event from `toClientEvent`. `dehydrate`, `hydrate` and `reset` work as in the other features.

## Tables

`attachmentFile` holds each file, `attachment` puts files on records, with a unique place per record so `maxFiles` holds
even when uploads finish together, and `attachmentRemoval` remembers removals for an hour so each is reported once. Run
`better-apps generate` from [`@better-apps/cli`](../../tooling/cli/README.md) to add them to your schema.
