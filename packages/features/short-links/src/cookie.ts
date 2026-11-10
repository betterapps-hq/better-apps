import { isValidCode, normalizeCode } from "./codes.js"

/** How many links that grant access the cookie remembers: the ones opened last. */
export const rememberedGrants = 20

/** The longest cookie value, so the whole `Set-Cookie` stays under browsers' 4,096 bytes. */
const longestValue = 3800

/** A link the grant cookie remembers: its code, and the scope it's unique in, `""` for the app's. */
export interface GrantEntry {
  code: string
  scope: string
}

/** A key that's the same only for the same code in the same scope. Codes have no spaces. */
export const grantKey = ({ code, scope }: GrantEntry): string => `${code} ${scope}`

/** A scope in base64url, so any organization id fits a cookie and leaves `.` and `~` to the cookie's own use. */
function encodeScope(scope: string): string {
  let binary = ""
  for (const byte of new TextEncoder().encode(scope)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** A scope from base64url, or `null` for one that isn't. */
function decodeScope(encoded: string): string | null {
  if (!/^[\w-]+$/.test(encoded)) {
    return null
  }
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
  } catch {
    return null
  }
}

/** A cookie entry: the code for a link in the app's scope, or `code~scope` for one in an organization's. */
function writeEntry({ code, scope }: GrantEntry): string {
  return scope === "" ? code : `${code}~${encodeScope(scope)}`
}

function readEntry(entry: string): GrantEntry | null {
  const split = entry.indexOf("~")
  const code = split === -1 ? entry : entry.slice(0, split)
  const scope = split === -1 ? "" : decodeScope(entry.slice(split + 1))
  return scope !== null && isValidCode(code) ? { code: normalizeCode(code), scope } : null
}

/** The links that grant access in the request's cookie, oldest first. */
export function grantEntries(request: Request, name: string): GrantEntry[] {
  const header = request.headers.get("cookie")
  if (!header) {
    return []
  }
  for (const pair of header.split(";")) {
    const split = pair.indexOf("=")
    if (split !== -1 && pair.slice(0, split).trim() === name) {
      return pair
        .slice(split + 1)
        .trim()
        .split(".")
        .flatMap((entry) => readEntry(entry) ?? [])
        .slice(-rememberedGrants)
    }
  }
  return []
}

/** Where the grant cookie is set and how long it lasts. */
export interface CookieSettings {
  name: string
  maxAge: number
  /** The `Domain` attribute, so hosts under it share the cookie, or `undefined` for the link's host only. */
  domain: string | undefined
}

/** Whether a host is the cookie's domain or under it, so it can set a cookie for that domain. */
export function isUnder(host: string, domain: string): boolean {
  const bare = domain.replace(/^\./, "").toLowerCase()
  return host === bare || host.endsWith(`.${bare}`)
}

/**
 * The `Set-Cookie` header that adds a link to the request's cookie, last, so the oldest go once it's full. It's
 * HTTP-only, `Secure` over HTTPS, and `SameSite=Lax`, so it's sent when the visitor follows the redirect. On a host
 * outside the cookie's domain, such as an organization's own domain, it's for that host alone, since browsers drop a
 * cookie for a domain that doesn't cover the host that sets it.
 */
export function grantCookie(request: Request, settings: CookieSettings, link: GrantEntry): string {
  const { name, maxAge, domain } = settings
  const key = grantKey(link)
  const entries = [...grantEntries(request, name).filter((held) => grantKey(held) !== key), link]
    .slice(-rememberedGrants)
    .map(writeEntry)
  // The oldest go first when long scopes would make the cookie too long for browsers to keep.
  while (entries.length > 1 && entries.join(".").length > longestValue) {
    entries.shift()
  }
  const url = new URL(request.url)
  const secure = url.protocol === "https:" ? "; Secure" : ""
  const scope = domain !== undefined && isUnder(url.hostname, domain) ? `; Domain=${domain}` : ""
  return `${name}=${entries.join(".")}; Path=/${scope}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`
}

/**
 * Whether a link's target gets the cookie the link sets: it's on the link's host, or both are under the cookie's
 * domain.
 */
export function reachesHost(link: string, target: string, domain: string | undefined): boolean {
  const from = new URL(link).hostname
  const to = new URL(target).hostname
  return from === to || (domain !== undefined && isUnder(from, domain) && isUnder(to, domain))
}
