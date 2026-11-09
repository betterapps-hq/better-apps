# @better-apps/hostnames-cloudflare

The [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/) provider for
[`@better-apps/domains`](../../features/domains/README.md). Each custom domain becomes a custom hostname on the app's
SaaS zone, and Cloudflare validates it and issues its certificate.

## Usage

```ts
import { domains } from "@better-apps/domains"
import { cloudflareHostnames } from "@better-apps/hostnames-cloudflare"

domains({
  custom: {
    provider: cloudflareHostnames({
      apiToken: env.CLOUDFLARE_API_TOKEN,
      zoneId: env.CLOUDFLARE_ZONE_ID,
      zone: "yourapp.com",
      target: "customers.yourapp.com"
    })
  }
})
```

Install the [`cloudflare`](https://www.npmjs.com/package/cloudflare) SDK alongside it. Set up the zone once first:
Cloudflare for SaaS, the fallback origin, the CNAME target, the `*/*` Workers route and the API token, as the
[domains spec](../../features/domains/docs/spec.md#one-time-cloudflare-setup) describes. The token needs **SSL and
Certificates: Edit** on the zone. The Worker and the zone must be in the same Cloudflare account.

## Behavior

- `routing` asks for a CNAME from the hostname to `target`. `zone` is the SaaS zone's name, which `target` is in;
  domains refuses it and hostnames in it as custom domains.
- `create` adds a custom hostname with `ssl: { method: "http", type: "dv" }`, so Cloudflare validates the hostname and
  its certificate once the CNAME is in place. Pass `certificateValidation: "txt"` to validate certificates by TXT record
  instead. A hostname the zone already has is looked up and returned, so a repeated `create` is safe, and an
  organization that takes a hostname over from another gets the same custom hostname.
- The records it returns besides the CNAME are Cloudflare's `_cf-custom-hostname` TXT, as `prevalidation`, until the
  hostname is active, which lets it verify before traffic moves, then any certificate TXT records until the certificate
  is active.
- Cloudflare's hostname statuses map to `active` (`active`, `active_redeploying` and the test ones), `blocked`
  (`blocked`, `pending_blocked`, `test_blocked`, `test_failed`), `moved` (`moved`, `deleted`, `pending_deletion`) and
  `pending` for the rest. Certificates are `active` when `active` or `pending_expiration`, `stalled` when timed out,
  since a renewal that timed out leaves the current certificate serving, `failed` when expired, deleted, inactive or
  deactivating, and `pending` otherwise. `errors` joins `verification_errors` and the certificate's `validation_errors`.
- `refresh` edits the hostname with the same `ssl`, which restarts Cloudflare's validation.
- `get` returns `null` and `remove` succeeds for a hostname Cloudflare doesn't have.
- Connection failures, rate limits and 5xx answers throw `UNAVAILABLE`; Cloudflare's quota error, 1405, throws
  `QUOTA_EXCEEDED`; a hostname Cloudflare refuses with 400, 409 or 422 throws `INVALID_HOSTNAME` with its message. Other
  errors, such as a token without permission, are thrown as the SDK's `APIError`, so they reach the app's `onError`.
- Pass `client` instead of `apiToken` to share a `Cloudflare` client. The SDK retries rate limits and server errors
  twice by default.
