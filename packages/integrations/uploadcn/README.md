# @better-apps/uploadcn

Uploads files through [`@better-apps/attachments`](../../features/attachments/README.md) with
[UploadCN](https://uploadcn.dev)'s upload engine and React primitives. Attachments keeps its rules: who may upload
where, the subject type's limits, drafts, signed or routed uploads and the server's check of the bytes. UploadCN queues
the files, sends them with progress, retries them and shows them. A file uploaded onto a record joins the record's list
in `useAttachments`, and drafts are handed to their record once it's saved, as files uploaded any other way are.

Install `@uploadcn/core`, and `@uploadcn/react` for the hooks, alongside it. The hooks need
[`@better-apps/react`](../react/README.md)'s `BetterAppsProvider` above them, as attachments' own hooks do.

## Usage

```tsx
import { useAttachments } from "@better-apps/attachments/react"
import { useAttachmentsUploader } from "@better-apps/uploadcn/react"
import { Upload } from "@uploadcn/react"

function InvoiceFiles({ invoiceId }: { invoiceId: string }) {
  const invoice = { subjectType: "invoice", subjectId: invoiceId } as const
  // Loads the invoice's files, which finished uploads join and the places left are counted from.
  const { files } = useAttachments(invoice)
  const uploader = useAttachmentsUploader(invoice)
  return (
    <Upload.Root uploader={uploader} multiple>
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
      <ul>
        {files.map((file) => (
          <li key={file.id}>{file.name}</li>
        ))}
      </ul>
    </Upload.Root>
  )
}
```

Files picked before their record exists, such as a comment's before it's posted, upload at once as drafts:

```tsx
const drafts = useDraftUploader("comments.comment")
// Give drafts.uploader to the comment box's Upload.Root. drafts.busy says whether one hasn't finished.
const picked = drafts.take() // before saving, so files picked meanwhile wait for the next comment
const comment = await saveComment()
await picked.attachTo(comment.id)
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
  check them. The file's `FileInfo` becomes the item's `result`. A file with no type, as some systems give a CSV, goes
  as the type UploadCN takes from its extension.
- `uploadLimits(settings, { existing })` gives UploadCN the subject type's media types, which also limit the file
  picker, its size limit, and the places left on a record that holds `existing` files. The hooks keep these current as
  the settings load and the record's list changes. A record whose list hasn't loaded and drafts get all of their
  record's places, and files on their own get no count. They hand the limits to UploadCN as they render, because
  `Upload.Root` reads them while rendering, so its file picker takes only the allowed types once the settings load.
  Every limit is given, with `[]` for any type and `Infinity` for any number of files, because `useUploader` merges
  options and would keep a limit that's left out.
- Failures are UploadCN errors with attachments' message, and attachments' code in `details.code`:
  - A refusal that won't change, such as a type the record doesn't take, is `rejected` and never retried.
  - A full record or too many drafts fail without an automatic retry, so they can be tried again by hand once there's
    room.
  - A lost connection, a server error, rate limiting and an upload that expired are retried, then can be tried again by
    hand.
- An attempt after a failure keeps the prepared upload in the item's resume state, unless its address closes within 30
  seconds, and doesn't send bytes that already arrived. A send to an address that's gone, which the upload route says
  with `NOT_FOUND` and storage with 403, starts over with a new address. A file the route refuses, or one too large to
  store, is refused for good. Either way the old pending file is deleted, and other failed sends go to the same address
  again. Headers a browser refuses to set, such as a signed `content-length`, aren't sent. An upload that starts over
  shows its progress from nothing again.
- A finish the server refuses deletes the pending file, so trying again by hand starts over, and one that finds the
  upload gone, such as after the sweep, starts over at once. A finish whose first answer was lost loads the record
  again, so the file shows.
- Cancelling or removing an unfinished upload deletes its file, before a finish still under way can put it on its
  record. A file that got there first comes off its record. A file the server prepared just as its upload stopped is
  deleted too.
- `useAttachmentsUploader(target, options)` returns an UploadCN uploader. Options go to UploadCN's `useUploader` and win
  over the limits. Each upload goes to the target it was added for, even after the target changes. On a record, a
  finished upload leaves the queue once it's on the record's list, which `useAttachments` shows. Drafts and files on
  their own stay in the queue.
- `useDraftUploader(subjectType, options)` returns `{ uploader, busy, take, clear }`. `take()`, called before the record
  is saved, takes the drafts picked so far, and its `attachTo(subjectId)` puts those that finished on the saved record,
  then takes them all off the queue. Drafts picked after `take` stay, for the next record. A draft is attached once,
  even by two hand-offs, and stays in the queue when it can't be attached. `clear()` empties the queue. Removing a draft
  that finished deletes it, so it doesn't wait for the sweep, unless it's being attached.
- Pass `multiple` to `Upload.Root`. Without it, a root takes a single file when one place is left, and a pick replaces
  every upload in the queue, stopping those under way.
- `isUnderWay(item)` says whether an upload is still checked, waiting, sending or being processed.
- UploadCN's own checks, such as for a file that's too large, use UploadCN's wording, which its options don't change.
  `Upload.Root`'s `messages` change its status labels, announcements and action labels.

The [example app](../../../apps/example/README.md)'s Files panel and comment boxes use it with the kit's components.
