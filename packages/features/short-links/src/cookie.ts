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

/**
 * The `Set-Cookie` header that adds a code to the request's cookie, last, so the oldest go once it's full. It's
 * HTTP-only, `Secure` over HTTPS, and `SameSite=Lax`, so it's sent when the visitor follows the redirect.
 */
export function grantCookie(request: Request, settings: CookieSettings, code: string): string {
  const { name, maxAge, domain } = settings
  const codes = [...grantCodes(request, name).filter((held) => held !== code), code].slice(-rememberedGrants)
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : ""
  const scope = domain === undefined ? "" : `; Domain=${domain}`
  return `${name}=${codes.join(".")}; Path=/${scope}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`
}

/**
 * Whether a link's target gets the cookie the link sets: it's on the link's host, or both are under the cookie's
 * domain. Browsers drop a cookie whose domain doesn't cover the host that sets it.
 */
export function reachesHost(link: string, target: string, domain: string | undefined): boolean {
  const from = new URL(link).hostname
  const to = new URL(target).hostname
  if (domain === undefined) {
    return from === to
  }
  const bare = domain.replace(/^\./, "").toLowerCase()
  const under = (host: string) => host === bare || host.endsWith(`.${bare}`)
  return under(from) && under(to)
}
