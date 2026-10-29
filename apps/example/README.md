# Better Apps example

A [TanStack Start](https://tanstack.com/start) app that runs
[Better Apps](../../packages/better-apps/better-apps/README.md) features on SQLite, wired with
[`@better-apps/tanstack-start`](../../packages/better-apps/tanstack-start/README.md). People sign in with
[Better Auth](https://www.better-auth.com), and
[`@better-apps/better-auth`](../../packages/better-apps/better-auth/README.md) tells features who they are.

Build the packages it uses once, then start it:

```sh
pnpm turbo run build --filter=@better-apps/example^...
pnpm --filter @better-apps/example dev
```

Then open <http://127.0.0.1:4190>. `build` and `preview` run the production build at <http://127.0.0.1:4191>.

## What's in it

- **Notes**, on the home page, is a tiny feature in `src/features.ts`. Its loader calls a server function that calls
  `api.notes.list()` as the request's user, and the form posts to `/api/apps/notes/add` from the browser.
- **Invoices** is the app's own table, in `src/db/schema.ts`, with a list page and a detail page. The app adds five
  sample invoices on start.
- **Comments** from [`@better-apps/comments`](../../packages/better-apps/comments/README.md) attach to invoices. The
  detail page lists an invoice's threads beside it, with a form to start one on the whole invoice or pinned to one of
  its details, and numbered pins on the details that have open threads. Threads can be replied to, resolved, reopened
  and deleted. The list shows each invoice's open threads. The UI is in `src/invoice-comments.tsx`; the hooks and the
  store come from `@better-apps/comments/react`.
- Pages render on the server with their comments. Loaders call server functions in `src/comments.functions.ts`, which
  load a comments store through the bound `client()` and return its snapshot, and the router in `src/router.tsx` carries
  the store to the browser, so the first paint has the threads and the browser doesn't fetch them again.
- `src/better-apps.server.ts` creates the app and its Start bindings. `src/routes/api/apps/$.ts` serves the actions.
- **Sign-in** is Better Auth's email and password sign-in, in `src/auth.server.ts`, served at `/api/auth`. On its first
  start the app signs up three demo people, Ada, Grace and Alan, with the password `better-apps-example`, and the
  sign-in page has a button for each. Notes and comments are for signed-in people; the header shows who's signed in.
  Signing in or out reloads the page, so nothing loaded for one person stays in the browser.
- `src/start.ts` only lets same-origin requests call server functions.

## Database

The app stores its data in `.data/example.db`, which it creates on start. Set `DATABASE_FILE` to use another file, or
`:memory:` for a database that lasts until the server stops. Delete the file to start over. Set `BETTER_AUTH_SECRET` and
`BETTER_AUTH_URL` anywhere but your own machine.

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
