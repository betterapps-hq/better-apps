// A provider and DNS kept in memory, for tests and local development.
import type { DnsRecordType, DnsResolver } from "./dns.js"
import type { HostnameProvider, ProviderHostname } from "./provider.js"

/** What `localHostnames` takes. */
export interface LocalHostnamesOptions {
  /** The CNAME target customers point at. `customers.localhost` by default. */
  target?: string | undefined
  /**
   * How many reads of a hostname, through `get`, it takes to become `active` with its records published in the local
   * DNS. 1 by default, so the first check after adding finds it ready. `Infinity` waits for `activate`.
   */
  verifyAfter?: number | undefined
}

/** A provider in memory, with its own DNS and controls for tests. */
export interface LocalHostnames extends HostnameProvider {
  /** The local DNS, with the records of every hostname that became active and any `publish` added. */
  dns: DnsResolver & {
    /** Adds a record, such as a customer's CNAME. */
    publish(name: string, type: DnsRecordType, value: string): void
    /** Removes every record of a name and type. */
    unpublish(name: string, type: DnsRecordType): void
  }
  /** The hostnames the provider has, by id. */
  readonly hostnames: ReadonlyMap<string, ProviderHostname>
  /** Makes a hostname active and publishes its records. */
  activate(hostname: string): void
  /** Makes a hostname blocked, as a provider does with one flagged for abuse. */
  block(hostname: string): void
  /** Makes a hostname moved, as when its CNAME was removed, and unpublishes its routing record. */
  move(hostname: string): void
  /** Makes the next call of a method throw this error, once. */
  failNext(method: keyof HostnameProvider, error: Error): void
}

/**
 * A `hostnames` provider kept in memory, for tests and local development, never production. A hostname is `pending`
 * until it has been read `verifyAfter` times, then `active` with its records in `dns`.
 */
export function localHostnames(options: LocalHostnamesOptions = {}): LocalHostnames {
  const target = options.target ?? "customers.localhost"
  const verifyAfter = options.verifyAfter ?? 1
  const hostnames = new Map<string, ProviderHostname>()
  const reads = new Map<string, number>()
  const records = new Map<string, string[]>()
  const failures = new Map<keyof HostnameProvider, Error>()
  let nextId = 1

  const key = (name: string, type: DnsRecordType) => `${type} ${name.toLowerCase()}`
  const publish = (name: string, type: DnsRecordType, value: string) => {
    const values = records.get(key(name, type)) ?? []
    if (!values.includes(value)) {
      records.set(key(name, type), [...values, value])
    }
  }
  const unpublish = (name: string, type: DnsRecordType) => void records.delete(key(name, type))
  const failIfAsked = (method: keyof HostnameProvider) => {
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
  const update = (id: string, change: Partial<ProviderHostname>) => {
    const current = hostnames.get(id) as ProviderHostname
    const next = { ...current, ...change }
    hostnames.set(id, next)
    return next
  }
  const activate = (id: string) => {
    const entry = hostnames.get(id) as ProviderHostname
    for (const record of entry.records) {
      publish(record.name, record.type, record.value)
    }
    return update(id, { status: "active", certificate: "active", errors: [] })
  }
  const copy = (entry: ProviderHostname): ProviderHostname => ({
    ...entry,
    records: entry.records.map((record) => ({ ...record })),
    errors: [...entry.errors]
  })

  return {
    dns: {
      async resolve(name, type) {
        return [...(records.get(key(name, type)) ?? [])]
      },
      publish,
      unpublish
    },
    hostnames,
    async create(hostname) {
      failIfAsked("create")
      const existing = [...hostnames.values()].find((entry) => entry.hostname === hostname)
      if (existing) {
        return copy(existing)
      }
      const id = `local-${nextId++}`
      const entry: ProviderHostname = {
        id,
        hostname,
        status: "pending",
        certificate: "pending",
        records: [
          { type: "CNAME", name: hostname, value: target, purpose: "routing" },
          { type: "TXT", name: `_cf-custom-hostname.${hostname}`, value: `local-token-${id}`, purpose: "ownership" }
        ],
        errors: ["The hostname doesn't point at the app yet."]
      }
      hostnames.set(id, entry)
      reads.set(id, 0)
      return copy(entry)
    },
    async get(id) {
      failIfAsked("get")
      const entry = hostnames.get(id)
      if (!entry) {
        return null
      }
      const count = (reads.get(id) ?? 0) + 1
      reads.set(id, count)
      return copy(entry.status === "pending" && count >= verifyAfter ? activate(id) : entry)
    },
    async refresh(id) {
      failIfAsked("refresh")
      const entry = hostnames.get(id)
      if (!entry) {
        throw new Error(`The local provider has no hostname ${id}.`)
      }
      reads.set(id, 0)
      return copy(
        entry.status === "blocked"
          ? entry
          : update(id, {
              status: "pending",
              certificate: entry.certificate === "failed" ? "pending" : entry.certificate
            })
      )
    },
    async remove(id) {
      failIfAsked("remove")
      hostnames.delete(id)
      reads.delete(id)
    },
    activate: (hostname) => void activate(byName(hostname).id),
    block: (hostname) =>
      void update(byName(hostname).id, { status: "blocked", errors: ["The provider blocked this hostname."] }),
    move: (hostname) => {
      const entry = byName(hostname)
      unpublish(entry.hostname, "CNAME")
      update(entry.id, { status: "moved", errors: ["The hostname no longer points at the app."] })
    },
    failNext: (method, error) => void failures.set(method, error)
  }
}
