// AWS Signature Version 4 query signing on Web Crypto, for presigned URLs to R2's S3 API. Only what presigning needs:
// the request is described by its method, URL and the headers that must match, and the payload is never signed.

const encoder = new TextEncoder()

/** What a presigned URL is signed with. */
export interface Credentials {
  accessKeyId: string
  secretAccessKey: string
}

/** A request to presign. */
export interface PresignInput {
  method: string
  /** The URL, without query parameters. */
  url: string
  /** Headers the request must send exactly, besides `host`, which is always signed. */
  headers?: Readonly<Record<string, string>> | undefined
  credentials: Credentials
  /** `auto` for R2. */
  region: string
  service: string
  /** How long the URL works, in seconds, up to a week. */
  expiresIn: number
  /** When it's signed. The default is now. */
  now?: Date | undefined
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)))
}

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, value: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return crypto.subtle.sign("HMAC", imported, encoder.encode(value))
}

/** Percent-encodes everything but the characters SigV4 leaves alone: letters, digits, `-`, `_`, `.` and `~`. */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** `20130524T000000Z` from a date. */
function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "")
}

/** Signs a request into a URL that carries its signature in the query, as S3 presigned URLs do. */
export async function presign(input: PresignInput): Promise<string> {
  if (!Number.isInteger(input.expiresIn) || input.expiresIn < 1 || input.expiresIn > 604_800) {
    throw new Error("A presigned URL lasts from 1 second to a week.")
  }
  const url = new URL(input.url)
  const datetime = amzDate(input.now ?? new Date())
  const date = datetime.slice(0, 8)
  const scope = `${date}/${input.region}/${input.service}/aws4_request`
  const headers = new Map<string, string>([["host", url.host]])
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    headers.set(name.toLowerCase(), value.trim().replace(/\s+/g, " "))
  }
  const names = [...headers.keys()].sort()
  const signedHeaders = names.join(";")
  const query = new Map<string, string>([
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${input.credentials.accessKeyId}/${scope}`],
    ["X-Amz-Date", datetime],
    ["X-Amz-Expires", String(input.expiresIn)],
    ["X-Amz-SignedHeaders", signedHeaders]
  ])
  const canonicalQuery = [...query]
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)] as const)
    // Parameter names are unique, so no two compare equal.
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join("&")
  // The path is already encoded by `URL`; its segments are decoded and encoded again the strict way.
  const canonicalPath = url.pathname
    .split("/")
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join("/")
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath,
    canonicalQuery,
    names.map((name) => `${name}:${headers.get(name)}\n`).join(""),
    signedHeaders,
    "UNSIGNED-PAYLOAD"
  ].join("\n")
  const stringToSign = ["AWS4-HMAC-SHA256", datetime, scope, await sha256(canonicalRequest)].join("\n")
  const dateKey = await hmac(encoder.encode(`AWS4${input.credentials.secretAccessKey}`), date)
  const regionKey = await hmac(dateKey, input.region)
  const serviceKey = await hmac(regionKey, input.service)
  const signingKey = await hmac(serviceKey, "aws4_request")
  const signature = hex(await hmac(signingKey, stringToSign))
  return `${url.origin}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`
}
