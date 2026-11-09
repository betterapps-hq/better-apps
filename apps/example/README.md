# Better Apps example

Better Invoices, a small invoicing app built with [TanStack Start](https://tanstack.com/start) that runs
[Better Apps](../../packages/core/better-apps/README.md) features on SQLite, wired with
[`@better-apps/tanstack-start`](../../packages/integrations/tanstack-start/README.md). People sign in with
[Better Auth](https://www.better-auth.com), and
[`@better-apps/identity-better-auth`](../../packages/adapters/identity-better-auth/README.md) tells features who they
are. Teammates discuss invoices in comment threads pinned to their details, mention each other, react to comments and
attach files to invoices and comments.

Build the packages it uses once, then start it:

```sh
pnpm exec vp run --cache --filter "@better-apps/example^..." build
pnpm --filter @better-apps/example dev
```

Then open <http://127.0.0.1:4190>. `build` and `preview` run the production build at <http://127.0.0.1:4191>.

## What's in it

- **Invoices** are the app's own tables, `invoice` and `invoice_line` in `src/db/schema.ts`. The list page totals what's
  outstanding, overdue, paid and in drafts. Its table runs on [TanStack Table](https://tanstack.com/table): a search of
  numbers, customers and emails, a filter by one or more statuses with how many invoices have each, sortable columns and
  pages. The search and the status filter are kept in the URL. The detail page shows the invoice as the customer gets
  it: who it bills, its dates and status, line items, tax and totals. Signed-in people can mark a draft as sent, record
  a payment, or move an invoice back, through the server functions in `src/invoices.functions.ts`. The app adds 15
  sample invoices from `src/db/seed.ts` on start.
- **Comments** from [`@better-apps/comments`](../../packages/features/comments/README.md) attach to invoices, in a panel
  beside the invoice. Hovering or focusing a detail, such as the customer, a line item or the totals, shows a button
  that starts a thread pinned to it, with an [`@better-apps/anchors`](../../packages/features/anchors/README.md) element
  anchor. Pins on the invoice count each detail's open threads and open the first one. Hovering a thread points out its
  detail. Threads can be replied to, resolved and reopened, and moved to another detail or the whole invoice. Their
  authors can edit and delete their own comments. The UI is in `src/invoice-comments.tsx`; the hooks and the store come
  from `@better-apps/comments/react`.
- **Mentions** use `useSuggestMentions`. Typing `@` in any comment box suggests people who can see the invoice, and
  picking one writes an [`@better-apps/mentions`](../../packages/features/mentions/README.md) token into the comment,
  which shows as the person's name. The composer is `src/mention-textarea.tsx`.
- **Reactions** from [`@better-apps/reactions`](../../packages/features/reactions/README.md) attach to comments. Each
  person picks one of four emoji, and picking another replaces it (`maxPerUser: 1` in `src/features.ts`). Hovering or
  focusing a reaction shows who reacted with it. The workspace owner can remove a comment's reactions, all of them or
  one emoji's, from the comment's menu. The UI is in `src/comment-reactions.tsx`; a thread's comments load their
  reactions in one call.
- **Files** from [`@better-apps/attachments`](../../packages/features/attachments/README.md) go on invoices and on
  comments. The invoice page has a Files panel: add files, watch each upload's progress, open or download a file, move
  it up or down, and delete it. Whoever added a file can delete it, and so can Ada. Comment boxes have a paperclip:
  files upload while the comment is written and attach once it's posted, with `useDraftAttachments`. Images show a
  thumbnail. Uploads, moves and deletions are announced in a polite live region, and failures in an alert. The UI is in
  `src/invoice-files.tsx`. The bytes go in a folder through the storage adapter in `src/folder-storage.server.ts`, where
  a Worker would use [`@better-apps/storage-r2`](../../packages/adapters/storage-r2/README.md). On start, the server
  sweeps away uploads that never finished and drafts that were never posted.
- **Notes**, at `/notes`, is a tiny feature in `src/features.ts`. Its loader calls a server function that calls
  `api.notes.list()` as the request's user, and the form posts to `/api/apps/notes/add` from the browser.
- Pages render on the server with their comments. Loaders call server functions in `src/comments.functions.ts`, which
  load a comments store through the bound `client()` and return its snapshot, and the router in `src/router.tsx` carries
  the store to the browser, so the first paint has the threads and the browser doesn't fetch them again.
- `src/better-apps.server.ts` creates the app and its Start bindings. `src/routes/api/apps/$.ts` serves the actions.
- **Sign-in** is Better Auth's email and password sign-in, in `src/auth.server.ts`, served at `/api/auth`. On its first
  start the app signs up three demo people, Ada, Grace and Alan, with the password `better-apps-example`, and the
  sign-in page has a button for each. Ada owns the workspace, so she moderates comments: she can delete any comment or
  thread, move any pin and remove reactions (`src/people.server.ts`). On the first start the app also writes a few
  conversations on the sample invoices as the demo people, with mentions and reactions, from
  `src/db/seed-comments.server.ts`. Comments are for signed-in people. Signing in or out reloads the page, so nothing
  loaded for one person stays in the browser.
- `src/start.ts` only lets same-origin requests call server functions.

## Interface

The UI comes from Buildkit's shadcn kit,
[`@buildkitgg/shadcn-baseui-nova`](https://www.npmjs.com/package/@buildkitgg/shadcn-baseui-nova), installed under the
`@buildkitgg/shadcn-baseui-kit` alias, so the app imports components from one name whichever style it picks.
`src/styles.css` imports the kit's compiled styles and lays out the app's own pages with the kit's tokens, and adds
colors for invoice statuses and comment pins.

- `src/app-shell.tsx` is the frame: the kit's sidebar, a header with where the page sits, and the account menu with the
  appearance and sign-out.
- `src/ui.ts` creates the light and dark theme with
  [`@buildkitgg/shadcn-theme`](https://www.npmjs.com/package/@buildkitgg/shadcn-theme), saved in the browser and applied
  before the first paint by a script in the page's head, the confirmations with
  [`@buildkitgg/shadcn-modals-manager`](https://www.npmjs.com/package/@buildkitgg/shadcn-modals-manager), and the alerts
  that stay until dismissed with
  [`@buildkitgg/shadcn-alerts-manager`](https://www.npmjs.com/package/@buildkitgg/shadcn-alerts-manager). Short
  confirmations, such as a resolved thread, use the kit's toasts.
- `src/data-table.tsx` has table parts in the style of [tablecn](https://tablecn.com), built from the kit's components:
  sortable column headers, a filter by several values with their counts, and pages. Its `useDataTable` creates the table
  the way `useReactTable` does. TanStack Table changes one table object in place, so the hook and the parts that read
  the table opt out of the React Compiler with `"use no memo"`.
- Icons are [Lucide](https://lucide.dev), which the kit uses too.

## Database

The app stores its data in `.data/example.db`, which it creates on start. Set `DATABASE_FILE` to use another file, or
`:memory:` for a database that lasts until the server stops. Delete the file to start over, which also brings back the
sample conversations. Files' bytes go in `.data/files`, or the folder `FILES_FOLDER` names; delete it along with the
database. Set `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` anywhere but your own machine.

Tables come from migrations in `drizzle/`, which the app applies on start with Drizzle's migrator. The migrations cover
the app's tables, Better Auth's in `src/db/auth-schema.ts`, and the features' tables, which `better-apps generate`
writes to `src/db/better-apps-schema.ts`. After adding a feature or changing a table, run:

```sh
pnpm --filter @better-apps/example db:generate
```

It regenerates the features' schema from `better-apps.config.ts`, then writes a new migration with `drizzle-kit`. Commit
both.

## Times and dates

Pages are rendered on the server and again in the browser, so dates and times use a fixed locale and time zone. Times
are shown in UTC.
