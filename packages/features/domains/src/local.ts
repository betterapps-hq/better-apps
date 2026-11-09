// A provider and DNS kept in memory, for tests and local development.
import { isRecordFound, type DnsRecordType, type DnsResolver } from "./dns.js"
import type { CertificateStatus, DnsRecord, HostnameProvider, ProviderHostname } from "./provider.js"

/** What `localHostnames` takes. */
export interface LocalHostnamesOptions {
  /** The CNAME target customers point at. `customers.localhost` by default. */
  target?: string | undefined
  /** The app's own zone, which serves the target. The target without its first label by default. */
  zone?: string | undefined
}

/** A provider in memory, with its own DNS and controls for tests. */
export interface LocalHostnames extends HostnameProvider {
  /** The app's own zone, which serves the target. */
  readonly zone: string
  /** The CNAME target customers point at. */
  readonly target: string
  /** The local DNS, holding only the records `publish` added, as a customer would at their DNS provider. */
  dns: DnsResolver & {
    /** Adds a record, such as a customer's CNAME. */
    publish(name: string, type: DnsRecordType, value: string): void
    /** Removes every record of a name and type. */
    unpublish(name: string, type: DnsRecordType): void
  }
  /** The hostnames the provider has, by id. */
  readonly hostnames: ReadonlyMap<string, ProviderHostname>
  /** Makes a hostname blocked, as a provider does with one flagged for abuse. */
  block(hostname: string): void
  /**
   * Sets a served hostname's certificate. `pending` holds until it's set again, and `stalled` or `failed` until
   * `refresh` asks for the certificate again. `active` issues it.
   */
  holdCertificate(hostname: string, status: CertificateStatus): void
  /** Makes the next call of a method throw this error, once. */
  failNext(method: "create" | "get" | "refresh" | "remove", error: Error): void
}

/**
 * A `hostnames` provider kept in memory, for tests and local development, never production. Like a real provider, a
 * hostname it registers is `active` once its DNS points at the target, or holds its prevalidation record, and `moved`
 * once an active hostname stops pointing at it, until `refresh`. Nothing reaches its DNS but what `publish` adds.
 */
export function localHostnames(options: LocalHostnamesOptions = {}): LocalHostnames {
  const target = options.target ?? "customers.localhost"
  const zone = options.zone ?? (target.split(".").slice(1).join(".") || target)
  const hostnames = new Map<string, ProviderHostname>()
  const certificates = new Map<string, CertificateStatus>()
  const records = new Map<string, string[]>()
  const failures = new Map<string, Error>()

  const key = (name: string, type: DnsRecordType) => `${type} ${name.toLowerCase()}`
  const dns: LocalHostnames["dns"] = {
    async resolve(name, type) {
      return [...(records.get(key(name, type)) ?? [])]
    },
    publish(name, type, value) {
      const values = records.get(key(name, type)) ?? []
      if (!values.includes(value)) {
        records.set(key(name, type), [...values, value])
      }
    },
    unpublish(name, type) {
      records.delete(key(name, type))
    }
  }
  const routing = (hostname: string): DnsRecord[] => [
    { type: "CNAME", name: hostname, value: target, purpose: "routing" }
  ]
  const failIfAsked = (method: string) => {
    const error = failures.get(method)
    if (error) {
      failures.delete(method)
      throw error
    }
  }
  const byName = (hostname: string) => {
    const found = [...hostnames.values()].find((entry) => entry.hostname === hostname)
    if (!found) {
      throw new Error(`The local provider has no hostname ${hostname}.`)
    }
    return found
  }
  const save = (entry: ProviderHostname) => {
    hostnames.set(entry.id, entry)
    return {
      ...entry,
      records: entry.records.map((record) => ({ ...record })),
      errors: [...entry.errors]
    }
  }
  /** Whether traffic for the hostname reaches the provider, or the customer added its prevalidation record. */
  const serves = async (entry: ProviderHostname) => {
    const checks = [...routing(entry.hostname), ...entry.records].map((record) => isRecordFound(dns, record))
    return (await Promise.all(checks)).some((found) => found === true)
  }

  return {
    zone,
    target,
    dns,
    hostnames,
    routing,
    async create(hostname) {
      failIfAsked("create")
      const existing = [...hostnames.values()].find((entry) => entry.hostname === hostname)
      if (existing) {
        return save(existing)
      }
      // Named after the hostname, so a provider made again after a restart gives a hostname the id it had.
      const id = `local-${hostname}`
      return save({
        id,
        hostname,
        status: "pending",
        certificate: "pending",
        records: [
          { type: "TXT", name: `_local-hostname.${hostname}`, value: `token-${hostname}`, purpose: "prevalidation" }
        ],
        errors: ["The hostname doesn't point at the app yet."]
      })
    },
    async get(id) {
      failIfAsked("get")
      const entry = hostnames.get(id)
      if (!entry || entry.status === "blocked" || entry.status === "moved") {
        return entry ? save(entry) : null
      }
      if (await serves(entry)) {
        return save({ ...entry, status: "active", certificate: certificates.get(id) ?? "active", errors: [] })
      }
      if (entry.status === "active") {
        return save({ ...entry, status: "moved", errors: ["The hostname no longer points at the app."] })
      }
      return save(entry)
    },
    async refresh(id) {
      failIfAsked("refresh")
      const entry = hostnames.get(id)
      if (!entry) {
        throw new Error(`The local provider has no hostname ${id}.`)
      }
      if (certificates.get(id) === "stalled" || certificates.get(id) === "failed") {
        certificates.delete(id)
      }
      if (entry.status === "blocked") {
        return save(entry)
      }
      // Like Cloudflare, a hostname that moved is validated again, while one still served stays active as its
      // certificate is issued again.
      return save({
        ...entry,
        status: entry.status === "moved" ? "pending" : entry.status,
        certificate: certificates.get(id) ?? "pending"
      })
    },
    async remove(id) {
      failIfAsked("remove")
      hostnames.delete(id)
      certificates.delete(id)
    },
    block(hostname) {
      save({ ...byName(hostname), status: "blocked", errors: ["The provider blocked this hostname."] })
    },
    holdCertificate(hostname, status) {
      const entry = byName(hostname)
      if (status === "active") {
        certificates.delete(entry.id)
      } else {
        certificates.set(entry.id, status)
      }
      if (entry.status === "active") {
        save({ ...entry, certificate: status })
      }
    },
    failNext(method, error) {
      failures.set(method, error)
    }
  }
}
