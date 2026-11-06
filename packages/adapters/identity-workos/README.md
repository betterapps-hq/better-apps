# @better-apps/identity-workos

The [WorkOS](https://workos.com) identity adapter for [Better Apps](../../core/better-apps/README.md). Features read the
signed-in user, their organization and roles, and other users' names from WorkOS AuthKit. The user comes from AuthKit's
session cookie in a browser, or from a WorkOS access token sent as a bearer token by a desktop or mobile app. It only
reads the standard `Request`, so it works on any framework and on Cloudflare Workers.

## Usage

```ts
import { workosIdentity } from "@better-apps/identity-workos"
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
to check sessions and tokens. Sign-in, sessions and the UI stay with AuthKit.

An app without cookies, such as a desktop app that signs in with PKCE, sends its access token on each request:

```http
Authorization: Bearer <access token>
```

## Behavior

- `getActor` reads AuthKit's sealed session from the `wos-session` cookie, or the one `cookieName` names, unseals it
  with `cookiePassword` and checks its access token. A missing or invalid cookie, or an expired access token, acts as
  nobody.
- Without that cookie, `getActor` reads a WorkOS access token from the `Authorization: Bearer` header. It checks the
  token's signature against WorkOS's keys for the client ID, at `https://api.workos.com/sso/jwks/<client_id>`, and its
  expiry and issuer, and that WorkOS issued it to a user rather than to an agent or widget. An expired, forged or
  malformed token, or one from another issuer, acts as nobody. A request with both reads only the cookie, so an invalid
  cookie acts as nobody even with a valid token.
- The token's issuer must be the one WorkOS publishes in the client's OpenID configuration, at
  `https://api.workos.com/user_management/<client_id>/.well-known/openid-configuration`. It can name another of the
  environment's clients, not yours. The adapter reads it once, on the first token, and tries again on the next request
  if that fails. Pass `issuer`, one issuer or a list, to check against those instead, such as when the environment has a
  custom authentication domain.
- The WorkOS SDK keeps WorkOS's keys for 10 minutes and fetches them again sooner when a token names a key it doesn't
  have, at most once every 5 minutes. A failure to read the keys or the issuer is thrown, not treated as a bad token.
- It never refreshes the session, since the new cookie couldn't reach the browser and a refresh token works only once.
  Refresh it with AuthKit's middleware on the routes that serve Better Apps. An app that sends a bearer token refreshes
  its own token.
- The actor is in the session's or token's organization with its roles. Without an organization, the actor is outside
  any organization.
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
