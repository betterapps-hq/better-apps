// Looking up the records a customer added, through a resolver the app can swap, such as for tests.
import type { DnsRecord } from "./provider.js"

/** The record types domains looks up. */
export type DnsRecordType = "CNAME" | "TXT" | "A" | "AAAA"

/** Looks up DNS records. A name that doesn't exist has none. A lookup that fails throws. */
export interface DnsResolver {
  /** The values of a name's records of one type: CNAME targets and addresses as written, TXT values unquoted. */
  resolve(name: string, type: DnsRecordType): Promise<string[]>
}

const typeNumbers: Readonly<Record<DnsRecordType, number>> = { A: 1, CNAME: 5, TXT: 16, AAAA: 28 }

/** How long one lookup may take. */
const lookupTimeoutMs = 5000

/** What `dnsOverHttps` takes. */
export interface DnsOverHttpsOptions {
  /** The resolver's JSON API. Cloudflare's, `https://cloudflare-dns.com/dns-query`, by default. */
  url?: string | undefined
  fetch?: typeof fetch | undefined
}

interface DohAnswer {
  type: number
  data: string
}

/** Joins a TXT record's quoted strings, such as `"abc" "def"`, into one value. */
function unquoteTxt(data: string): string {
  const parts = data.match(/"((?:[^"\\]|\\.)*)"/g)
  if (!parts) {
    return data
  }
  return parts.map((part) => part.slice(1, -1).replace(/\\(.)/g, "$1")).join("")
}

/**
 * Looks up records with DNS over HTTPS, using the JSON API Cloudflare's and Google's resolvers offer, so it runs
 * anywhere `fetch` does, such as a Worker.
 */
export function dnsOverHttps(options: DnsOverHttpsOptions = {}): DnsResolver {
  const url = options.url ?? "https://cloudflare-dns.com/dns-query"
  return {
    async resolve(name, type) {
      const send = options.fetch ?? fetch
      const query = new URL(url)
      query.searchParams.set("name", name)
      query.searchParams.set("type", type)
      const response = await send(query, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(lookupTimeoutMs)
      })
      if (!response.ok) {
        throw new Error(`The DNS resolver answered ${response.status}.`)
      }
      const body = (await response.json()) as { Status?: number; Answer?: DohAnswer[] }
      // 3 is NXDOMAIN: the name doesn't exist, so it has no records.
      if (body.Status === 3) {
        return []
      }
      if (body.Status !== 0) {
        throw new Error(`The DNS lookup of ${name} failed with status ${body.Status}.`)
      }
      return (body.Answer ?? [])
        .filter((answer) => answer.type === typeNumbers[type])
        .map((answer) => (type === "TXT" ? unquoteTxt(answer.data) : answer.data))
    }
  }
}

const sameName = (a: string, b: string) => a.toLowerCase().replace(/\.$/, "") === b.toLowerCase().replace(/\.$/, "")

// IPv6 addresses compare without regard to case; resolvers answer them in their shortest form.
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Whether a customer added a record: a TXT record when any of the name's values is the token; an A or AAAA record when
 * the name has the address; a CNAME when the name points at the target, or, where the customer's DNS flattens CNAMEs,
 * when the name's addresses include one of the target's. `null` when a lookup failed.
 */
export async function isRecordFound(dns: DnsResolver, record: DnsRecord): Promise<boolean | null> {
  try {
    if (record.type === "TXT") {
      return (await dns.resolve(record.name, "TXT")).some((value) => value === record.value)
    }
    if (record.type !== "CNAME") {
      return (await dns.resolve(record.name, record.type)).some((address) => sameAddress(address, record.value))
    }
    const cnames = await dns.resolve(record.name, "CNAME")
    if (cnames.some((target) => sameName(target, record.value))) {
      return true
    }
    if (cnames.length > 0) {
      return false
    }
    for (const type of ["A", "AAAA"] as const) {
      const [own, target] = await Promise.all([dns.resolve(record.name, type), dns.resolve(record.value, type)])
      if (own.some((address) => target.includes(address))) {
        return true
      }
    }
    return false
  } catch {
    return null
  }
}
