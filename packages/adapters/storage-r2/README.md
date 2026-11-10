# @better-apps/storage-r2

Cloudflare R2 storage for [`@better-apps/attachments`](../../features/attachments/README.md). It wraps an R2 bucket
binding, such as Void's `void/storage` or a Worker's `env.FILES`, and can sign uploads that go straight from the browser
to R2.

## Usage

```ts
import { attachments } from "@better-apps/attachments"
import { r2Storage } from "@better-apps/storage-r2"

attachments({
  storage: r2Storage({ bucket: env.FILES }),
  subjects: { invoice: {} }
})
```

Without `s3`, uploads go through the app's server, up to the Worker's request size limit, 100 MB on the Free and Pro
plans. The adapter streams them into R2 through a `FixedLengthStream`, so R2 knows their length and a body that isn't
the declared size fails.

## Direct uploads

With R2's S3 API credentials, the adapter signs each upload, so the bytes skip the Worker and can be up to R2's single
upload limit, about 5 GB:

```ts
r2Storage({
  bucket: env.FILES,
  s3: {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucketName: "files"
  }
})
```

- Create an R2 API token with object read and write on the one bucket, and keep its keys in secrets.
- Each URL is a SigV4 presigned `PUT` to `https://{accountId}.r2.cloudflarestorage.com/{bucketName}/{key}`. It signs
  `content-type` and `content-length`, so R2 refuses any other type or size, and lasts as long as the feature's
  `uploadTtl`.
- Give the bucket a CORS rule that allows `PUT` from the app's origin with the `content-type` header. Browsers send
  `content-length` themselves.
- For a bucket in a jurisdiction, set `endpoint`, such as `https://{accountId}.eu.r2.cloudflarestorage.com`.
- Presigned URLs work only on the S3 endpoint, not on a bucket's custom domain.

The signing is about a hundred lines of Web Crypto, checked against AWS's published example. `presign` is exported for
other requests to the S3 API.

## The binding

`r2Storage` needs only `put`, `get`, `head` and `delete` of the binding, typed as `R2BucketLike`, so tests can pass an
object of their own. Ranges and `etagMatches` go to R2 as they are, and deletes go 1000 keys a call.
