import { describe, expect, it } from "vite-plus/test"
import { dnsOverHttps, isRecordFound, type DnsResolver } from "./dns.js"

/** A fetch that answers DNS-over-HTTPS queries from a table, recording each query's name and type. */
function resolverWith(answers: Record<string, { Status: number; Answer?: { type: number; data: string }[] }>) {
  const queries: string[] = []
  const fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input))
    const key = `${url.searchParams.get("type")} ${url.searchParams.get("name")}`
    queries.push(key)
    expect(new Headers(init?.headers).get("accept")).toBe("application/dns-json")
    const answer = answers[key]
    return answer ? Response.json(answer) : new Response("Bad gateway", { status: 502 })
  }) as typeof globalThis.fetch
  return { dns: dnsOverHttps({ url: "https://dns.test/dns-query", fetch }), queries }
}

describe("dnsOverHttps", () => {
  it("returns the answers of the type asked for", async () => {
    const { dns, queries } = resolverWith({
      "CNAME links.acme.com": { Status: 0, Answer: [{ type: 5, data: "customers.yourapp.com." }] },
      "A links.acme.com": {
        Status: 0,
        Answer: [
          { type: 5, data: "customers.yourapp.com." },
          { type: 1, data: "192.0.2.1" }
        ]
      }
    })
    await expect(dns.resolve("links.acme.com", "CNAME")).resolves.toEqual(["customers.yourapp.com."])
    await expect(dns.resolve("links.acme.com", "A")).resolves.toEqual(["192.0.2.1"])
    expect(queries).toEqual(["CNAME links.acme.com", "A links.acme.com"])
  })

  it("joins and unquotes TXT values", async () => {
    const { dns } = resolverWith({
      "TXT _cf-custom-hostname.links.acme.com": {
        Status: 0,
        Answer: [
          { type: 16, data: '"abc" "def"' },
          { type: 16, data: '"with \\"quotes\\""' },
          { type: 16, data: "bare" }
        ]
      }
    })
    await expect(dns.resolve("_cf-custom-hostname.links.acme.com", "TXT")).resolves.toEqual([
      "abcdef",
      'with "quotes"',
      "bare"
    ])
  })

  it("has no records for a name that doesn't exist, and throws when the lookup fails", async () => {
    const { dns } = resolverWith({
      "CNAME nobody.acme.com": { Status: 3 },
      "CNAME broken.acme.com": { Status: 2 },
      "CNAME empty.acme.com": { Status: 0 }
    })
    await expect(dns.resolve("nobody.acme.com", "CNAME")).resolves.toEqual([])
    await expect(dns.resolve("empty.acme.com", "CNAME")).resolves.toEqual([])
    await expect(dns.resolve("broken.acme.com", "CNAME")).rejects.toThrow("status 2")
    await expect(dns.resolve("down.acme.com", "CNAME")).rejects.toThrow("answered 502")
  })
})

describe("isRecordFound", () => {
  const table = (records: Record<string, string[]>): DnsResolver => ({
    resolve: async (name, type) => records[`${type} ${name}`] ?? []
  })
  const routing = { type: "CNAME", name: "links.acme.com", value: "customers.yourapp.com", purpose: "routing" } as const

  it("matches a CNAME ignoring case and a trailing dot", async () => {
    await expect(isRecordFound(table({ "CNAME links.acme.com": ["Customers.YourApp.com."] }), routing)).resolves.toBe(
      true
    )
    await expect(isRecordFound(table({ "CNAME links.acme.com": ["elsewhere.net"] }), routing)).resolves.toBe(false)
  })

  it("matches flattened answers by address", async () => {
    const dns = table({
      "AAAA links.acme.com": ["2001:db8::1"],
      "AAAA customers.yourapp.com": ["2001:db8::1", "2001:db8::2"]
    })
    await expect(isRecordFound(dns, routing)).resolves.toBe(true)
    await expect(isRecordFound(table({}), routing)).resolves.toBe(false)
  })

  it("matches an A or AAAA record by address", async () => {
    const apex = { type: "A", name: "acme.com", value: "192.0.2.1", purpose: "routing" } as const
    await expect(isRecordFound(table({ "A acme.com": ["192.0.2.9", "192.0.2.1"] }), apex)).resolves.toBe(true)
    await expect(isRecordFound(table({ "A acme.com": ["192.0.2.9"] }), apex)).resolves.toBe(false)
    const six = { type: "AAAA", name: "acme.com", value: "2001:DB8::1", purpose: "routing" } as const
    await expect(isRecordFound(table({ "AAAA acme.com": ["2001:db8::1"] }), six)).resolves.toBe(true)
  })

  it("matches a TXT value exactly", async () => {
    const record = { type: "TXT", name: "_cf.links.acme.com", value: "token", purpose: "ownership" } as const
    await expect(isRecordFound(table({ "TXT _cf.links.acme.com": ["other", "token"] }), record)).resolves.toBe(true)
    await expect(isRecordFound(table({ "TXT _cf.links.acme.com": ["Token"] }), record)).resolves.toBe(false)
  })

  it("is null when a lookup fails", async () => {
    const failing: DnsResolver = {
      resolve: async () => {
        throw new Error("down")
      }
    }
    await expect(isRecordFound(failing, routing)).resolves.toBeNull()
  })
})
