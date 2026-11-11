# Better Booking

A booking app built with [TanStack Start](https://tanstack.com/start) on
[Better Apps](../../packages/core/better-apps/README.md). Hosts set their availability, make booking pages and share
them at the app's address, on their organization's own domain or as short links. Guests pick an open time, book it, add
documents, and reschedule or cancel later. It runs
[`@better-apps/short-links`](../../packages/features/short-links/README.md),
[`@better-apps/domains`](../../packages/features/domains/README.md) and
[`@better-apps/attachments`](../../packages/features/attachments/README.md) together in one app.

Short links (with clicks over time and which link brought each booking), domains, documents, sign-in, guest accounts and
organizations are real. Scheduling runs on the app's own tables until a scheduling module replaces them: availability,
booking rules, rescheduling and cancelling work, while calendar sync and email are simulated and labelled so.

The [spec](docs/spec.md) describes every screen, rule and string.

## Run it

Build the packages it uses once, then start it:

```sh
pnpm exec vp run --cache --filter "@better-apps/booking^..." build
pnpm --filter @better-apps/booking dev
```

Then open <http://booking.localhost:4192> and sign in as one of the demo people, all with the password
`better-apps-example`:

| Person       | Email               | Buildkit | Globex |
| ------------ | ------------------- | -------- | ------ |
| Ada Lovelace | `ada@example.com`   | Owner    |        |
| Grace Hopper | `grace@example.com` | Member   |        |
| Alan Turing  | `alan@example.com`  |          | Owner  |

`build` and `preview` run the production build at <http://booking.localhost:4193>. Browsers send every `*.localhost`
address to your own machine, so the app, organizations' subdomains such as `globex.booking.localhost`, and the local
aliases of custom domains such as `go.buildkit.gg.booking.localhost` all reach the server without any setup.

## What to try

1. As Ada in Buildkit, open **Booking pages**. Buildkit's pages are at its own domain, `go.buildkit.gg`. Copy Product
   demo's address.
2. Open it in a private window, pick a time (shown in your own time zone), add a PDF and book. The confirmation shows
   the booking, your document, **Add to calendar**, **Reschedule** and **Cancel booking**. Reschedule it, then press
   **Create account** to keep your bookings, and find them under **Your bookings**.
3. Back as Ada, open **Bookings**, then the new booking, to see the guest's document, its history and the simulated
   messages. Priya's booking shows a document from the guest, Tom's was rescheduled, and Hannah's was cancelled with a
   reason.
4. Open **Availability** and **Calendars**. Ada's standup and lunch, from her simulated Google Calendar, block times on
   all her pages. Turn off **Check for conflicts** and Intro call gains those times.
5. Open **Links**. Buildkit has one link per place it shares Intro call, so the clicks over time and bookings show which
   works best. Open the `partner-` link, which goes to Partner onboarding, a private page, in a private window. The link
   lets you in, and the page asks for a signed partner agreement before you can book.
6. Sign in as Alan, who runs Globex, and copy Sales call's address and short link: both are on the app's address. Open
   **Domains** and add the subdomain `globex`. It's ready at once and becomes primary, so the address and short link
   move to `globex.booking.localhost`. Then add a custom domain and press **Add to local DNS** to play its owner, and
   **Check now** to finish.

## Local development and production

The app runs on [Void](https://void.cloud), so it deploys as one Cloudflare Worker with D1 for data and R2 for
documents. In development, Void's Vite plugin runs it on Cloudflare's local Workers runtime with a local D1 under
`.void` and `.wrangler`, while documents go to the real R2 bucket `better-booking-dev` through a remote binding. Custom
domains run on `localHostnames()`. Delete `.void` and `.wrangler` to start over with the demo data.

Void needs Node 24.22 or newer. Sign in once with `void cloudflare login` so the remote binding can reach the bucket.

`void deploy --platform cloudflare` deploys it to your own Cloudflare account, and `BOOKING_PROVIDER=cloudflare` serves
custom domains through [Cloudflare for SaaS](../../packages/adapters/hostnames-cloudflare/README.md). The spec's
[production section](docs/spec.md#production) lists the settings.

## Designs

- `booking.par`: the Parity design, built on the app's own components and `src/styles.css`.
- `designs/Booking.pen`: the Pencil design, linked to `designs/Shadcn Nova.lib.pen`.

The brand is teal on Nova's neutral base. Its tokens are in `src/styles.css`.
