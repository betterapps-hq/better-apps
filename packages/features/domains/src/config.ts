// The domains feature's options, resolved once when it's created.
import { dnsOverHttps, type DnsResolver } from "./dns.js"
import { defaultReservedSubdomains, isZone, normalizeLabel } from "./hostname.js"
import type { DomainsOptions, ManageArgs } from "./options.js"
import type { HostnameProvider } from "./provider.js"

/** Size limits. */
export const limits = {
  maxPerOrg: 10,
  maxPerOrgCap: 100,
  subdomainsPerOrg: 1,
  minLabelLength: 3
} as const

/** How domains are set up. */
export interface Config {
  subdomains: { zone: string; reserved: ReadonlySet<string>; minLength: number; maxPerOrg: number } | null
  provider: HostnameProvider | null
  ownershipLabel: string
  dns: DnsResolver
  canManage: (args: ManageArgs) => boolean | Promise<boolean>
  maxPerOrg: number
}

const defaultCanManage = ({ actor }: ManageArgs) => actor.roles.includes("owner") || actor.roles.includes("admin")

// An underscore label, as service records use, so it never clashes with a hostname the customer serves.
const ownershipLabelPattern = /^_[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$/

function wholeNumber(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`\`${name}\` is a whole number from ${min} to ${max}.`)
  }
  return resolved
}

export function resolve(options: DomainsOptions): Config {
  if (!options.subdomains && !options.custom) {
    throw new Error("Set up `subdomains`, `custom` or both for organizations to have domains.")
  }
  const { subdomains, custom } = options
  if (subdomains && !isZone(subdomains.zone)) {
    throw new Error(
      `"${subdomains.zone}" isn't a zone subdomains can go under. Use a lowercase name such as yourapp.com.`
    )
  }
  const ownershipLabel = custom?.ownershipLabel ?? "_verify"
  if (!ownershipLabelPattern.test(ownershipLabel)) {
    throw new Error(
      `"${ownershipLabel}" isn't a label for the ownership record. Start it with an underscore, such as _verify.`
    )
  }
  return {
    subdomains: subdomains
      ? {
          zone: subdomains.zone,
          reserved: new Set((subdomains.reserved ?? defaultReservedSubdomains).map(normalizeLabel)),
          minLength: wholeNumber(subdomains.minLength, limits.minLabelLength, 1, 63, "subdomains.minLength"),
          maxPerOrg: wholeNumber(
            subdomains.maxPerOrg,
            limits.subdomainsPerOrg,
            1,
            limits.maxPerOrgCap,
            "subdomains.maxPerOrg"
          )
        }
      : null,
    provider: custom?.provider ?? null,
    ownershipLabel,
    dns: options.dns ?? dnsOverHttps(),
    canManage: options.canManage ?? defaultCanManage,
    maxPerOrg: wholeNumber(options.maxPerOrg, limits.maxPerOrg, 1, limits.maxPerOrgCap, "maxPerOrg")
  }
}
