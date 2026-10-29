# @better-apps/better-auth

The [Better Auth](https://www.better-auth.com) identity adapter for [Better Apps](../better-apps/README.md). Features
read the signed-in user, their organization and roles, and other users' names from your app's Better Auth instance. It
only reads the standard `Request`, so it works on any framework and on Cloudflare Workers.

## Usage

```ts
import { betterAuthIdentity } from "@better-apps/better-auth"
import { createBetterApps } from "better-apps"
import { auth } from "./auth"

export const app = createBetterApps({
  database,
  identity: betterAuthIdentity(auth),
  features: [comments]
})
```

Pass the instance `betterAuth()` returns. Sign-in, sessions and the UI stay with Better Auth.

## Behavior

- `getActor` reads the request's session with `auth.api.getSession`, so it accepts what Better Auth accepts, such as the
  session cookie. A missing, invalid or expired session acts as nobody. It never refreshes the session, since the new
  cookie couldn't reach the browser from here. Better Auth's client keeps it fresh.
- With the organization plugin, the actor is in the session's active organization, with the member's roles. Better Auth
  stores several roles as one string, such as `admin,owner`, and they become separate roles. Without an active
  organization, or after the user leaves it, the actor is outside any organization, as every actor is without the
  plugin.
- `getActorsFor` reads the users and their `member` rows with one query each, and leaves out users who aren't members.
  With no organization, it builds an actor for every user that exists.
- `getUsers` reads names, emails and images from the `user` table.
- `searchUsers` matches names and emails, ignoring case, among the organization's members. In an organization of up to
  1,000 members it reads them 90 at a time until it has enough. In a larger one it asks the database for users whose
  name or email matches and keeps the members, reading at most 1,000 users, so a query that matches more than that can
  miss members until it's longer.
- Outside an organization, `searchUsers` searches every user only when `searchOutsideOrgs` is true. That's the default
  without the organization plugin, for apps without organizations. With the plugin it's false, so nobody outside an
  organization can look through every user's name and email.
- `userTable` is Better Auth's `user` model, or the `modelName` you gave it, so feature tables can reference users with
  real foreign keys.
- Queries go through Better Auth's own database adapter, so they work on any database Better Auth does, with your model
  and field names. They name at most 90 users each, under Cloudflare D1's limit of 100 bound parameters.
