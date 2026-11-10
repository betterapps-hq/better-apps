# @better-apps/uploadcn

Uploads files through [`@better-apps/attachments`](../../features/attachments/README.md) with
[UploadCN](https://uploadcn.dev)'s upload engine and React primitives. Attachments keeps its rules: who may upload
where, the subject type's limits, drafts, signed or routed uploads and the server's check of the bytes. UploadCN queues
the files, sends them with progress, retries them and shows them. A file uploaded onto a record joins the record's list
in `useAttachments`, and drafts attach with `attachTo`, as files uploaded any other way do.

Install `@uploadcn/core`, and `@uploadcn/react` for the hooks, alongside it. The hooks need
[`@better-apps/react`](../react/README.md)'s `BetterAppsProvider` above them, as attachments' own hooks do.

## Usage

```tsx
import { useAttachmentsUploader } from "@better-apps/uploadcn/react"
import { Upload } from "@uploadcn/react"

function InvoiceFiles({ invoiceId }: { invoiceId: string }) {
  const uploader = useAttachmentsUploader({ subjectType: "invoice", subjectId: invoiceId })
  return (
    <Upload.Root uploader={uploader}>
      <Upload.Trigger>Add files</Upload.Trigger>
      <Upload.List>
        <Upload.Item>
          <Upload.Name />
          <Upload.Progress />
          <Upload.Error />
          <Upload.Retry>Try again</Upload.Retry>
          <Upload.Remove>Remove</Upload.Remove>
        </Upload.Item>
      </Upload.List>
    </Upload.Root>
  )
}
```

Files picked before their record exists, such as a comment's before it's posted, upload at once as drafts:

```tsx
const drafts = useDraftUploader("comments.comment")
// Give drafts.uploader to the comment box's Upload.Root. drafts.busy says whether one is still uploading.
await drafts.attachTo(comment.id) // once the comment is saved
```

Without React, give UploadCN's `createUploader` the adapter and the limits:

```ts
import { attachmentsAdapter, uploadLimits } from "@better-apps/uploadcn"
import { createUploader } from "@uploadcn/core"

const attachments = createAttachmentsClient(client)
const uploader = createUploader({
  adapter: attachmentsAdapter(attachments, { owner: "user" }),
  ...uploadLimits(await attachments.loadSettings())
})
```

`attachmentsAdapter` takes the target, or a function of the UploadCN item that returns it, and a `transport` for tests.
It only takes the subject types of the client's app.

## Behavior

- An upload prepares the file with attachments' `prepareUpload`, which checks it against the loaded limits and asks the
  server where to send it. UploadCN's transport sends the bytes there, with progress, and `finishUpload` has the server
  check them. The file's `FileInfo` becomes the item's `result`.
- `uploadLimits(settings, { existing })` gives UploadCN the subject type's media types, which also limit the file
  picker, its size limit, and the places left on a record that holds `existing` files. The hooks keep these current as
  the settings load and the record's list changes. Drafts get all of their record's places, and files on their own get
  no count.
- Failures are UploadCN errors with attachments' message, and attachments' code in `details.code`:
  - A refusal that won't change, such as a type the record doesn't take, is `rejected` and never retried.
  - A full record or too many drafts fail without an automatic retry, so they can be tried again by hand once there's
    room.
  - A lost connection, a server error, rate limiting and an upload that expired are retried, then can be tried again by
    hand.
- An attempt after a failure keeps the prepared upload in the item's resume state, unless its address closes within 30
  seconds, and doesn't send bytes that already arrived. A send that storage refuses, such as to an address that expired,
  starts over with a new address, and the old pending file is deleted.
- Cancelling or removing an unfinished upload deletes its file, and takes it off its record first when its bytes got
  there.
- `useAttachmentsUploader(target, options)` returns an UploadCN uploader. Options go to UploadCN's `useUploader` and win
  over the limits. On a record, a finished upload leaves the queue once it's on the record's list. Drafts and files on
  their own stay in the queue.
- `useDraftUploader(subjectType, options)` returns `{ uploader, busy, attachTo, clear }`. `attachTo(subjectId)` puts the
  drafts that finished on the saved record, then empties the queue. `clear()` empties it. Removing a draft that finished
  deletes it, so it doesn't wait for the sweep.
- UploadCN's own checks, such as for a file that's too large, use UploadCN's wording, which its options don't change.
  `Upload.Root`'s `messages` change its status labels, announcements and action labels.

The [example app](../../../apps/example/README.md)'s Files panel and comment boxes use it with the kit's components.
