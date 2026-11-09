// Hostname and subdomain label rules, as pure functions so the feature, the client and tests share one copy.

/**
 * Labels nobody can take as a subdomain: names an app is likely to want for itself, or that suggest an official page.
 * Spread it into `subdomains.reserved` to add to it.
 */
export const defaultReservedSubdomains: readonly string[] = [
  "www",
  "api",
  "app",
  "apps",
  "admin",
  "administrator",
  "auth",
  "login",
  "logout",
  "signin",
  "signup",
  "sso",
  "oauth",
  "account",
  "accounts",
  "billing",
  "pay",
  "payments",
  "checkout",
  "dashboard",
  "console",
  "portal",
  "docs",
  "help",
  "support",
  "status",
  "blog",
  "news",
  "mail",
  "email",
  "smtp",
  "imap",
  "pop",
  "mx",
  "ftp",
  "ns",
  "ns1",
  "ns2",
  "dns",
  "cdn",
  "static",
  "assets",
  "media",
  "files",
  "img",
  "images",
  "dev",
  "staging",
  "test",
  "beta",
  "demo",
  "preview",
  "internal",
  "root",
  "system",
  "security",
  "settings",
  "customers",
  "proxy-fallback"
]

/** The longest DNS label and hostname. */
export const maxLabelLength = 63
export const maxHostnameLength = 253

const labelPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const reservedSuffixes = [".localhost", ".local", ".test", ".example", ".invalid", ".internal"]

/** Why a label or hostname can't be used, as a sentence to show, or `null` when it can. */
export type HostnameProblem = string | null

/** Whether a string is one valid DNS label: letters, digits and inner hyphens, at most 63 characters. */
export function isLabel(label: string): boolean {
  return label.length <= maxLabelLength && labelPattern.test(label)
}

/** Trims and lowercases a subdomain label as a person typed it. */
export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase()
}

/** The rules a subdomain label is checked against. */
export interface LabelRules {
  minLength: number
  reserved: ReadonlySet<string>
}

/** Why a normalized subdomain label can't be used, or `null` when it can. */
export function labelProblem(label: string, rules: LabelRules): HostnameProblem {
  if (label.length < rules.minLength || label.length > maxLabelLength) {
    return `Use ${rules.minLength} to ${maxLabelLength} characters.`
  }
  if (!/^[a-z0-9-]+$/.test(label)) {
    return "Use only letters, numbers and hyphens."
  }
  if (label.startsWith("-") || label.endsWith("-") || label.includes("--")) {
    return "Don't start or end with a hyphen, or use two in a row."
  }
  if (rules.reserved.has(label)) {
    return "That subdomain is reserved."
  }
  return null
}

/**
 * Turns what a person typed into a hostname: trimmed, lowercased, in punycode, without a trailing dot. A URL is
 * accepted, so `HTTPS://Links.Acme.com/` becomes `links.acme.com`. Returns `null` for anything that has no hostname
 * or has more than one, such as a path, a port or credentials.
 */
export function normalizeHostname(input: string, { allowPort = false }: { allowPort?: boolean } = {}): string | null {
  const text = input.trim()
  if (text.length === 0 || /\s/.test(text)) {
    return null
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
  let url: URL
  try {
    url = new URL(hasScheme ? text : `http://${text}`)
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash || (url.port && !allowPort)) {
    return null
  }
  if (url.pathname !== "/") {
    return null
  }
  const hostname = url.hostname.replace(/\.$/, "")
  return hostname.length > 0 ? hostname : null
}

/** Whether a hostname is the zone or under it. */
export function isWithin(hostname: string, zone: string): boolean {
  return hostname === zone || hostname.endsWith(`.${zone}`)
}

/** Why a normalized hostname can't be a custom domain, or `null` when it can. */
export function customHostnameProblem(hostname: string, subdomainZone: string | null): HostnameProblem {
  if (hostname.length > maxHostnameLength) {
    return "That domain is too long."
  }
  const labels = hostname.split(".")
  if (hostname.startsWith("[") || /^\d+$/.test(labels.at(-1) as string)) {
    return "Enter a domain name, not an IP address."
  }
  if (labels.length < 2 || !labels.every(isLabel)) {
    return "Enter a domain such as links.example.com."
  }
  if (hostname === "localhost" || reservedSuffixes.some((suffix) => hostname.endsWith(suffix))) {
    return "That domain can't be reached from the internet."
  }
  if (hostname === subdomainZone) {
    return "That's this app's own domain."
  }
  if (subdomainZone !== null && isWithin(hostname, subdomainZone)) {
    return `That's a subdomain of ${subdomainZone}. Add it as a subdomain instead.`
  }
  return null
}

/**
 * Whether a string is a valid zone for subdomains, such as `yourapp.com`, or `localhost` for local development, where
 * browsers send `acme.localhost` to this machine.
 */
export function isZone(zone: string): boolean {
  const labels = zone.split(".")
  return (
    normalizeHostname(zone) === zone &&
    zone.length <= maxHostnameLength &&
    labels.every(isLabel) &&
    !/^\d+$/.test(labels.at(-1) as string)
  )
}
