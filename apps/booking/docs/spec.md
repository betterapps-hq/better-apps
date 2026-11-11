# Better Booking spec

Better Booking lets people take appointments through booking pages. A host sets when they're available, shares a booking
page at its own address, on their organization's domain or as a short link, and guests pick an open time, book it, add
documents, and reschedule or cancel later. It is the second example app in this repository. It exercises
[`@better-apps/short-links`](../../../packages/features/short-links/README.md),
[`@better-apps/domains`](../../../packages/features/domains/README.md) and
[`@better-apps/attachments`](../../../packages/features/attachments/README.md) together, and it is where a future
scheduling module will run first.

**Scheduling is designed in full and mocked underneath.** Every scheduling screen in this spec is in scope:
availability, booking rules, calendars, reminders, rescheduling and cancelling. They run on the app's own tables and a
simple open-time calculation, so the whole product works end to end. Two things need outside systems, so the app
simulates them and labels them in the interface: syncing with real calendar providers, and sending email. When the
scheduling module exists, it replaces the mock underneath, and the screens stay.

Short links (including clicks over time and which link brought each booking), domains, documents, sign-in, guest
accounts and organizations are real.

## Contents

- [Concepts](#concepts)
- [People, organizations and roles](#people-organizations-and-roles)
- [Demo data](#demo-data)
- [Addresses and hosts](#addresses-and-hosts)
- [Time zones](#time-zones)
- [Availability](#availability)
- [Calendars](#calendars)
- [Booking pages](#booking-pages)
- [Open times](#open-times)
- [Booking](#booking)
- [Rescheduling and cancelling](#rescheduling-and-cancelling)
- [Reminders and messages](#reminders-and-messages)
- [Guest accounts](#guest-accounts)
- [Documents](#documents)
- [Short links](#short-links)
- [Clicks and sources](#clicks-and-sources)
- [Handles](#handles)
- [Domains](#domains)
- [Screens](#screens)
- [Data](#data)
- [Wiring the features](#wiring-the-features)
- [Local development](#local-development)
- [Production](#production)
- [Interface](#interface)
- [Copy](#copy)
- [Accessibility and layout](#accessibility-and-layout)
- [Out of scope](#out-of-scope)

## Concepts

| Term               | Meaning                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace**      | Where someone is working: **Personal** (their own) or one organization they belong to. The account menu switches it.                    |
| **Owner**          | Whom a booking page, booking or short link belongs to: a person (Personal) or an organization.                                          |
| **Handle**         | An owner's short name in addresses: `buildkit` for Buildkit, `ada` for Ada. Owners can change it.                                       |
| **Host**           | The person a booking is with. Each booking page has one host. In Personal, the host is the owner.                                       |
| **Schedule**       | A person's weekly hours in a time zone, with date overrides. Each booking page uses one of its host's schedules.                        |
| **Calendar**       | A connected calendar, such as Google Calendar, whose busy times block open times. Simulated in this app.                                |
| **Booking page**   | What a guest books: a title, a duration, a location, a description, a host, a schedule, booking rules and reminders, public or private. |
| **Booking**        | A time a guest booked on a booking page, with their name and email. Upcoming, past or cancelled, and rescheduled any number of times.   |
| **Guest**          | Whoever books. Signed-out guests get an anonymous session when they start booking, and can turn it into an account.                     |
| **Confirmation**   | The guest's own page for their booking, where they can reschedule, cancel and manage their documents.                                   |
| **Document**       | A file on a booking page (from its host, for guests to read) or on a booking (from the guest or the team).                              |
| **Short link**     | `/s/{code}` on any host that opens it, to a booking page or a web address. Typically one per place a page is shared.                    |
| **Source**         | The short link a booking came through, or **Direct**.                                                                                   |
| **Domain**         | An organization's subdomain of the app's zone, such as `globex.booking.localhost`, or a domain it owns, such as `go.buildkit.gg`.       |
| **Primary domain** | The organization's ready domain that its booking pages and short links are shared on.                                                   |

## People, organizations and roles

Sign-in is Better Auth's email and password sign-in with its organization plugin. The active organization is the
workspace. No active organization means Personal. Better Auth's member roles are `owner`, `admin` and `member`. A new
session starts in the workspace the person last used.

| Who                         | Booking pages                                                                                     | Bookings                                                                   | Documents                                        | Short links                                                                                                         | Domains                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Guest                       | Book a public page, or a private one through its private link or a short link that lets guests in | Open, reschedule and cancel their own, within the page's limit for changes | See [Documents](#who-can-do-what-with-documents) | Open any link                                                                                                       | None                                       |
| Personal                    | Make, edit and delete their own                                                                   | See, reschedule and cancel their own                                       | See [Documents](#who-can-do-what-with-documents) | Make and manage their own                                                                                           | None. Domains belong to organizations      |
| Organization member         | Make pages they host, edit those they host                                                        | See every booking, reschedule and cancel those they host                   | See [Documents](#who-can-do-what-with-documents) | Make and manage all of the organization's links; links that let guests into a private page only for pages they host | See domains and their records              |
| Organization owner or admin | Make pages for any member, edit any, change a page's host                                         | See, reschedule and cancel every booking                                   | See [Documents](#who-can-do-what-with-documents) | Make and manage all of the organization's links, including ones that let guests into private pages                  | Add, check, remove, choose the primary one |

- **Everyone signed in** manages their own schedules, calendars, profile and handle, and sees **Your bookings**: the
  bookings they made as a guest. Owners and admins also edit the organization's name and handle, and see members'
  schedules read-only, so they can pick one when making a page for a member.
- **Anonymous sessions count as signed out** everywhere in the app. `/`, `/pages`, `/bookings`, `/links`,
  `/availability`, `/me/*` and `/settings/*` send them to `/sign-in`, and `/sign-in` signs them out first. Guests can
  only book, open their own confirmation, reschedule and cancel it, manage their own booking documents, download what
  they can see, and create an account.
- **Signed-in people book as themselves.** The booking form fills in their name and email, which they can change. Hosts
  can book their own pages, which is handy for trying the flow.
- **A member who leaves** keeps nothing of the organization. Pages they hosted stay and show **Needs a host**: guests
  see them as paused, and owners and admins can still reschedule or cancel their bookings, or pick a new host and
  schedule. Every rule that names a host also requires that the host is still a member.
- Pages, bookings and links made in Personal stay Personal when the person joins an organization.
- Server checks enforce every rule. The interface hides what someone can't do and never relies on hiding alone.

## Demo data

The demo data is on in development and off in production unless `BOOKING_DEMO=1` (see [Production](#production)). The
first request on an empty database signs up three people, all with the password `better-apps-example`, and two
organizations. A marker row makes seeding run once, even when two first requests arrive together.

| Person       | Email               | Handle  | Buildkit | Globex | First workspace |
| ------------ | ------------------- | ------- | -------- | ------ | --------------- |
| Ada Lovelace | `ada@example.com`   | `ada`   | Owner    |        | Buildkit        |
| Grace Hopper | `grace@example.com` | `grace` | Member   |        | Buildkit        |
| Alan Turing  | `alan@example.com`  | `alan`  |          | Owner  | Globex          |

Organizations: **Buildkit** (`buildkit`) and **Globex** (`globex`).

`BOOKING_COMPANY_NAME` names the organization that owns the seeded domain, `Buildkit` by default to match
`go.buildkit.gg`. Its handle is made from the name, and the seeded copy that names it follows. This spec says Buildkit
throughout.

### Domains

Buildkit's custom domain `go.buildkit.gg` is ready and primary. Globex has none, so its pages and links use the app's
address until a domain is added; adding the subdomain `globex` is the walkthrough's domain step. No subdomain is seeded.

### Schedules and calendars

| Person | Schedule                    | Zone               | Hours                     | Overrides                 |
| ------ | --------------------------- | ------------------ | ------------------------- | ------------------------- |
| Ada    | **Working hours** (default) | `Europe/London`    | Monday to Friday, 9 to 5  | Day +3 off ("Conference") |
| Ada    | **Office hours**            | `Europe/London`    | Monday to Friday, 4 to 5  |                           |
| Grace  | **Working hours** (default) | `Europe/London`    | Monday to Friday, 10 to 4 |                           |
| Alan   | **Working hours** (default) | `America/New_York` | Monday to Friday, 9 to 5  | Day +5, 9 to 12 only      |

- Ada has a simulated **Google Calendar** connection, **Work**, with "Team standup" every weekday 9:30 to 9:45 and
  "Lunch" every weekday 12:30 to 1:30, London time. New bookings are added to it.
- Alan has a simulated **Microsoft Outlook** connection with "Board meeting" on day +2, 2 to 3 pm New York time.
- Grace has no calendar, so her Calendars screen shows its empty state.

### Booking pages

| Owner          | Page                   | Slug                 | Length | Visibility | Host  | Schedule      | Rules                                            | Location                                              | Guest documents                                     |
| -------------- | ---------------------- | -------------------- | ------ | ---------- | ----- | ------------- | ------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------- |
| Buildkit       | **Intro call**         | `intro-call`         | 30 min | Public     | Ada   | Working hours | 10 min buffer after; 4 hours' notice             | Video call, `https://meet.example.com/buildkit-intro` | Off. Host document `Intro call agenda.pdf`          |
| Buildkit       | **Product demo**       | `demo`               | 60 min | Public     | Grace | Working hours | 15 min buffers before and after; at most 3 a day | Video call, `https://meet.example.com/buildkit-demo`  | Optional: "Share anything you'd like us to look at" |
| Buildkit       | **Partner onboarding** | `partner-onboarding` | 45 min | Private    | Ada   | Working hours | Guests can't change bookings online              | In person, "Buildkit, 1 King Street, London"          | Required: "Add your signed partner agreement"       |
| Globex         | **Sales call**         | `sales-call`         | 30 min | Public     | Alan  | Working hours | Up to 14 days ahead                              | Video call, `https://meet.example.com/globex`         | Off                                                 |
| Ada (Personal) | **Office hours**       | `office-hours`       | 15 min | Public     | Ada   | Office hours  | Guests can change bookings up to 1 hour before   | Video call, `https://meet.example.com/ada`            | Off                                                 |

Every other rule is the default: no buffers, 1 hour's notice, up to 28 days ahead, a start every duration, no daily
limit, guests can change bookings up to 24 hours before, and reminders to the guest 24 hours before and to the host 1
hour before.

Three pages have a description. Intro call: "A short call to see whether Buildkit fits your team. Bring your questions."
Product demo: "A walk through the product, with time for your questions." Partner onboarding: "Meet us in London to sign
the partner agreement and plan your first quarter together." Sales call and Office hours have none.

### Bookings

Days count working days from the seed date: +1 is the next working day, -1 the previous one. Times are in the page's
schedule's zone. Every time fits its schedule, rules, calendars and the overlap rule. Delete `.void` and `.wrangler` to
reseed when the dates go stale.

| Page               | Guest                                         | Day | Time  | Status    | Source             | Note                      | History and documents                                                                                                    |
| ------------------ | --------------------------------------------- | --- | ----- | --------- | ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Intro call         | Mira Chen, `mira@example.net`                 | +1  | 10:00 | Upcoming  | `intro-linkedin`   | "Exploring a team plan"   |                                                                                                                          |
| Intro call         | Tom Okafor, `tom@example.org`                 | +2  | 14:30 | Upcoming  | `intro-newsletter` |                           | Rescheduled by the guest from day +1 at 14:00                                                                            |
| Intro call         | Sara Lind, `sara@example.net`                 | -2  | 11:00 | Past      | `intro-linkedin`   | "Follow-up on pricing"    | From the team: `Proposal.pdf` (Ada)                                                                                      |
| Product demo       | Priya Natarajan, `priya@example.net`          | +1  | 11:00 | Upcoming  | Direct             | "Interested in the API"   | From the guest: `Requirements.pdf`. From the team: `Demo agenda.pdf` (Grace)                                             |
| Product demo       | Leo Park, `leo@example.org`                   | +3  | 15:00 | Upcoming  | `demo-webinar`     |                           |                                                                                                                          |
| Product demo       | Hannah Weiss, `hannah@example.net`            | +2  | 10:00 | Cancelled | `demo-webinar`     |                           | Cancelled by the guest on day -1: "Found a time that suits us better next month."                                        |
| Partner onboarding | Jonas Berg, `jonas@example.com`               | +4  | 13:30 | Upcoming  | `partner-` link    | "Northwind's signed copy" | From the guest: `Partner agreement.pdf`                                                                                  |
| Office hours       | Ravi Shah, `ravi@example.net`                 | +1  | 16:00 | Upcoming  | `office-hours`     |                           |                                                                                                                          |
| Office hours       | Emma Ruiz, `emma@example.org`                 | -1  | 16:15 | Past      | Direct             | "Question about the docs" |                                                                                                                          |
| Sales call         | Kofi Mensah, `kofi@example.org`               | +1  | 10:30 | Upcoming  | `sales`            |                           |                                                                                                                          |
| Sales call         | Julia Novak, `julia@example.net`              | +2  | 13:00 | Upcoming  | Direct             | "Pricing for 40 seats"    | Cancelled by Alan on day -1 ("A board meeting moved onto this time. Please pick another.") and booked again by the guest |
| Sales call         | Omar Haddad, `omar@example.com`               | -1  | 15:00 | Past      | `sales`            |                           |                                                                                                                          |
| Sales call         | Grace Hopper, `grace@example.com` (signed in) | +3  | 11:00 | Upcoming  | Direct             | "Comparing tools for us"  | Booked by Grace's own account, so it shows in her **Your bookings**                                                      |

Each guest booking without an account is owned by its own seeded anonymous user. Julia's row is two bookings: the one
Alan cancelled on day +1 at 10:00, and the new one. Seeding uploads small sample PDFs through attachments' actions,
acting as Ada, as Grace or as the booking's anonymous guest, since server code can't upload as nobody. Priya's booking
is the one with documents from both the guest and the team.

### Short links

One link per place a page is shared, so the clicks and bookings say which place works.

| Owner          | Code                                                  | Goes to                       | Clicks | Notes                                                                      |
| -------------- | ----------------------------------------------------- | ----------------------------- | ------ | -------------------------------------------------------------------------- |
| Buildkit       | `intro-linkedin`                                      | Intro call                    | 1,284  | Clicks peak on day -20, when the post went out                             |
| Buildkit       | `intro-newsletter`                                    | Intro call                    | 312    | Clicks come in weekly, on newsletter days                                  |
| Buildkit       | `demo-webinar`                                        | Product demo                  | 87     | All within three days of day -10, the webinar                              |
| Buildkit       | `partner-` and 12 random lowercase letters and digits | Partner onboarding            | 4      | Custom code `partner`. Lets guests in. Expires 30 days after the seed date |
| Buildkit       | `pricing`                                             | `https://buildkit.gg/pricing` | 156    | The one web-address link                                                   |
| Globex         | `sales`                                               | Sales call                    | 41     | Answers not found on `go.buildkit.gg`, Buildkit's domain                   |
| Ada (Personal) | `office-hours`                                        | Office hours                  | 12     |                                                                            |

Seeding writes each click as its own event over the past 90 days, following the notes, so the totals and the charts
agree. Each link's last opened time is its latest click.

## Addresses and hosts

The app's own address is `baseUrl`: `http://booking.localhost:4192` in development. Any other host is an organization's
domain, or nothing.

| Host                                | Path                                                                          | What it serves                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| App (`booking.localhost`)           | `/`, `/pages`, `/bookings`, `/links`, `/availability`, `/me/*`, `/settings/*` | The signed-in app                                                                                                    |
| App                                 | `/sign-in`, `/sign-up`                                                        | Sign in and create an account                                                                                        |
| App                                 | `/book/{handle}`                                                              | The owner's public booking pages                                                                                     |
| App                                 | `/book/{handle}/{slug}`                                                       | A booking page                                                                                                       |
| App                                 | `/book/{handle}/{slug}/{key}`                                                 | A private booking page, through its private link                                                                     |
| App                                 | `/book/{handle}/{slug}/booked/{bookingId}`                                    | A confirmation                                                                                                       |
| App                                 | `/book/{handle}/{slug}/booked/{bookingId}/reschedule`                         | Rescheduling from the confirmation                                                                                   |
| App                                 | `/book/{handle}/{slug}/booked/{bookingId}/event.ics`                          | The confirmation's calendar file                                                                                     |
| Organization's ready domain         | `/`                                                                           | The organization's public booking pages                                                                              |
| Organization's ready domain         | `/{slug}`                                                                     | One of its booking pages                                                                                             |
| Organization's ready domain         | `/{slug}/{key}`                                                               | One of its private booking pages, through its private link                                                           |
| Organization's ready domain         | `/{slug}/booked/{bookingId}`                                                  | A confirmation                                                                                                       |
| Organization's ready domain         | `/{slug}/booked/{bookingId}/reschedule`                                       | Rescheduling from the confirmation                                                                                   |
| Organization's ready domain         | `/{slug}/booked/{bookingId}/event.ics`                                        | The confirmation's calendar file                                                                                     |
| App and every ready domain          | `/s/{code}`                                                                   | A short link                                                                                                         |
| App and every ready domain          | `/api/apps/*`                                                                 | Actions, and attachments' upload and download routes                                                                 |
| App                                 | `/api/auth/*`                                                                 | Every sign-in route                                                                                                  |
| Organization's ready domain         | `/api/auth/*`                                                                 | Only anonymous sign-in, sign-up from an anonymous session, get session and sign out; anything else answers not found |
| Organization's ready domain         | anything else                                                                 | A redirect to the same path on the app's address                                                                     |
| A pending domain or an unknown host | anything                                                                      | The not-found page                                                                                                   |

- A booking page's **address** is on its organization's primary domain when that domain is ready, and on the app's
  address otherwise: `http://go.buildkit.gg.booking.localhost:4192/intro-call` (in development) or
  `http://booking.localhost:4192/book/globex/sales-call`. Personal pages always use the app's address.
- **The interface shows addresses without their scheme**, and a custom domain by its own hostname, in development too:
  `go.buildkit.gg/intro-call`, `go.buildkit.gg/s/intro-linkedin`, `booking.localhost:4192/book/ada`. **Copy** and
  **Open** use the full URL that works where the app is running, which in development is the custom domain's
  `.booking.localhost` address (see [Local development](#local-development)).
- An owner's **public list** is `/book/{handle}` on the app, or the primary domain's root once one is ready.
- Every ready domain of an organization serves its pages, not only the primary one. The primary one is what the app
  shows and copies. The app's `/book/...` addresses keep working for organization pages too.
- **Confirmations** resolve by booking id and the viewer's session. The slug and handle in the address are only for
  reading, so changing the slug or handle, or resetting a private key, doesn't break them, and they never need the
  private key.
- Slugs that would hide app paths can't be used: `s`, `book`, `api`, `pages`, `bookings`, `links`, `availability`, `me`,
  `settings`, `sign-in`, `sign-up`, `assets`, and anything starting with `_` or `.`.
- Booking pages, confirmations and short links never reveal whether something exists. A missing page, a private page
  without access, another organization's page, someone else's confirmation and a turned-off link all answer the same
  not-found page.

## Time zones

- Each schedule has a time zone, and a booking page's hours are in its schedule's zone, called the page's zone below.
- **Guests see times in their own zone.** The server renders the page's zone first. After the page loads, the browser
  switches to its own zone, adds `?tz=` to the address and saves it in a `tz` cookie. A **Times shown in {zone}**
  control lets the guest pick another zone, including the page's.
- **Times shown in {zone}** is a searchable select of IANA zones, each shown as its city and current offset, such as
  "London (UTC+00:00)", with the guest's own zone and the page's zone at the top. It sits above the week, and spans the
  full width on phones.
- Days and the week grid are worked out in the zone being shown, so an open time can fall on a different day for the
  guest than for the host.
- The confirmation shows the guest's zone first, and the page's zone on a second line when they differ.
- **Signed-in screens show times in the viewer's zone**, from the same `tz` cookie, each labelled with its zone. Until
  the cookie is set, the first render is in UTC and labelled so. The booking screen adds the page's zone on a second
  line when it differs. The availability editor shows each schedule in its own zone.
- **A list or grid of times names its zone once**, above it, as "Times shown in {zone}": the Bookings list and week
  view, Your bookings, the dashboard's Upcoming bookings, a calendar's sample events and the host's reschedule picker. A
  single time, as on the booking screen and the confirmation, carries its own zone.
- **A zone always shows as its city and current offset**, such as "London (UTC+00:00)", including a schedule's time zone
  field, the Availability list and Profile. The IANA name, such as `Europe/London`, is what's stored and is never shown.
- Two things stay in UTC, labelled so, because the rules behind them are in UTC: domains' last and next check times, and
  short links' expiry ("Stops working at 23:59 UTC").
- A person's first schedule is made when they sign up, in their browser's zone.

## Availability

Availability lives at `/availability`. Each person has one or more **schedules**, and each booking page uses one of its
host's schedules. One schedule is the default, which new pages use.

| Part           | Rules                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name           | Required, 1 to 50 characters, unique for the person.                                                                                                                                                                      |
| Time zone      | An IANA zone, shown as its city and offset. Changing it keeps the hours as written, so 9 to 5 stays 9 to 5 in the new zone.                                                                                               |
| Weekly hours   | Each weekday is on or off, with one to four time ranges in 15-minute steps. Ranges on a day can't overlap, and each ends after it starts.                                                                                 |
| Date overrides | A date with **Unavailable**, or its own ranges instead of the weekly hours, and an optional note of up to 50 characters, such as "Conference". Up to 60, each for one date in the next year. Past ones drop off the list. |

- **New schedule** starts as Monday to Friday, 9 to 5, in the person's zone. **Copy to all weekdays** copies a day's
  ranges to the other weekdays that are on.
- **Make default** moves the default, and is turned off on the schedule that is already the default.
- **Delete schedule** asks first. Two things refuse it, each with its own dialog instead of the question. A schedule
  used by pages can't be deleted until its pages use another: "{name} is used by {n} booking pages. Choose another
  schedule for them first.", listing them. Otherwise, the default can't be deleted: "{name} is your default schedule.
  Make another schedule the default first."
- The editor shows "Unsaved changes" beside **Save** while there are any.
- Each schedule shows "Used by {n} booking pages" and links to them.
- Changing a schedule changes open times at once. Existing bookings stay, even outside the new hours.
- Owners and admins see a member's schedules read-only from the page editor, when choosing one for a page.

## Calendars

Calendars live at `/settings/calendars`, per person. **They're simulated**: connecting adds a demo connection with
sample busy times, and nothing reaches Google or Microsoft. The screen says so: "Calendars are simulated in this demo.
Connecting adds sample events."

- **Connect** offers **Google Calendar** and **Microsoft Outlook**. Connecting adds a connection with one calendar,
  **Work**, and sample events over the next four weeks, each marked **Demo**.
- Each connection lists its calendars with **Check for conflicts** (on by default). Busy times in calendars that are on
  block open times on every page the person hosts.
- **Add new bookings to** picks one calendar, or **Don't add**. Bookings then show "Added to {calendar} (simulated)".
- **Disconnect** asks first, then removes the connection and its events. Open times change at once.
- Empty: "No calendars connected" with "Connect a calendar so busy times block your booking pages."

## Booking pages

### Fields

The page editor groups its fields into **Basics**, **When**, **Reminders**, **Guest changes** and **Documents**.

| Group         | Field             | Rules                                                                                                                               |
| ------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Basics        | Title             | Required, 1 to 80 characters.                                                                                                       |
| Basics        | Slug              | Required, 3 to 60 lowercase letters, digits and hyphens, unique per owner, not reserved. Made from the title until edited.          |
| Basics        | Duration          | 15, 30, 45, 60 or 90 minutes.                                                                                                       |
| Basics        | Location          | **Video call**, **Phone** or **In person**, with optional details up to 200 characters, such as a meeting link or address.          |
| Basics        | Description       | Optional, up to 500 characters, plain text with line breaks.                                                                        |
| Basics        | Host              | A member of the organization. Only owners and admins can choose or change it. In Personal, the owner, not shown.                    |
| Basics        | Visibility        | **Public** or **Private**. Defaults to Public.                                                                                      |
| When          | Schedule          | One of the host's schedules. Defaults to the host's default. Shows its zone and hours, with **Edit schedule** for the host.         |
| When          | Buffer before     | None, 5, 10, 15, 30 or 60 minutes kept free before each booking.                                                                    |
| When          | Buffer after      | None, 5, 10, 15, 30 or 60 minutes kept free after each booking.                                                                     |
| When          | Minimum notice    | 30 minutes, 1, 2, 4, 12, 24 or 48 hours. Defaults to 1 hour.                                                                        |
| When          | Booking window    | 7, 14, 28, 60 or 90 days ahead. Defaults to 28.                                                                                     |
| When          | Start times       | Every 15, 30 or 60 minutes, or every duration. Defaults to every duration.                                                          |
| When          | Daily limit       | Optional, 1 to 20 bookings on this page per day in the page's zone.                                                                 |
| Reminders     | Reminders         | Up to three, each to the **Guest** or the **Host**, 15 minutes, 1, 4, 24 or 48 hours before. Defaults: guest 24 hours, host 1 hour. |
| Guest changes | Guests can change | **Up to {n} hours before** (1, 4, 12, 24 or 48; defaults to 24) or **Not online**. Covers both rescheduling and cancelling.         |
| Documents     | Guest documents   | **Off**, **Optional** or **Required**. Defaults to Off. See [Documents](#documents).                                                |
| Documents     | Document prompt   | Shown above the guest's file picker, up to 120 characters. Defaults to "Add documents for this meeting".                            |
| Documents     | Documents         | The host's files for guests, such as an agenda. Up to 5. See [Documents](#documents).                                               |

- **Status isn't a field.** A page is **Open** or **Paused**, and only the **Pause** and **Open** actions change it, at
  once and apart from **Save**. A paused page shows "Not taking bookings right now" to guests and lists no times. A page
  whose host has left shows **Needs a host** in place of either.
- The location's kind shows on the public page. Its details show only on the confirmation and the booking screen, since
  they often hold a meeting link. The field's hint says so: "Shown on the confirmation and the booking screen, not on
  the public page."
- **When** shows a preview: "Next open times:" and the next three as a date and time each, such as "Tue, Nov 10, 2:00
  PM", in the viewer's zone and labelled with it, updated as the fields change. A page with no host shows no preview.
- Changing the host, schedule, duration, buffers or reminders doesn't change existing bookings, which keep the values
  they were booked with.

### Visibility

- A **public** page opens at its address and is listed on its owner's public list.
- A **private** page isn't listed, and its address answers not found to guests. It opens through its **private link**,
  the address followed by `/{key}`, where `key` is 12 random lowercase letters and digits made when the page becomes
  private, and through any short link made while it's private, which lets guests in (short links' `grantsView`).
- **Reset private link** makes a new key, so old private links stop working. Short links to the page keep working.
  Turning a short link off, or deleting it, stops it working.
- **Making a public page private** asks first when it has short links: "{n} short links to this page won't let guests
  in. Make new ones from the Short links tab." Links made while the page was public only open it for members afterwards.
- Making a private page public removes its key. Making it private again makes a new one.
- Changing the slug changes the page's address and private link. Old addresses answer not found. Short links follow the
  page, since they point at the page, not at its address.

### Actions

| Action             | Who                                  | Result                                                                                                                                     |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Create             | Anyone signed in, in their workspace | A new open page with the defaults. Members host their own; owners and admins pick any member.                                              |
| Edit               | Its host, or an owner or admin       | Saves every field at once.                                                                                                                 |
| Change host        | An owner or admin                    | Part of Edit. The schedule switches to the new host's default. Clears **Needs a host**.                                                    |
| Pause or open      | Its host, or an owner or admin       | Paused pages keep their bookings and links.                                                                                                |
| Copy address       | Anyone who can see it                | Copies the address, or the private link for a private page.                                                                                |
| Reset private link | Its host, or an owner or admin       | Asks first: "People with the old private link won't be able to open it."                                                                   |
| Delete             | Its host, or an owner or admin       | Asks first. Cancels its upcoming bookings, removes its short links and its own documents (each feature's `removeSubject`), and deletes it. |

- **Bookings outlive their page.** A booking keeps its own copy of the page's owner, organization, title, duration,
  location, zone, buffers and reminders, so a deleted page's bookings stay visible to the same people with their
  documents. They show "{title} (deleted)" with no link to the page. The Bookings page's page filter lists a deleted
  page while it still has bookings.
- **Deleting a page cancels its upcoming bookings as whoever deleted it**, with no reason: History reads "Cancelled by
  {name}", and each guest gets the simulated cancellation notice. What's left has started, passed or been cancelled, so
  none of a deleted page's bookings can be rescheduled.

## Open times

This is the mock that the scheduling module replaces.

- A page's open times come from its schedule: each range on each day, with a start every **Start times** step from the
  range's start, as long as the whole booking fits inside the range. A date override replaces that day's weekly hours.
- A time is open when all of these hold:
  - it starts at least the page's **minimum notice** from now, and within its **booking window**;
  - the booking plus the page's buffers doesn't overlap another confirmed booking of the same **host**, plus that
    booking's own buffers, on any page in any workspace;
  - it doesn't overlap a busy time in one of the host's calendars with **Check for conflicts** on;
  - the page's **daily limit**, if set, isn't reached that day.
- Buffers may reach outside the schedule's ranges. The booking itself can't.
- Buffers only keep bookings apart. A calendar's busy time blocks a time only when the booking itself overlaps it, so
  Intro call's 9:00 is open before Ada's 9:30 standup, 10-minute buffer and all.
- So Ada's Intro call, Partner onboarding and Office hours never double-book her, and her standup and lunch block those
  times on all three.

### The week picker

- The public page shows one week at a time, Monday to Sunday, with **Previous week** and **Next week**. It opens on the
  first week that has an open time, and selects that week's first day with one.
  - **Previous week** is turned off on the current week. **Next week** is turned off when the next week starts beyond
    the booking window.
  - Each day is a button with its weekday and date, such as "Tue, Nov 10". Days with nothing open add "No times" and are
    dimmed. Days with open times show no count. The selected day is tinted `brand-soft`.
  - A week with nothing open selects no day and shows "No open times this week" with **Next week**. On the last week of
    the window it shows "No open times in the next {n} days" instead, with no Next week.
  - When nothing is open in the whole window, the page opens on the current week with every day showing "No times", and
    the same "No open times in the next {n} days".
  - The times show a skeleton while a week loads.
- A day lists its open times as buttons, under the day's name. Choosing one opens the booking form.
- On phones the seven days are one row that scrolls sideways, since seven buttons wide enough for "No times" don't fit.
- Paused pages and pages that need a host show "Not taking bookings right now" and no week.

## Booking

### Booking form

| Field     | Rules                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name      | Required, 1 to 80 characters. Filled in for signed-in people.                                                                                             |
| Email     | Required, a valid email address. Filled in for signed-in people.                                                                                          |
| Note      | Optional, up to 500 characters.                                                                                                                           |
| Documents | Shown when the page asks for guest documents, with its prompt and "Required" or "Optional" by the label. Up to 6 files. Required pages need at least one. |

- A signed-out guest gets an **anonymous session** (Better Auth's anonymous plugin) the first time they pick a file or
  press **Book**, on the host they're booking on. Sessions in this app last 30 days, extended while used, so a guest can
  come back to a booking within the window. Clearing the browser's data ends it, and the confirmation then answers not
  found, unless the guest made an account.
- Files upload as soon as they're picked, as drafts, each with its name, size, progress, **Try again** if it fails, and
  a remove button. Their type, size and count are checked before they upload. **Book** waits for uploads still under
  way.
- **Book** saves a confirmed booking for the chosen time, with its source (see
  [Clicks and sources](#clicks-and-sources)), attaches the guest's uploaded files to it in the same action, and opens
  the confirmation. A page that requires documents refuses a booking without at least one uploaded file, on the server.
  If the time was taken meanwhile, the form says "That time was just booked. Pick another." and returns to the times,
  with that time gone and the uploaded files kept for the next try.
- Drafts that are never attached, such as when the guest leaves, expire after a day and the sweep removes them.

### Confirmation

- Open only to the session that booked it, and on the host it was booked on, or to the guest's account at
  `/me/bookings/{id}` once they have one. Anyone else, team members included, gets not found; the team sees bookings at
  `/bookings/{id}` in the app, since sessions don't cross hosts.
- Shows "You're booked", the page's title, the host, the date and time (see [Time zones](#time-zones)), the duration,
  the location with its details, the guest's name and email, the note, **Add to calendar**, the reminders the guest will
  get, and the documents in two groups: **Your documents** and **From {organization}** (or the host's name in Personal).
- **Your documents** shows the page's document prompt, the guest's files and the upload area. It shows only when the
  page takes guest documents or the guest already has files. **From {organization}** shows only when the team has added
  files. With neither, the confirmation has no Documents section.
- Shows **Reschedule** and **Cancel booking** while the page lets guests change the booking. Past the limit it says
  "Changes close {n} hours before the booking." On a page with **Not online**: "This booking can't be changed online."
- Says "This is a demo, so no email was sent." and "Bookmark this page to come back to it in this browser."
- For anonymous guests, a **Keep your bookings** card offers **Create account** (see [Guest accounts](#guest-accounts)).
- **Add to calendar** downloads `event.ics` with the title, host, start and end in UTC, the location and the
  confirmation's address. After a reschedule it holds the new time with the same event id, so calendars update it.
- Until the booking starts, the guest can add documents and remove their own. Required is checked when booking, so a
  guest can still swap documents until then.
- From the start until the end, the page says "This booking has started." After the end, "This booking has passed."
  Either way the documents are locked: uploads, Remove, Reschedule and Cancel are off.
- A cancelled booking says "This booking was cancelled on {date}.", with "by {host}" and the reason when the host
  cancelled it and gave one. A guest's own reason isn't repeated back to them: it shows to the team, in the booking's
  History. The documents are locked: uploads, Remove, Reschedule and Cancel are off.
- A rescheduled booking shows "Rescheduled from {old time}" under its time.
- "You're booked" is the page's heading while the booking is upcoming, at `/me/bookings/{id}` too. Once the booking has
  started, passed or been cancelled, that state's sentence is the heading instead.

## Rescheduling and cancelling

| Who                                               | Reschedule                                            | Cancel                                                |
| ------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| The guest, from the confirmation or Your bookings | Until the page's limit for changes, if it allows them | Until the page's limit for changes, if it allows them |
| The host, an owner or admin, or Personal's owner  | Any time before the booking starts                    | Any time before the booking starts                    |

- **Reschedule** opens the page's week picker, with the current time marked "Current time" and treated as open. Choosing
  a time marks it with a check and asks "Move to {new time}?", with **Cancel** and **Move booking**, and moves the
  booking, keeping its id, documents, source and confirmation address. The overlap check leaves out the booking itself.
  If the new time was taken meanwhile, the picker returns to the same day with that time gone, nothing chosen, and "That
  time was just booked. Pick another." as an alert at its top.
- The picker has **Back to booking** above it, and leaves out the page's description and documents.
- Hosts reschedule from the booking screen at `/bookings/{id}/reschedule`, with the same picker and the page's rules,
  except that minimum notice and the booking window don't apply to them. The screen says so: "As the host, you can pick
  any open time. Minimum notice and the booking window don't apply." It names its zone as a label, with no zone select.
- **Cancel booking** asks for an optional reason, up to 300 characters, then marks the booking cancelled. Its time opens
  again. Guests see "Cancel this booking?" and hosts see "Cancel {guest}'s booking?". Both are the same alert dialog:
  the question, its line, the booking's page, time and zone, a **Reason (optional)** field with "Up to 300 characters",
  then **Keep booking** and **Cancel booking**. The dismiss button isn't "Cancel", which would read as the action.
- Every change is recorded in the booking's **History**: booked, rescheduled from {old time} by {who}, cancelled by
  {who} with the reason. The booking screen shows it, newest first.
- Each change also adds simulated messages (see [Reminders and messages](#reminders-and-messages)).
- Bookings can't be rescheduled after they start, once cancelled, or after their page is deleted.

## Reminders and messages

**Email is simulated.** Nothing is sent. Instead each booking lists the messages it would send, with when, so the
reminder settings can be seen working. The interface labels the list "Simulated email".

- When a booking is made, its page's reminders are copied onto it. Each reminder is due its offset before the start.
- The booking screen's **Messages** list is ordered by when each message is due, latest first, so reminders still to
  come sit at the top. It shows:
  - "Confirmation to {guest}", "Booking notice to {host}" when it's made;
  - each reminder: "Reminder to {guest or host}, {offset} before", with **Due {time}**, **Due time passed** (it would
    have been sent then), **Skipped** (it was booked after the reminder would have gone) or **Cancelled** (the booking
    was cancelled first);
  - "Rescheduled notice to {guest and host}" and "Cancellation notice to {guest or host}" for changes.
- A confirmation or a notice is due the moment its change happens, so it shows that time and **Due time passed**. Only
  reminders can be **Due {time}**, **Skipped** or **Cancelled**.
- Rescheduling moves every reminder that's still due to the new time.
- The confirmation lists the guest's own reminders: "We'll remind you {offset} before (simulated)".

## Guest accounts

A guest can turn their anonymous session into an account, which moves everything they made as a guest to it. This is in
scope so the app exercises moving records to a new user.

- The confirmation's **Keep your bookings** card, for anonymous guests, says "Create an account to find your bookings
  any time, in any browser." with **Create account**.
- **Create account** opens a form with Name and Email, filled in from the booking, and Password (at least 8 characters),
  and **Create account**. It signs up with Better Auth's email sign-up from the anonymous session, on the host the guest
  is on.
- Better Auth's anonymous plugin then links the accounts. In its `onLinkAccount`, the app moves every booking whose
  `guestUserId` is the anonymous user to the new user, and calls attachments' `moveUser({ userId, toUserId })`, so the
  guest's documents and drafts go with them. Better Auth then deletes the anonymous user.
- Afterwards the card says "Account created. Your bookings are in Better Booking." with **Open Your bookings**, which
  goes to `/me/bookings` on the app. On an organization's domain, the app asks them to sign in there first, since
  sessions don't cross hosts.
- The new account gets a handle and a default schedule, and starts in Personal.
- An email that already has an account: "There's already an account with that email. Sign in on Better Booking to see
  it." Linking a guest session to an existing account is out of scope.

## Documents

Documents come from `@better-apps/attachments`, uploaded with `@better-apps/uploadcn`, on two subject types.

- **Booking page documents**: up to 5, 10 MB each. Whoever can see the page sees and downloads them: anyone for public
  pages, and anyone with a private page's private link or a short link that lets them in.
- **Booking documents**: up to 6 in all, from the guest and the team together, 10 MB each. The guest, the host and the
  workspace's members (Personal: its owner) see and download them.
- Allowed types: PDF, PNG, JPEG, WebP and Word (`.docx`).

### Who can do what with documents

| On             | Add                                                                                                                                     | Remove own                                 | Remove anyone's                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| A booking page | Its host, or an owner or admin (Personal: its owner)                                                                                    | Whoever added it, while they can still add | Owners and admins (Personal: its owner)           |
| A booking      | Its guest, while it's confirmed, hasn't started and the page's Guest documents isn't Off; its host and any member (Personal: its owner) | Whoever added it, while they can still add | Its host, owners and admins (Personal: its owner) |

- A page's documents show on its public page under **Documents**, each with its name, size and a download link. The
  public page checks the page's access first (public, private key or short link grant), then loads the documents on the
  server, so their signed download links work for an hour, including for a private page opened through its private link.
- A booking's documents show on its confirmation, as a count in the Bookings list, and on its booking screen, grouped by
  who added them: the guest or the team.
- A cancelled booking keeps its documents. Deleting a booking page removes the page's documents, not its bookings'.
- The team can add documents to a booking whatever its state, such as a proposal after the call, so the booking screen
  keeps its upload area on past and cancelled bookings. Only the guest's side locks.
- On the booking screen each group says so when it's empty: "No documents from the guest." and "No documents from your
  team yet."
- A new page can't take documents until it's saved: the Documents area says "Save the page to add documents".

## Short links

Short links come from `@better-apps/short-links` at `/s/{code}`. A link points to a booking page or to a web address.
The natural use is one link per place a page is shared, such as LinkedIn, a newsletter or a webinar, so the clicks and
bookings show which place brings guests. The New link dialog's hint says so: "Make one link per place you share, to see
which brings bookings."

### Making a link

The **New link** dialog, from the Links page or a booking page's Short links tab:

| Field        | Rules                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Goes to      | **Booking page** or **Web address**. From a booking page's tab, it's that page, not shown.                                   |
| Booking page | Any page in the workspace, by title.                                                                                         |
| Web address  | Required for web addresses. `http` or `https` only, up to 2,000 characters.                                                  |
| Custom code  | Optional. 1 to 64 letters, digits, `-` and `_`, or 1 to 51 for a private page; case doesn't matter. Taken codes are refused. |
| Expires      | Optional date, with the hint "Stops working at 23:59 UTC" and **Clear** to remove it.                                        |

- A link made to a **private** page lets anyone who has it open the page, and its code gets 12 random characters after
  any custom code, as short links requires (`partner-k3j9x0a1bz7q`). The dialog explains this when a private page is
  chosen. Only the page's host or an owner or admin can make one; others see "Only its host or an owner or admin can
  make links to a private page."
- Links to public pages and web addresses don't let anyone in.
- In an organization, links belong to the organization (`owner: "org"`). In Personal, to the person.
- The dialog's buttons are **Cancel** and **Create link**. The Custom code field shows the short URL's start before the
  code, and for a private page the 12 random characters after it.
- The new link is copied, and a toast says "Link copied" with the short URL.

### Where a link is shared

- An organization's links are shared on its primary domain once it's ready, such as
  `http://go.buildkit.gg.booking.localhost:4192/s/intro-linkedin`, and on the app's address before that.
- Personal links are always shared on the app's address.
- Every ready domain of an organization opens that organization's links. The app's address opens every link. Any other
  host opens none.
- Codes are unique across the app, so a code another organization took is refused.

### Opening a link

- A link to a booking page redirects to the page's address. A link that lets guests in sets its grant cookie, so the
  private page opens there.
- A link to a web address redirects to it.
- Each open records a click. Missing, turned-off, expired and other organizations' links answer the not-found page.

### Managing links

| Action        | Result                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Copy          | Copies the short URL.                                                                                                                   |
| Open          | Opens the short URL in a new tab, which counts a click.                                                                                 |
| Turn off / on | An off link answers not found. Turning on a link that lets guests in checks again that its maker may make it.                           |
| Edit          | The New link dialog with Goes to and the code locked. The web address is editable for web-address links, and the expiry for every link. |
| Delete        | Asks first. The code is free again. Bookings it brought keep showing its code as their source, marked "(deleted)".                      |

Links that let guests in are marked **Lets guests in** in the Links table and the page's Short links tab.

**Delete** asks "Delete {code}?" with "The link stops working and its code is free again. Bookings it brought keep
showing its code as their source, marked "(deleted)"." and **Delete link**. A link with no expiry shows "No expiry"
where its expiry would be.

## Clicks and sources

Clicks over time and booking sources rely on short links recording each click as an event and telling the destination
which link was opened. That's a change to `@better-apps/short-links`, made in its own PR before this app is built.

- **Clicks over time**: each link's clicks by day, from its click events, in the viewer's zone.
- **Source**: when a guest arrives through a short link to a booking page, the page keeps that link's code for the
  visit, for 7 days on that host, the latest link winning. A booking made in that time stores it as its source. Anything
  else is **Direct**. Rescheduling keeps the source.
- **Where they show**:
  - the **Link** screen: a **Clicks over time** chart for the last 7, 30 or 90 days (30 by default), as daily bars with
    the total, and **Bookings from this link** with "{bookings} bookings from {clicks} clicks", and a list of those
    bookings;
  - the **Links** table and a page's **Short links** tab: a **Bookings** column beside Clicks;
  - the **Dashboard**: **Top links** with clicks and bookings, and **Where bookings come from**: the last 30 days'
    bookings by source, Direct included;
  - the **Booking** screen and Bookings list: the source, linking to the link;
  - the **Bookings** page: a **Source** filter.
- Empty chart: "No clicks in this period." Web-address links show clicks only, without bookings: a Bookings column shows
  an en dash for them, named "Doesn't apply to web addresses" for screen readers, and the Link screen leaves out its
  Bookings number and **Bookings from this link**. A sentence leaves the clause out: "156 clicks".
- The chart marks the hovered or focused day with its date and clicks, and shows the period's dates under the total.

## Handles

- A person changes their handle at `/settings/profile`, and owners and admins change the organization's at
  `/settings/organization`. Members see the organization's read-only.
- Rules: 3 to 30 lowercase letters, digits and hyphens, starting with a letter, unique across people and organizations,
  and not one of `admin`, `api`, `app`, `book`, `help`, `support`, `www` or the reserved slugs.
- The field previews the public list's new address on the app as it's typed, such as
  `booking.localhost:4192/book/buildkit`. That's so for an organization with a primary domain too, since the handle
  shows only in the app's addresses and its domains' addresses don't change.
- The field's hint gives the rule: "3 to 30 lowercase letters, digits and hyphens, starting with a letter."
- Saving asks first: "Change your handle to {new}?" "Your booking pages' addresses on Better Booking change, and the old
  ones stop working. Short links and addresses on your domains keep working."
- The old handle is free for anyone at once. Confirmations keep working, since they don't depend on the handle.

## Domains

Domains come from `@better-apps/domains`. Only organizations have them.

- **Subdomain**: a label under the app's zone, `globex` for `globex.booking.localhost`, ready at once. One per
  organization: once it has one, Add a domain turns the Subdomain option off and says "You already have a subdomain,
  {hostname}. Remove it to use another."
- **Custom domain**: a domain the organization owns, such as `go.buildkit.gg`. It's pending until a check finds its
  ownership TXT record, then ready once the provider reports it and its certificate active. Up to 10 domains in all.
- A pending custom domain shows each DNS record to add (type, name, value, a copy button for each, and whether the last
  check found it), its certificate's state, and when it was last checked and is checked next, in UTC.
- A domain that isn't ready shows domains' `error` text under its status when there is one: a pending domain the latest
  problem found, a failed one the reason it failed, with **Check now** and **Remove**.
- The records sit under "Add these records at your DNS provider", each marked **Found** or **Not found** from the last
  check. A failed domain keeps its records, since its error says to fix them, and shows only when it was last checked:
  it has no next check.
- **Your domains** counts them against the limit: "{n} of 10 domains".
- **Check now** checks at once, at most every 10 seconds per domain. **Make primary** works on ready domains. The first
  ready domain becomes primary.
- **Remove** asks first: "Remove {hostname}?" with **Remove domain**. Removing the primary domain promotes nothing:
  pages and short links use the app's address until someone chooses **Make primary** on another ready domain. Its
  warning says so.
- On your machine only, a pending custom domain also has **Add to local DNS**, which adds its records to the local DNS
  as its owner would at their DNS provider, and checks once, which finds the ownership record. The card then says "Check
  again to finish", and **Check now** finds it ready.
- Changing the primary domain changes every address and short URL the app shows for that organization at once. Old
  addresses on a removed domain stop working.

## Screens

Every signed-in screen sits in the app shell. Every screen covers its loading, empty and error states, and the
permission state where one applies. Errors follow the placement rule in [Copy](#errors). Anything simulated carries a
**Simulated** label.

### App shell

- **Sidebar**: the brand mark and **Better Booking** with the workspace's name under it, then **Dashboard**, **Booking
  pages**, **Bookings**, **Links**, **Availability**, and a **Settings** group: **Calendars**, **Organization** and
  **Domains** (the last two for organizations only). The current page is marked.
- **Account menu** at the sidebar's foot: the person's name and their role in the workspace, or "Personal". It holds
  **Your bookings**, **Profile**, **Workspace** (Personal and each organization, the current one checked),
  **Appearance** (Light, Dark, System) and **Sign out**. Switching workspace reloads the page.
- **Header**: the sidebar toggle, and breadcrumbs ending at the current page. A top-level screen is one crumb, such as
  "Calendars": Settings is a group in the sidebar, not a page, so it's never a crumb. A screen inside another names its
  parent first: "Booking pages", then "Intro call"; "Bookings", "Mira Chen", then "Reschedule".
- **Your bookings** and **Profile** mark nothing in the sidebar, since they're reached from the account menu. Neither
  does a screen the sidebar hides, such as Domains in Personal.
- **Organization** and **Domains** are hidden in Personal. Their Personal messages are for someone who arrives by
  address, or who switches to Personal while on one.
- Alerts that need dismissing show at the top of the page, above its content. Short confirmations are toasts, at the
  bottom right. See [Errors](#errors) for which failures are alerts.

### Sign in (`/sign-in`) and Create account (`/sign-up`)

- Both are a card centred on a plain page, under the brand mark and "Better Booking", with no app shell.
- Sign in: "Sign in to manage your booking pages.", email and password, and, when the demo data is on, a **Sign in as
  Ada**, **Grace** and **Alan** button for each demo person under "Demo accounts", each with their role, such as "Owner
  at Buildkit", and one line for the password: "All three use the password `better-apps-example`". A wrong password says
  "That email and password don't match." under the password field. Signed-in people are sent to the dashboard. Anonymous
  guest sessions are signed out first. "New to Better Booking?" links to Create account.
- Create account: name, email and password (at least 8 characters). The new account gets a handle and a default
  schedule, and lands on the dashboard in Personal.

### Dashboard (`/`)

- **Heading**: "Welcome back, {first name}", and the workspace.
- **Your booking pages are at {address}**, with Copy and Open: the owner's public list.
- **Numbers**: upcoming bookings in the next 7 days ("In the next 7 days"), open booking pages ("Taking bookings now"),
  total clicks on the workspace's links ("All time, across {n} links"), and the primary domain with its status
  (organizations) or the app's address, labelled "App's address" (Personal).
- **Upcoming bookings**: the next 5, each with the time, the guest, the page and the host, and **See all bookings**.
- **Top links**: the 5 links with the most clicks, each with its short URL, where it goes, its clicks and bookings, and
  **See all links**.
- **Where bookings come from**: the last 30 days' bookings by source as a short ranked list with counts, Direct
  included. Empty: "No bookings in the last 30 days."
- **Domain** (organizations): the primary domain and its status with **Manage domains**, or "Add a domain to share pages
  on your own address" with **Add a domain** for owners and admins.
- **Empty workspace** (no booking pages): "Make your first booking page" with "Set a title, a length and your hours,
  then share its address or a short link." and **New booking page** replaces Numbers, Upcoming bookings, Top links and
  Where bookings come from. The Domain card stays for organizations.
- Upcoming bookings and Top links are tables beside Where bookings come from and Domain. On phones each row becomes a
  few lines: the time, the guest, then "{page} with {host}"; the short URL, "Goes to {destination}", then its clicks and
  bookings.

### Booking pages (`/pages`)

- **Your booking pages are at {address}**, with Copy and Open.
- A list of the workspace's pages: title, host, duration, schedule, visibility (Public or Private), status (Open, Paused
  or Needs a host), upcoming bookings, and the address with a copy button. Each row opens `/pages/{id}` and has an
  actions menu: Copy address, Pause or Open, Delete.
- A private page's row shows its address, not its private link. Its copy button copies the private link, and is named
  for that: "Copy the private link of {title}".
- **New booking page** opens the editor.
- Filters: visibility, status, and host (organizations), kept in the URL.
- Empty: "No booking pages yet" with "A booking page is what guests book: a title, a length and your open times." and
  **New booking page**.

### Booking page (`/pages/new`, `/pages/{id}`)

A full page with tabs driven by the URL: **Details** (`/pages/{id}`), **Short links** (`/pages/{id}/links`) and
**Bookings** (`/pages/{id}/bookings`). A new page has only Details, and the first **Save** moves to `/pages/{id}`.

- **Header**, on every tab: the page's title, its visibility and its status. **Save** sits there on Details, so it stays
  in reach on a long form.
- **Details**: the field groups (Basics, When, Reminders, Guest changes, Documents) as cards in the main column, with
  the address previewed under the slug as it's typed, the next open times previewed in When, and **Save**. **Guest
  documents** shows the prompt field when it isn't Off. **Documents** lists the host's files with an upload area and a
  remove button on each; uploads save at once, apart from **Save**, so leaving with unsaved changes asks first only
  about the fields. Aside, as three cards: the address or private link with Copy and Open, and **Reset private link**
  (private pages); the status with **Pause** or **Open**; and **Delete page**.
- The private page hint shows once, under Visibility when **Private** is chosen.
- **Reminders** carries the Simulated label, since it's email that would send them.
- **Short links**: the page's links (short URL, **Lets guests in** where it applies, status, clicks, bookings, last
  opened) with **New link**, the short link hint beside it, and each link's actions. It has no search, filters or **Load
  more**. Empty: "No links yet" with the hint and **New link**.
- **Bookings**: the page's upcoming, past and cancelled bookings, as on the Bookings page's list, without the Page
  column and filter and without the Week view. **Upcoming**, **Past** and **Cancelled** are a segmented control here, so
  they don't read as a second row of the page's tabs.
- People who can see a page but not edit it see the fields read-only, with "You can see this page. Only its host, or an
  owner or admin, can change it." and no **Save**, **Pause** or **Delete page**.
- **Needs a host** shows a banner to owners and admins: "{Name} left, so this page isn't taking bookings. Choose a new
  host." Host is empty with "Choose a new host." under it. Schedule is turned off, reading "Choose a host first", with
  "The schedule switches to the new host's default." The status reads **Needs a host**, and When shows no next open
  times. It's a design-only state: the demo can't produce it, since members can't leave.

### Bookings (`/bookings`)

- Tabs **Upcoming**, **Past** and **Cancelled**, and views **List** and **Week**, all in the URL.
- **List**: each booking with its date and time (see [Time zones](#time-zones)), the guest's name and email, the page
  (or "{title} (deleted)"), the host (organizations), its source, the note's first line, cut off with an ellipsis, and
  how many documents it has. Each opens the booking screen. Bookings load 50 at a time with **Load more**. The date sits
  above the time in one column, and the guest's name above their email. The document count is a paperclip and a number,
  and blank for none. The Cancelled tab swaps Note and Documents for one Cancelled column: who cancelled, when, and the
  reason.
- **Week** (Upcoming only): a grid of the week's days by hour, from the earliest to the latest booking or 8 am to 6 pm,
  whichever is wider, with each booking as a block showing its time, guest and page. Filtered to one host, that host's
  calendar busy times show as grey **Busy** blocks. **Previous week**, **Today** and **Next week** move it. Phones show
  one day at a time with a day switcher. Today's date is marked and says "today". A legend names the two kinds of block,
  with the Simulated label on Busy. The grid shows bookings and busy times only, not the host's hours or days off, so a
  day off looks empty.
- Filters: page, host and source, in the URL, with **Reset** once one is set. Each row's actions menu has **Open
  booking**, and **Reschedule** and **Cancel booking** for those allowed.
- Empty: "No upcoming bookings" with "Share a booking page to get booked" and the owner's public list address; "No past
  bookings"; "No cancelled bookings".

### Booking (`/bookings/{id}`)

A full page:

- The page (or "{title} (deleted)") and host, the date, time and duration (see [Time zones](#time-zones)), the status
  (**Upcoming**, **Past** or **Cancelled**), "Rescheduled from {old time}" when it applies, the location with its
  details, the guest's name and email, the note, the source, and "Added to {calendar} (simulated)" when it applies.
- **Documents**, split into **From the guest** and **From your team**, with an upload area for members and a remove
  button where allowed.
- **History** and **Messages** (simulated email), as described above.
- **Reschedule** and **Cancel booking** for those allowed.
- The guest's name is the page's heading, with "{page} with {host}" under it. The details and Documents are the main
  column, with History and Messages beside them. The source shows its code and its short URL.

### Reschedule (`/bookings/{id}/reschedule`)

The page's week picker with the current time marked, for hosts and owners and admins, then "Move to {new time}?". The
heading is "Reschedule", with the guest, the page, the host and the current time under it, and **Back to booking**
above. See [Rescheduling and cancelling](#rescheduling-and-cancelling) for the host's line and the time-taken state.

### Availability (`/availability`)

- A list of the person's schedules: name, zone, a one-line summary of the hours ("Mon to Fri, 9 am to 5 pm"),
  **Default**, and "Used by {n} booking pages". **New schedule**.
- A schedule (`/availability/{id}`): name, time zone, **Weekly hours** as a row per weekday with an on or off switch,
  its ranges with a remove button each, **Add range** and **Copy to all weekdays**, then **Date overrides** with **Add
  override** (a dialog with a calendar, then **Unavailable** or **Available at these times** with its ranges, and the
  note), each override with its date, its note, Edit and Remove. **Save**, **Make default** and **Delete schedule**.
  Leaving with unsaved changes asks first. A day that's off reads "Unavailable".
- Phones: one weekday per row, its ranges stacked under it.

### Calendars (`/settings/calendars`)

The simulated label, **Connect** with Google Calendar and Microsoft Outlook, then each connection: its provider and
account name ("ada@example.com (demo)"), its calendars with **Check for conflicts** switches, and **Disconnect**. Then
**Add new bookings to**, as a choice of each calendar and **Don't add**. Empty state as in [Calendars](#calendars). Each
calendar lists its next few sample events, each marked **Demo**, and counts the rest: "{n} more sample events over the
next four weeks."

### Profile (`/settings/profile`)

Name, email (read-only), handle with its preview, and the default schedule's zone as a shortcut to Availability.
**Save**.

### Organization (`/settings/organization`)

The organization's name and handle with its preview, and **Save**, for owners and admins. Members see them read-only:
"Only owners and admins can change the organization." Personal: "Switch to an organization in the account menu to change
it."

### Your bookings (`/me/bookings`, `/me/bookings/{id}`)

- The bookings this person made as a guest, in any workspace: tabs **Upcoming**, **Past** and **Cancelled**, each with
  the time, the page, the owner and the host. Each opens `/me/bookings/{id}`.
- `/me/bookings/{id}` is the confirmation, in the app shell, with Reschedule, Cancel, documents and Add to calendar. The
  owner's name sits under the page's title, since there's no public header to carry it. It leaves out the **Keep your
  bookings** card and "Bookmark this page to come back to it in this browser.", which are for anonymous guests.
- Empty: "No bookings yet" with "Bookings you make on any booking page show here."

### Links (`/links`)

- **New link** opens the New link dialog.
- A table: **Short link** (with copy), **Goes to** (the booking page's title, or the web address), **Lets guests in**,
  **Status** (On, Off or Expired), **Clicks**, **Bookings**, **Last opened**, **Created**, and an actions menu (Copy,
  Open, Edit, Turn off or Turn on, Delete).
- Search (codes and destinations), a **Type** filter (Booking page, Web address) and a **Status** filter with counts.
  Columns sort. Search, filters and sorting are kept in the URL and apply to the loaded rows.
- The Short link cell is two lines so nine columns fit: the host and `/s/` in small muted text, and the code under it.
  Its copy button still names the whole short URL. Created leaves the year out for this year's links.
- Links load 50 at a time, newest first, with **Load more**.
- Empty: "No links yet" with **New link**.

### Link (`/links/{code}`)

A full page: the short URL with Copy and Open, where it goes (a link to the booking page, or the web address), whether
it lets guests in, status, clicks, bookings, last opened, who made it and when, the expiry, and the hosts it opens on.
Then **Clicks over time** and **Bookings from this link** (see [Clicks and sources](#clicks-and-sources)). **Edit**,
**Turn off** or **Turn on**, and **Delete link**. The code is the page's heading. The facts are labelled **Goes to**,
**Clicks**, **Bookings**, **Last opened**, **Made by**, **Expires**, **Lets guests in** and **Opens on**, which lists
each host and marks the primary one.

### Domains (`/settings/domains`)

- **Add a domain** (owners and admins): **Subdomain of booking.localhost** or **Domain you own**, a field for the label
  (with `.booking.localhost` after it) or the hostname, and **Add domain**.
- **Your domains**: each with its hostname, status (Ready, Pending or Failed), **Primary**, its kind, and **Check now**,
  **Make primary**, **Remove** and, locally, **Add to local DNS**. Pending custom domains show their records and
  certificate state. Failed ones show the reason.
- Members see it read-only: "Only owners and admins can add or change domains."
- Personal: "Domains belong to organizations. Switch to one in the account menu to add a domain."

### Public pages' layout

The public pages have no app shell. Each has a slim header with the owner's initial and name, or the brand mark and
"Better Booking" on the app's own not-found page, then one centred column. The booking page and the confirmation split
that column in two: the page's facts beside the picker or form, and the confirmation beside **Keep your bookings**. On
phones they're one column.

### Public: owner's pages (`/book/{handle}`, or a domain's `/`)

The owner's name, and a card for each public, open page with its title, duration, location kind, description and host,
linking to the page. Paused pages and pages that need a host aren't listed. No pages: "No public booking pages."

### Public: booking page

- The owner's name and the host, the title, duration, location kind and description, and the page's **Documents** when
  it has any.
- **Times shown in {zone}**, then the week picker (see [The week picker](#the-week-picker)). The open select has "Search
  time zones", then "Your time zone" and "This page's time zone" as its first two groups.
- The booking form after a time is chosen, in the picker's place, with the chosen time and **Change time**.
- Each of the page's documents has **Download**.

### Public: confirmation and reschedule

As described in [Confirmation](#confirmation) and [Rescheduling and cancelling](#rescheduling-and-cancelling): the
upcoming, started, passed, cancelled and rescheduled states, the cancel dialog, the reschedule picker, and the Keep your
bookings card before and after creating an account.

### Not found

One page for every missing, hidden or turned-off thing: "This page isn't available", "The link may be wrong, turned off
or private." On an organization's domain it adds **See {Organization}'s booking pages**, linking to the domain's root.
It answers HTTP 404.

## Data

The database is D1, through `void/db`'s Drizzle instance passed to `drizzleAdapter`. The app's own tables are in
`db/schema.ts`, where Void reads the schema, and migrations are in `db/migrations/`, written by `void db generate`. The
scheduling module replaces the schedule, calendar and booking tables and the open-time calculation.

**`handle`**: `ownerType` (`user` or `org`), `ownerId`, `handle` (unique), `lastOrgId` (people only: the workspace a new
session starts in, null for Personal). Every person gets one when they sign up and every organization when it's created,
through Better Auth's hooks, made from their name with a number added when it's taken. Anonymous guests get none.

**`schedule`**: `id`, `userId`, `name`, `timeZone`, `isDefault`, `createdAt`, `updatedAt`. **`schedule_hours`**:
`scheduleId`, `weekday` (1 to 7), `startMinute`, `endMinute`. **`schedule_override`**: `scheduleId`, `date`,
`unavailable`, `note` (null for none), and its ranges in **`schedule_override_hours`** (`overrideId`, `startMinute`,
`endMinute`).

**`calendar_connection`**: `id`, `userId`, `provider` (`google` or `microsoft`), `accountName`, `simulated` (always true
here), `createdAt`. **`calendar`**: `id`, `connectionId`, `name`, `checkConflicts`, `addBookings`. **`busy_time`**:
`calendarId`, `title`, `startsAt`, `endsAt`.

**`booking_page`**: `id`, `ownerType`, `ownerId`, `orgId` (null in Personal), `hostId`, `scheduleId`, `title`, `slug`
(unique with the owner), `durationMinutes`, `locationKind` (`video`, `phone` or `in_person`), `locationDetails`,
`description`, `bufferBeforeMinutes`, `bufferAfterMinutes`, `minimumNoticeMinutes`, `windowDays`, `startStepMinutes`
(null for every duration), `dailyLimit`, `reminders` (JSON list of `{ to, minutesBefore }`), `guestChangeHours` (null
for Not online), `visibility`, `privateKey` (null for public pages), `status` (`open` or `paused`), `guestDocuments`
(`off`, `optional` or `required`), `documentPrompt`, `createdAt`, `updatedAt`.

**`booking`**: `id`, `pageId` (null once the page is deleted), `pageSlug`, `bookedOnHost` (the host it was booked on,
for the confirmation's address and access), `ownerType`, `ownerId`, `orgId`, `hostId`, `pageTitle`, `durationMinutes`,
`locationKind`, `locationDetails`, `timeZone`, `bufferBeforeMinutes`, `bufferAfterMinutes`, `reminders`,
`guestChangeHours`, `guestUserId` (the guest's anonymous or signed-in user), `startsAt`, `endsAt`, `blockedFrom` and
`blockedUntil` (the booking plus its buffers), `sourceLinkCode` (null for Direct), `calendarId` (the calendar it was
added to), `guestName`, `guestEmail`, `note`, `status` (`confirmed` or `cancelled`), `cancelledBy` (`guest` or a user
id), `cancelReason`, `createdAt`, `cancelledAt`. The copied page fields are taken when it's booked. Indexed on
`(hostId, blockedFrom)` for overlap checks, `(orgId, startsAt)`, `(pageId, startsAt)` and `(guestUserId, startsAt)` for
lists, and `sourceLinkCode` for sources.

**`booking_event`**: `id`, `bookingId`, `type` (`booked`, `rescheduled` or `cancelled`), `actor` (`guest` or a user id),
`fromStartsAt`, `toStartsAt`, `reason`, `createdAt`. Messages are worked out from the booking and its events, not
stored.

- **No double bookings on D1.** D1 has no interactive transactions, so a booking is saved, or moved, by one statement:
  `INSERT ... SELECT ... WHERE NOT EXISTS` (or `UPDATE ... WHERE NOT EXISTS`) a confirmed booking with the same
  `hostId`, other than itself, where `blockedFrom < :blockedUntil` and `blockedUntil > :blockedFrom`. No row written
  means the time was taken. Calendar busy times and the daily limit are checked just before, in the same request.
- The server works out the time from the page, never from the client: on the start-time grid, inside the schedule, past
  the notice, within the window and under the daily limit. `endsAt` is the start plus the duration.

Features add their own tables through `better-apps generate`: `shortLink` and its click events, `domain`, attachments'
`attachmentFile`, `attachment` and `attachmentRemoval`, and the core outbox. Better Auth's anonymous plugin adds
`isAnonymous` to `user`. `db/schema.ts` re-exports Better Auth's and the features' generated tables, since Void reads
only that file.

## Wiring the features

- **Subjects**:
  - `bookingPage`, with `getOrgId` from the page. `canView` is true for public pages and, for private ones, for the
    owner (Personal) or the organization's members. `publicRead` and `publicReadMany` are true for public pages, paused
    ones included. Short links' grants add anyone holding a link that lets them in, when the check passes the request.
  - `booking`, with `getOrgId` and `canView` read from the booking row, so they work after its page is deleted:
    `canView` for its guest's user, its host while a member, and the workspace's members (Personal: its owner).
- **Page access for public routes.** The public page load, the booking action and the page's document list share one
  resolver. It finds the page by host and slug (domain) or handle and slug (app), requires a page that host serves, then
  requires a public page, the matching key, or `app.subjects.canView(actor, page, { request })` through a grant.
  Anything else answers the same not found. The booking action takes
  `{ handle?, slug, key?, startsAt, name, email, note, fileIds }` and refuses paused pages and pages that need a host.
- **Booking access for confirmations.** The confirmation, its reschedule and cancel actions and its `event.ics` find the
  booking by id alone, with no page lookup, and require that `guestUserId` is the session's user, and that the request's
  host is the one it was booked on (`bookedOnHost`) or the app's host under `/me/bookings`. So they work for private
  pages without the key, after a slug or handle change, and after the page is deleted. Booking documents download
  through booking `canView`.
- **Short links**: `subjects.bookingPage` with `url` returning the page's address (on its primary domain when ready),
  the default `canShare` (whoever can see the page), and `grantView` allowing only the page's host and owners and admins
  for private pages. `canManage` is the default, so every member sees and manages all of the organization's links.
  `validateUrl` allows `http` and `https`. `baseUrl` is the app's address, and `hosts` is `domainHosts`' (below).
  `notFound` renders the not-found page. Lists call `list({ owner: "org" })` in an organization and
  `list({ owner: "user" })` in Personal. The dashboard's totals, top links and sources query the tables directly,
  filtered to the workspace, since `list` doesn't sort by clicks.
- **Click events and sources** come from the short-links change that records each click and passes the link's code to
  the destination. The booking page reads the code, keeps it in a 7-day cookie on that host, and the booking action
  stores it as `sourceLinkCode` when it names one of the page owner's links.
- **Domains**: `subdomains.zone` is the app's zone, with `subdomains.reserved` adding the app host's label and the CNAME
  target's label to `defaultReservedSubdomains`. `custom.provider` is `localHostnames()` locally or
  `cloudflareHostnames()` in production. `canManage` is the default (owners and admins).
- Short links' `hosts` come from domains' `domainHosts({ url, localSuffix })`, with `localSuffix` `booking.localhost`
  only with the local provider ([betterapps-hq/better-apps#26](https://github.com/betterapps-hq/better-apps/pull/26)).
  `src/better-apps.server.ts` creates the app, then calls `linkHosts.connect(app.api.domains)`. The app's own address
  code uses the same rule for booking pages' addresses.
- **Attachments**: `subjects.bookingPage` and `subjects.booking` with `canUpload` and `canModerate` as in
  [Who can do what with documents](#who-can-do-what-with-documents). Removing a file you attached also needs
  `canUpload`, which locks a guest's documents once their booking starts or is cancelled, while `canModerate` removes
  anything ([betterapps-hq/better-apps#25](https://github.com/betterapps-hq/better-apps/pull/25)). Both take the
  document types as `contentTypes`, `maxSize` 10,000,000 bytes, and `maxFiles` 5 and 6. `maxDrafts` is 12. No
  `standalone`. `secret` signs downloads. Storage is
  [`@better-apps/storage-r2`](../../../packages/adapters/storage-r2/README.md) with `void/storage`'s binding:
  `r2Storage({ bucket: storage })`. `void.config.ts` declares that binding, `STORAGE`, under `cloudflare.r2_buckets`
  with the bucket from `BOOKING_BUCKET` and `remote: true`, so development uses the real bucket. Without `s3`, uploads
  go through the Worker, well within its 100 MB request limit, so no R2 API token or CORS rule is needed. A cron job,
  `crons/sweep-files.ts`, runs up to three pages of `app.api.attachments.sweep()` every 15 minutes.
- **Guest documents**: the booking form uploads drafts with uploadcn's `useDraftUploader("booking")`. On **Book**, the
  browser sends the finished drafts' ids from the uploader's state as `fileIds`. The action:
  1. Checks the page's access, the time and Required (at least one id), and checks the ids as the guest: ready, the
     guest's own, and within `maxFiles`.
  2. Inserts the booking.
  3. Calls `attach` with `author: { type: "user", userId: guestUserId }`, so only the guest's own drafts attach.
  4. Deletes the booking and returns the error if `attach` fails.

  The queue isn't cleared after a booking, and on "time taken" it stays as it is, so the files are kept. Attaching a
  guest's drafts to an organization's booking relies on
  [betterapps-hq/better-apps#25](https://github.com/betterapps-hq/better-apps/pull/25), since a guest's drafts belong to
  no organization.

- **Uploads elsewhere**: uploadcn's `useAttachmentsUploader` with `@uploadcn/react`'s parts styled with Nova. The app
  shows its own strings for UploadCN's error codes, and checks the count before adding files.
- **Better Auth**: the organization plugin, and the anonymous plugin for guests.
  - `onLinkAccount` moves the anonymous user's bookings (`guestUserId`) and calls attachments'
    `moveUser({ userId, toUserId })` from #25, then lets Better Auth delete the anonymous user.
  - One helper that every app action and loader calls refuses `isAnonymous` users. Short links' `validateUrl` and
    `canManage` refuse them too.
  - Anonymous users never appear in member lists or people searches.
  - `trustedOrigins` is a function that allows a request's origin when `linkHosts.hosts.resolve({ hostname })` answers,
    with the scheme and port matching `baseUrl`, so guests can start sessions and create accounts on a domain.
  - `rateLimit` with database storage limits anonymous sign-ups and sign-ups per address. Domain add, remove and check
    are limited per organization.
  - Hooks on user and organization creation make the handle and, for people, the default schedule. A session create hook
    starts each new session in the person's `lastOrgId` workspace. Switching workspace updates it.
  - `session.expiresIn` is 30 days for every session, so guests' sessions outlast most booking windows.
- **Void**: the app is TanStack Start with `voidPlugin()` before `tanstackStart()` in `vite.config.ts`, and deploys as
  one Cloudflare Worker. Cron jobs in `crons/` call `app.deliverEvents()` every minute, for domains' scheduled checks,
  and attachments' sweep every 15 minutes. `env.ts` declares every variable.
- A request handler sorts each request by host before routing, as the [addresses table](#addresses-and-hosts) lists: the
  app's hosts go to the app's routes, and a ready organization domain goes to its own paths, or a redirect to the app.

## Local development

The dev server is Vite with Void's plugin, which runs the app on Cloudflare's local Workers runtime. D1 is local, kept
under `.void` and `.wrangler`. Documents go to the real R2 bucket `better-booking-dev` through a remote binding, the
only thing that calls Cloudflare. Domains and DNS stay local.

- Void needs Node 24.22 or newer.
- Sign in once with `void cloudflare login`, or an existing Wrangler login, so the remote binding can reach the bucket.
  Without a login the dev server says so and seeding stops, rather than seeding half the data. Remote binding calls are
  slower than local ones, and every upload is real. Put, head, ranged reads, `etagMatches` and delete were checked
  through the remote binding with Void 1.7.0.
- Put `ATTACHMENTS_SECRET` in `apps/booking/.env`, which Git ignores. Void reads only that file.
- The app runs at `http://booking.localhost:4192`, and the production build at `http://booking.localhost:4193`. Browsers
  send every `*.localhost` name to this machine.
- The subdomain zone is `booking.localhost`, so Globex's subdomain is `globex.booking.localhost:4192`.
- Custom domains run on `localHostnames()` with its own DNS, and the CNAME target `customers.booking.localhost`.
- Browsers can't reach `go.buildkit.gg` here, so the app also answers each custom domain at
  `{hostname}.booking.localhost`, such as `go.buildkit.gg.booking.localhost:4192`.
- The local DNS lives in the Worker's memory and forgets everything when the dev server restarts, so the first request
  after a start puts its domains' records back.
- Cron jobs don't fire in local development. **Add to local DNS** and **Check now** run the domain's check at once, and
  `POST /__void/scheduled` runs a job by hand.
- Delete `.void` and `.wrangler` to start over with fresh demo data. Files from earlier runs stay in the bucket, since
  nothing points at them anymore; empty it to clear them.

## Production

`void deploy --platform cloudflare` builds the app, provisions its D1 database from its `void/db` import, binds the
bucket `BOOKING_BUCKET` names, applies `db/migrations/` and deploys the Worker to your own Cloudflare account. Secrets
are set with `void secret put`. A `*/*` route sends the app's host, the subdomain wildcard and every custom hostname to
the Worker. Set `BOOKING_PROVIDER=cloudflare` to serve custom domains with Cloudflare for SaaS, after the one-time setup
in the [domains spec](../../../packages/features/domains/docs/spec.md#one-time-cloudflare-setup).

| Variable                                     | What it is                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_URL`                            | The app's own origin, such as `https://booking.example.com`                                        |
| `BETTER_AUTH_SECRET`                         | Better Auth's secret                                                                               |
| `BOOKING_ZONE`                               | The zone organizations get subdomains of, such as `example.com`                                    |
| `BOOKING_PROVIDER`                           | `local`, the default, or `cloudflare`                                                              |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID` | The SaaS zone's token, with SSL and Certificates: Edit, and its id                                 |
| `BOOKING_CNAME_TARGET`                       | The hostname customers point a CNAME at                                                            |
| `ATTACHMENTS_SECRET`                         | At least 32 characters, to sign download URLs                                                      |
| `BOOKING_BUCKET`                             | The production R2 bucket, set in the deploy shell. The build fails without it outside development. |
| `BOOKING_DEMO`                               | `1` seeds the demo data and shows the Sign in as buttons. Off by default in production.            |
| `BOOKING_COMPANY_NAME`                       | The seeded company's name, `Buildkit` by default. Also read in development from `.env`.            |

- With Cloudflare, the local DNS, **Add to local DNS** and the `.localhost` aliases are off, and domains looks records
  up with DNS over HTTPS.
- A public demo deploy sets `BOOKING_DEMO=1`. Password hashing on sign-in may need Workers Paid for its CPU time; check
  before relying on the Free plan.

## Interface

- Components come from Buildkit's Nova kit, `@buildkitgg/shadcn-baseui-nova`, under the `@buildkitgg/shadcn-baseui-kit`
  alias. Icons are Lucide.
- **Brand**: teal, on Nova's neutral base, in `src/styles.css`. `brand` fills primary buttons and the brand mark, with
  `brand-foreground` on it; `brand-soft` tints the selected nav item, "on" states and booking blocks in the week view,
  with `brand-soft-foreground` on it. `primary`, `ring` and the sidebar's primary colours are teal. Light and dark both
  pass WCAG AA.

  | Token                   | Light                    | Dark                    |
  | ----------------------- | ------------------------ | ----------------------- |
  | `brand`                 | `oklch(0.52 0.1 188)`    | `oklch(0.76 0.115 184)` |
  | `brand-foreground`      | `oklch(0.99 0.005 185)`  | `oklch(0.21 0.035 192)` |
  | `brand-soft`            | `oklch(0.965 0.022 185)` | `oklch(0.3 0.045 190)`  |
  | `brand-soft-foreground` | `oklch(0.42 0.085 190)`  | `oklch(0.87 0.075 183)` |
  | `warning`               | `oklch(0.86 0.14 85)`    | `oklch(0.36 0.07 65)`   |
  | `warning-foreground`    | `oklch(0.33 0.08 55)`    | `oklch(0.9 0.1 88)`     |

- **Warning**: amber. `warning` fills the badges of statuses that need attention, with `warning-foreground` on it, and
  passes WCAG AA in light and dark.
- **Type and shadows**: the kit's stylesheet defines only `text-xs`, `text-sm` and `text-base`, and no shadows, so
  `src/styles.css` adds `text-lg`, `text-xl`, `text-2xl` and `text-3xl`, and `shadow-xs` to `shadow-lg`, at Tailwind's
  default values. Page titles are `text-2xl` at weight 600.

- Small grey text never sits on a grey surface: `muted-foreground` on `muted` fails contrast at 12px.
- **Simulated** is an outline badge with a short explanation on hover and focus.
- **Codes, addresses and DNS values use the mono font**, at 13 pixels: short link codes, sources, slugs, hostnames and
  records. Inter draws an `x` between digits as a multiplication sign, which turns `k3j9x0` into `k3j9×0`.
- **A status is a badge with its word**, never colour alone:

  | Status                                    | Badge                                                |
  | ----------------------------------------- | ---------------------------------------------------- |
  | Upcoming, Open, On, Ready                 | `brand-soft` with `brand-soft-foreground`            |
  | Past, Paused, Off, Primary, Default       | Neutral (`secondary`)                                |
  | Needs a host, Expired, Pending, Not found | `warning` with `warning-foreground`                  |
  | Cancelled, Failed                         | Destructive                                          |
  | Public, Private, Lets guests in, Found    | Outline, with a globe, a lock, a key or a check icon |
  | Demo, Simulated, Required                 | Outline                                              |

  A message's state follows the same rule: **Due {time}** is outline, and **Due time passed**, **Skipped** and
  **Cancelled** are neutral.

- **Dialogs that confirm something destructive are alert dialogs**: a warning mark, the question, its consequence, and a
  destructive button named for the action, such as **Delete page**, **Remove domain** or **Cancel booking**. The rest,
  such as New link, Add override and "Move to {new time}?", are plain dialogs with a teal confirm button.
- Tables use TanStack Table with tablecn-style parts: sortable headers, faceted filters with counts, and the toolbar. A
  filter is an outline button that shows its chosen values beside its name, and its counts when open.
- **Tables keep every column at 1280 pixels and cut long values short** with an ellipsis, showing the whole value on
  hover and focus: a booking's note, a long slug or address, a web address. A row's bottom line is one line across every
  cell, whatever each cell holds.
- Charts use [Recharts](https://github.com/recharts/recharts), from the preferred tech stack: simple daily bars in
  `brand`, with an accessible table of the same numbers.
- File pickers and upload lists use UploadCN's parts through `@better-apps/uploadcn`, styled with Nova: a drop area
  that's also a button, and a row per file with its name, size, progress, **Try again** and **Remove**. Progress is
  announced in a polite live region.
- `@buildkitgg/shadcn-modals-manager` asks before destructive actions, `@buildkitgg/shadcn-alerts-manager` holds alerts
  until dismissed, `@buildkitgg/shadcn-theme` keeps the appearance, `@buildkitgg/tanstack-router` drives the booking
  page's tabs, and `@buildkitgg/typescript-utils` provides helpers.
- Dates and times use a fixed locale (`en-US`) and the zones in [Time zones](#time-zones), each labelled. A date reads
  "Wed, Nov 11" and adds its year where it stands alone: "Wed, Nov 11, 2026". A time reads "10:00 AM", and a booking's
  span "10:00 to 10:30 AM".

### Designs

The screens are drawn in [`designs/Booking.pen`](../designs/Booking.pen), a [Pencil](https://pen.dev) file, in twenty
labelled groups in the order of [Screens](#screens): light mode, at 1280 pixels, with phone layouts at 390 for the
dashboard, Bookings, a schedule, Links, the public booking page and the confirmation. Its components are linked
instances of the Nova kit's library, `designs/Shadcn Nova.lib.pen`, which is a paid kit and stays a linked library.

- **`00 Booking kit`** holds what every screen shares: the app shell for desktop and phone, the teal and neutral
  buttons, the status badges and the Simulated badge, the switch, checkbox, radio and tab in their "on" states, the page
  header, the drop area and the address with Copy and Open. The library's own primary is near black and can't be changed
  from this file, so teal comes from these wrappers. Change the kit, and every screen follows.
- **"Today" is Tuesday, November 10, 2026** in every frame, so the working days of [Demo data](#demo-data) fall on Wed,
  Nov 11 (+1), Thu, Nov 12 (+2), Fri, Nov 13 (+3), Mon, Nov 16 (+4) and Mon, Nov 9 (-1). The usual viewer is Ada, an
  owner in Buildkit, in London. Read-only states are Grace's.
- **Some frames show what the demo can't.** Globex stands in for a workspace with no booking pages. Buildkit has a
  pending `links.buildkit.gg`, a failed domain and a `buildkit.booking.localhost` subdomain. Marco Diaz's booking is on
  a deleted page, "Design review". Lena Fischer is booking Partner onboarding. Product demo needs a host. Intro call's
  Short links tab is empty.
- **Not drawn:** dark mode, the 768 width, loading and load-failure states other than the public page's times, "No past
  bookings" and "No cancelled bookings", the Bookings page's Past tab, the Bookings filters open, Edit link, the default
  schedule's delete dialog, and "Check again to finish" after Add to local DNS.

## Copy

Interface text follows the writing style guide: sentence case, plain words, and no dot glyphs as separators. Counts are
pluralized, and clauses about a zero count are left out.

| Where                    | Text                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private page hint        | "Only people with its private link, or a short link made while it's private, can open this page."                                                                               |
| Private link in dialog   | "Links to private pages let anyone who has them open the page."                                                                                                                 |
| Making a page private    | "{n} short links to this page won't let guests in. Make new ones from the Short links tab."                                                                                     |
| Short link hint          | "Make one link per place you share, to see which brings bookings."                                                                                                              |
| Paused page, guests      | "Not taking bookings right now."                                                                                                                                                |
| Time taken               | "That time was just booked. Pick another."                                                                                                                                      |
| Confirmation             | "You're booked" (a heading, so no full stop) "This is a demo, so no email was sent." "Bookmark this page to come back to it in this browser."                                   |
| Started booking          | "This booking has started."                                                                                                                                                     |
| Passed booking           | "This booking has passed."                                                                                                                                                      |
| Cancelled booking        | "This booking was cancelled on {date}." "Cancelled by {host}: {reason}"                                                                                                         |
| Rescheduled booking      | "Rescheduled from {old time}"                                                                                                                                                   |
| Changes closed           | "Changes close {n} hours before the booking."                                                                                                                                   |
| No online changes        | "This booking can't be changed online."                                                                                                                                         |
| Move booking, host       | "Move to {new time}?" "The guest and host keep the same booking, documents and confirmation address." **Move booking**                                                          |
| Move booking, guest      | "Move to {new time}?" "You keep the same booking, documents and confirmation address." **Move booking**                                                                         |
| Rescheduling as the host | "As the host, you can pick any open time. Minimum notice and the booking window don't apply."                                                                                   |
| Reschedule picker        | "Reschedule" "Back to booking" "Current time"                                                                                                                                   |
| Cancel booking, guest    | "Cancel this booking?" "Your time with {host} opens up for others. You can add a reason."                                                                                       |
| Cancel booking, host     | "Cancel {guest}'s booking?" "The time opens again. They'd get a cancellation email, which this demo simulates."                                                                 |
| Cancel booking, both     | "Reason (optional)" "Up to 300 characters" **Keep booking** **Cancel booking**                                                                                                  |
| Guest reminders          | "We'll remind you {offset} before (simulated)"                                                                                                                                  |
| Simulated email          | "Simulated email" "Nothing is sent in this demo. These are the messages this booking would send."                                                                               |
| Calendars simulated      | "Calendars are simulated in this demo. Connecting adds sample events."                                                                                                          |
| No calendars             | "No calendars connected" "Connect a calendar so busy times block your booking pages."                                                                                           |
| Disconnect calendar      | "Disconnect {provider}?" "Its busy times stop blocking your booking pages."                                                                                                     |
| Added to calendar        | "Added to {calendar} (simulated)"                                                                                                                                               |
| Keep your bookings       | "Keep your bookings" "Create an account to find your bookings any time, in any browser."                                                                                        |
| Account created          | "Account created. Your bookings are in Better Booking."                                                                                                                         |
| Your bookings empty      | "No bookings yet" "Bookings you make on any booking page show here."                                                                                                            |
| Next open times          | "Next open times: {times}"                                                                                                                                                      |
| Schedule in use          | "{name} is used by {n} booking pages. Choose another schedule for them first."                                                                                                  |
| Default schedule         | "{name} is your default schedule. Make another schedule the default first."                                                                                                     |
| Schedule editor          | "Unsaved changes" "Unavailable" "Available at these times"                                                                                                                      |
| Times in a list          | "Times shown in {zone}"                                                                                                                                                         |
| Time zone select         | "Search time zones" "Your time zone" "This page's time zone"                                                                                                                    |
| Change handle            | "Change your handle to {new}?" "Your booking pages' addresses on Better Booking change, and the old ones stop working. Short links and addresses on your domains keep working." |
| No clicks                | "No clicks in this period."                                                                                                                                                     |
| Bookings from a link     | "{bookings} bookings from {clicks} clicks"                                                                                                                                      |
| No recent bookings       | "No bookings in the last 30 days."                                                                                                                                              |
| Delete page              | "Delete {title}?" "Its {n} upcoming bookings are cancelled and its {n} short links stop working." **Delete page**                                                               |
| Delete page, aside       | "Cancels its upcoming bookings, and removes its short links and documents."                                                                                                     |
| Pause, aside             | "Paused pages keep their bookings and links."                                                                                                                                   |
| Reset private link       | "Reset the private link?" "People with the old private link won't be able to open it." **Reset private link**                                                                   |
| Make private             | "Make {title} private?" with the Making a page private line, and **Make private**                                                                                               |
| Read-only page           | "You can see this page. Only its host, or an owner or admin, can change it."                                                                                                    |
| Location details         | "Shown on the confirmation and the booking screen, not on the public page."                                                                                                     |
| Editor group hints       | Reminders: "Up to three, each to the guest or the host." Guest changes: "Covers both rescheduling and cancelling."                                                              |
| Page documents           | "Documents for guests" "Guests see these on the booking page. Up to 5 files."                                                                                                   |
| Delete link              | "Delete {code}?" "The link stops working and its code is free again. Bookings it brought keep showing its code as their source, marked "(deleted)"." **Delete link**            |
| New link                 | **Create link** "No expiry" "Search codes and destinations"                                                                                                                     |
| Remove domain            | "Remove {hostname}?" **Remove domain**                                                                                                                                          |
| Remove primary domain    | "Pages and short links will use the app's address until you choose another primary domain."                                                                                     |
| Subdomain in use         | "You already have a subdomain, {hostname}. Remove it to use another."                                                                                                           |
| Domain records           | "Add these records at your DNS provider" "Found" "Not found" "{n} of 10 domains"                                                                                                |
| Needs a host             | "{Name} left, so this page isn't taking bookings. Choose a new host."                                                                                                           |
| Needs a host, fields     | "Choose a new host." "Choose a host first" "The schedule switches to the new host's default."                                                                                   |
| New page documents       | "Save the page to add documents"                                                                                                                                                |
| Not found                | "This page isn't available" (a heading, so no full stop) "The link may be wrong, turned off or private."                                                                        |
| Sign in                  | "Sign in to manage your booking pages." "Demo accounts" "{Role} at {organization}" "All three use the password {password}" "New to Better Booking?"                             |
| Dashboard numbers        | "In the next 7 days" "Taking bookings now" "All time, across {n} links" "App's address" **Manage domains**                                                                      |
| First booking page       | "Make your first booking page" "Set a title, a length and your hours, then share its address or a short link."                                                                  |
| No booking pages         | "No booking pages yet" "A booking page is what guests book: a title, a length and your open times."                                                                             |
| Sample events            | "{n} more sample events over the next four weeks."                                                                                                                              |
| Organization, members    | "Only owners and admins can change the organization."                                                                                                                           |
| Domains, members         | "Only owners and admins can add or change domains."                                                                                                                             |
| Domains, Personal        | "Domains belong to organizations. Switch to one in the account menu to add a domain."                                                                                           |
| Local DNS, after adding  | "Check again to finish"                                                                                                                                                         |
| Document prompt default  | "Add documents for this meeting"                                                                                                                                                |
| Drop area                | "Drop files here or choose files" "PDF, image or Word document, up to 10 MB"                                                                                                    |
| Booking documents, team  | "From the guest" "From your team" "No documents from the guest." "No documents from your team yet."                                                                             |
| Booking documents, guest | "Your documents" "From {organization}"                                                                                                                                          |
| Remove document          | "Remove {name}?" "Guests and your team won't see it anymore."                                                                                                                   |

### Errors

Field errors show under their field when the form is submitted. Action failures show as a toast, or as a page alert when
they need dismissing. Load failures show in place of the content with **Try again**. A failure is a page alert when the
person has to do something else before trying again: "Too many tries. Wait a minute and try again.", "We couldn't start
your booking. Reload the page and try again.", "Your files couldn't be added to the booking, so it wasn't saved. Try
again." and the refusal to turn a link on. "That time was just booked. Pick another." is an alert too, at the top of the
picker it sends the guest back to. Any other is a toast. Sign-in's wrong-password error has no field of its own, so it
shows under the password. Generic patterns: "{Field} is required", "Use up to {n} characters", "Enter a valid email
address" and "Enter a web address starting with http:// or https://".

| Case                               | Text                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Wrong sign-in                      | "That email and password don't match."                                                                          |
| Email has an account               | "There's already an account with that email. Sign in on Better Booking to see it."                              |
| Password too short                 | "Use at least 8 characters."                                                                                    |
| Slug taken                         | "You already have a page at that address. Choose another slug."                                                 |
| Slug reserved                      | "That slug is reserved. Choose another."                                                                        |
| Handle taken                       | "That handle is taken. Try another."                                                                            |
| Handle reserved                    | "That handle is reserved. Choose another."                                                                      |
| Ranges overlap                     | "These times overlap."                                                                                          |
| Range ends too early               | "End after the start time."                                                                                     |
| Override already set               | "That date already has an override."                                                                            |
| Changes closed                     | "Changes close {n} hours before the booking."                                                                   |
| Can't reschedule                   | "This booking can't be moved anymore."                                                                          |
| Code taken                         | "That code is taken. Try another."                                                                              |
| Private page link refused          | "Only its host or an owner or admin can make links to a private page."                                          |
| Turning on a link refused          | "This link can't be turned on. Only the page's host or an owner or admin can turn on a link to a private page." |
| Domain already added               | "That domain is already in use."                                                                                |
| Subdomain taken                    | "That subdomain is taken. Try another."                                                                         |
| Domain limit                       | "You can have up to 10 domains. Remove one to add another."                                                     |
| Check now too soon                 | "Checked a moment ago. Try again in a few seconds."                                                             |
| Make primary on a domain not ready | "That domain isn't ready anymore, so it can't be primary."                                                      |
| Wrong file type                    | "Use a PDF, image or Word document."                                                                            |
| File too large                     | "{name} is over 10 MB."                                                                                         |
| Too many files                     | "You can add {n} more files.", or "This booking already has 6 files." when none are left                        |
| Too many files waiting             | "You have too many files waiting. Book or remove some first."                                                   |
| Upload failed                      | "{name} didn't upload." with **Try again**                                                                      |
| Documents locked                   | "This booking's documents can't change anymore."                                                                |
| Expired draft                      | "{name} is no longer available. Remove it and add it again."                                                    |
| Required documents                 | "Add at least one document to book."                                                                            |
| Files couldn't be added            | "Your files couldn't be added to the booking, so it wasn't saved. Try again."                                   |
| Guest session failed               | "We couldn't start your booking. Reload the page and try again."                                                |
| Rate limited                       | "Too many tries. Wait a minute and try again."                                                                  |
| Any other action failure           | "That didn't work. Try again."                                                                                  |
| Any load failure                   | "This couldn't load." with **Try again**                                                                        |

## Accessibility and layout

- Every control has an accessible name. Icon buttons name their action and target, such as "Copy
  go.buildkit.gg/s/intro-linkedin" or "Remove 9:00 to 12:00 on Monday".
- Keyboard: every action is reachable with Tab, Enter and Space; dialogs trap focus and return it; the week's days and
  times are buttons; the week view's bookings are links in time order; Escape closes menus and dialogs.
- Focus moves to a sensible place after a removal, such as the list's heading.
- Status is never colour alone: each status has its word.
- Charts come with a table of the same numbers for screen readers.
- Layouts work at 390, 768 and 1280 pixels wide, in light and dark.
- **Phones**: the sidebar is a sheet opened from the header. Every table becomes a list of cards with the same facts and
  an actions menu. Asides stack below the main content. Tabs scroll sideways. Long values, such as DNS records, wrap
  with their copy button beside them. The dashboard's numbers form a 2 by 2 grid. The public booking page is one column,
  with the days as a row of buttons that scrolls sideways. The Bookings week view shows one day at a time. A phone's
  header shows only the current page's crumb.
- Lists with filters share one empty state when nothing matches: "Nothing matches these filters" with **Clear filters**.

## Out of scope

- The parts of scheduling that need outside systems: syncing with real Google or Microsoft calendars, and sending email,
  including confirmations, reminders and change notices. Their screens are designed and run on the simulation.
- Recurring bookings, group bookings, pages with several hosts, and round-robin hosts.
- Payments.
- Invitations and member management. The demo's members are seeded.
- Collecting a guest's phone number for phone calls.
- Team notes or comments on bookings: the invoices example covers comments and mentions.
- Redirects from an old handle.
- Linking a guest session to an existing account. Only creating an account moves a guest's bookings.
- Scanning documents for malware, previews of images, and files on their own outside a page or booking.
