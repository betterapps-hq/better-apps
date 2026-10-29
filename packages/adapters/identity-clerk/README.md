# @better-apps/clerk

The [Clerk](https://clerk.com) identity adapter for [Better Apps](../better-apps/README.md). Features read the signed-in
user, their organization and role, and other users' names from Clerk. It only reads the standard `Request`, so it works
on any framework and on Cloudflare Workers.

## Usage

```ts
import { clerkIdentity } from "@better-apps/clerk"
import { createBetterApps } from "better-apps"

export const app = createBetterApps({
  database,
  identity: clerkIdentity({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    authorizedParties: ["https://app.example.com"]
  }),
  features: [comments]
})
```

To share a client, or to set Clerk options such as `jwtKey`, pass `clerkClient` instead of the keys:

```ts
import { createClerkClient } from "@clerk/backend"

const clerkClient = createClerkClient({ secretKey, publishableKey, jwtKey })
const identity = clerkIdentity({ clerkClient, authorizedParties: ["https://app.example.com"] })
```

Sign-in, sessions and the UI stay with Clerk's own packages.

## Behavior

- `getActor` checks the request's session token with Clerk's `authenticateRequest`, from the session cookie or an
  `Authorization: Bearer` header. Signed-out requests, invalid or expired tokens, tokens from origins outside
  `authorizedParties` and sessions with tasks left to finish act as nobody.
- The actor is in the session's active organization with its role. Clerk names organization roles with an `org:` prefix,
  which the adapter drops, so `org:admin` becomes `admin`, as Better Auth and WorkOS name it. Without an active
  organization, the actor is outside any organization.
- `getActorsFor` reads the users' memberships in the organization, 100 users per call, Clerk's limit, and leaves out
  users who aren't members. An organization that no longer exists has no members. With no organization, it builds an
  actor for every user that exists.
- `getUsers` reads users 100 per call. A user's name is their first and last name, or their username, and their email is
  the primary one.
- `searchUsers` uses Clerk's search among the organization's members, which also matches usernames and phone numbers.
- Outside an organization, `searchUsers` searches every user only when `searchOutsideOrgs` is true, for apps without
  organizations. It's false by default, so nobody outside an organization can look through every user's name and email.
- At most 5 calls run at a time. Errors from Clerk, such as rate limits, are thrown.
