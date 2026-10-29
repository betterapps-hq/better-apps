# @better-apps/workos

The [WorkOS](https://workos.com) identity adapter for [Better Apps](../better-apps/README.md). Features read the
signed-in user, their organization and roles, and other users' names from WorkOS AuthKit. It only reads the standard
`Request`, so it works on any framework and on Cloudflare Workers.

## Usage

```ts
import { workosIdentity } from "@better-apps/workos"
import { createBetterApps } from "better-apps"

export const app = createBetterApps({
  database,
  identity: workosIdentity({
    apiKey: env.WORKOS_API_KEY,
    clientId: env.WORKOS_CLIENT_ID,
    cookiePassword: env.WORKOS_COOKIE_PASSWORD
  }),
  features: [comments]
})
```

To share a client, pass `workos`, from `new WorkOS(apiKey, { clientId })`, instead of the keys. It needs the client id
to check sessions. Sign-in, sessions and the UI stay with AuthKit.

## Behavior

- `getActor` reads AuthKit's sealed session from the `wos-session` cookie, or the one `cookieName` names, unseals it
  with `cookiePassword` and checks its access token. A missing or invalid cookie, or an expired access token, acts as
  nobody.
- It never refreshes the session, since the new cookie couldn't reach the browser and a refresh token works only once.
  Refresh it with AuthKit's middleware on the routes that serve Better Apps.
- The actor is in the session's organization with its roles. Without an organization, the actor is outside any
  organization.
- `getActorsFor` asks for each user's active membership in the organization, since WorkOS can't look up several at once,
  and leaves out users who aren't members. An organization that no longer exists has no members. With no organization,
  it builds an actor for every user that exists.
- `getUsers` asks for each user and remembers the answer for a minute, users that don't exist too. It remembers up to
  1,000 users and forgets the least recently used first. A user's name is their name, or their first and last name.
- WorkOS has no text search, so `searchUsers` lists the organization's users 100 at a time and keeps those whose name or
  email matches, ignoring case, until it has enough. It reads at most the first 1,000 users, so in a larger organization
  people further down the list aren't suggested.
- Outside an organization, `searchUsers` searches every user only when `searchOutsideOrgs` is true, for apps without
  organizations. It's false by default, so nobody outside an organization can look through every user's name and email.
- At most 10 calls run at a time. Errors from WorkOS, such as rate limits, are thrown.
