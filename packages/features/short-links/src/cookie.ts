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
        .filter((code) => /^[A-Za-z0-9_-]{1,64}$/.test(code))
        .slice(-rememberedGrants)
    }
  }
  return []
}

/**
 * The `Set-Cookie` header that adds a code to the request's cookie, last, so the oldest go once it's full. It's
 * HTTP-only, `Secure` over HTTPS, and `SameSite=Lax`, so it's sent when the visitor follows the redirect.
 */
export function grantCookie(request: Request, name: string, maxAge: number, code: string): string {
  const codes = [...grantCodes(request, name).filter((held) => held !== code), code].slice(-rememberedGrants)
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : ""
  return `${name}=${codes.join(".")}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`
}
