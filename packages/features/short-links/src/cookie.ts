import { isValidCode, normalizeCode } from "./codes.js"

/** How many links that grant access the cookie remembers: the ones opened last. */
export const rememberedGrants = 20

/** The codes of links that grant access, from the request's cookie, oldest first. */
export function grantCodes(request: Request, name: string): string[] {
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
        .filter((code) => isValidCode(code))
        .map((code) => normalizeCode(code))
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
 * The `Set-Cookie` header that adds a code to the request's cookie, last, so the oldest go once it's full. It's
 * HTTP-only, `Secure` over HTTPS, and `SameSite=Lax`, so it's sent when the visitor follows the redirect. On a host
 * outside the cookie's domain, such as an organization's own domain, it's for that host alone, since browsers drop a
 * cookie for a domain that doesn't cover the host that sets it.
 */
export function grantCookie(request: Request, settings: CookieSettings, code: string): string {
  const { name, maxAge, domain } = settings
  const codes = [...grantCodes(request, name).filter((held) => held !== code), code].slice(-rememberedGrants)
  const url = new URL(request.url)
  const secure = url.protocol === "https:" ? "; Secure" : ""
  const scope = domain !== undefined && isUnder(url.hostname, domain) ? `; Domain=${domain}` : ""
  return `${name}=${codes.join(".")}; Path=/${scope}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`
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
