import { describe, expect, it } from "vite-plus/test"
import { customHostnameProblem, isZone, labelProblem, normalizeHostname } from "./hostname.js"

describe("normalizeHostname", () => {
  it("lowercases, drops a trailing dot and accepts a URL", () => {
    expect(normalizeHostname(" Links.Acme.COM. ")).toBe("links.acme.com")
    expect(normalizeHostname("HTTPS://Links.Acme.com/")).toBe("links.acme.com")
    expect(normalizeHostname("links.acme.com/")).toBe("links.acme.com")
  })

  it("writes international names in punycode", () => {
    expect(normalizeHostname("bücher.example")).toBe("xn--bcher-kva.example")
  })

  it("refuses paths, ports, credentials, queries and spaces", () => {
    const refused = [
      "",
      "links acme.com",
      "links.acme.com/path",
      "links.acme.com:8080",
      "user@links.acme.com",
      "links.acme.com?x=1",
      "links.acme.com#top",
      "http://"
    ]
    expect(refused.filter((input) => normalizeHostname(input) !== null)).toEqual([])
  })

  it("keeps a port out of the hostname when it's allowed", () => {
    expect(normalizeHostname("acme.yourapp.com:4190", { allowPort: true })).toBe("acme.yourapp.com")
  })
})

describe("labelProblem", () => {
  const rules = { minLength: 3, reserved: new Set(["www"]) }

  it("explains what's wrong with a label", () => {
    expect(labelProblem("ab", rules)).toBe("Use 3 to 63 characters.")
    expect(labelProblem("ac_me", rules)).toBe("Use only letters, numbers and hyphens.")
    expect(labelProblem("acme-", rules)).toBe("Don't start or end with a hyphen, or use two in a row.")
    expect(labelProblem("www", rules)).toBe("That subdomain is reserved.")
    expect(labelProblem("acme-co", rules)).toBeNull()
  })
})

describe("customHostnameProblem", () => {
  it("explains what's wrong with a hostname", () => {
    expect(customHostnameProblem(`${"a".repeat(250)}.com`, null)).toBe("That domain is too long.")
    expect(customHostnameProblem("10.0.0.1", null)).toBe("Enter a domain name, not an IP address.")
    expect(customHostnameProblem("[::1]", null)).toBe("Enter a domain name, not an IP address.")
    expect(customHostnameProblem("links", null)).toBe("Enter a domain such as links.example.com.")
    expect(customHostnameProblem("-x.acme.com", null)).toBe("Enter a domain such as links.example.com.")
    expect(customHostnameProblem("printer.local", null)).toBe("That domain can't be reached from the internet.")
    expect(customHostnameProblem("acme.yourapp.com", "yourapp.com")).toBe(
      "That's a subdomain of yourapp.com. Add it as a subdomain instead."
    )
    expect(customHostnameProblem("links.acme.com", "yourapp.com")).toBeNull()
  })
})

describe("isZone", () => {
  it("accepts lowercase hostnames, localhost among them", () => {
    expect(["yourapp.com", "localhost", "apps.example.co.uk"].every(isZone)).toBe(true)
    expect(["YourApp.com", "your app.com", "10.0.0.1", "yourapp.com."].some(isZone)).toBe(false)
  })
})
