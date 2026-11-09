import type { DatabaseAdapter, Row, WriteOperation } from "./database.js"
import { eventModel, type BetterAppsEvent, type EmitOptions, type EventHandler } from "./events.js"
import type { BetterAppsFeature } from "./feature.js"
import type { Actor, Author, Identity } from "./identity.js"
import type { Subjects } from "./subjects.js"

/** How a delivery run went. */
export interface DeliveryReport {
  /** Events every subscriber handled, now removed from the outbox. */
  delivered: number
  /** Events a subscriber failed on, left in the outbox to retry after a backoff. */
  failed: number
}

/** Options for a delivery run from a scheduled job. */
export interface DeliverOptions {
  /** The most events to deliver. The default is 100. */
  limit?: number | undefined
  /** Keeps reports of failed subscribers running after the run returns, such as a scheduled Worker's `waitUntil`. */
  waitUntil?: ((promise: Promise<unknown>) => void) | undefined
}

/** Where an error the caller doesn't see came from. */
export interface ErrorContext {
  feature?: string | undefined
  action?: string | undefined
  /** The route whose handler, or work it kept running, failed. */
  route?: string | undefined
  event?: BetterAppsEvent | undefined
}

/** Who and when a scope's events are attributed to. */
export interface EventScope {
  actor: Actor | null
  author: Author | null
  now: Date
  silent: boolean
}

type WaitUntil = (promise: Promise<unknown>) => void

// A delivery holds an event this long, so a crashed run's events become available again.
const leaseMs = 5 * 60_000
const maxBackoffMs = 60 * 60_000
// Events emitted while delivering are delivered in the same run, up to this many, so a cycle of subscribers that keep
// emitting can't run forever. The rest wait for `deliverEvents`.
const maxDeliveriesPerRun = 1000

function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(attempts - 1, 0), maxBackoffMs)
}

function toEvent(row: Row): BetterAppsEvent {
  return {
    id: String(row.id),
    feature: String(row.feature),
    type: String(row.type),
    data: row.data ?? null,
    actor: (row.actor ?? null) as Actor | null,
    author: (row.author ?? null) as Author | null,
    silent: row.silent === true,
    createdAt: row.createdAt as Date
  }
}

/** Writes events to the outbox in the same batch as the change that caused them, and delivers them once written. */
export function createOutbox(options: {
  db: DatabaseAdapter
  features: readonly BetterAppsFeature[]
  identity: Identity
  subjects: Subjects
  onError: (error: unknown, context: ErrorContext, waitUntil?: WaitUntil) => void
}) {
  const { db, identity, subjects, onError } = options
  const subscribers = new Map<string, Map<string, { feature: BetterAppsFeature; handle: EventHandler }[]>>()
  for (const feature of options.features) {
    for (const [emitter, handlers] of Object.entries(feature.on ?? {})) {
      const byType = subscribers.get(emitter) ?? new Map()
      subscribers.set(emitter, byType)
      for (const [type, handle] of Object.entries(handlers)) {
        byType.set(type, [...(byType.get(type) ?? []), { feature, handle }])
      }
    }
  }
  const subscribersOf = (feature: string, type: string) => subscribers.get(feature)?.get(type) ?? []

  /**
   * Collects one action's or subscriber's events. Its `db` adds them to the next `batch`, so they commit with the
   * change; `flush` writes any left over. `written` lists the ids that reached the outbox.
   */
  function track(feature: BetterAppsFeature, scope: EventScope, { holdLater = false } = {}) {
    const pending: Row[] = []
    const written: string[] = []
    // Events left for the next `deliverEvents`, which this run doesn't deliver once written.
    const later = new Set<string>()
    // With `holdLater`, a subscriber's later events wait to be written with its event's removal, so a delivery that
    // fails or crashes before then never leaves them behind to run twice.
    const held: Row[] = []
    const take = () => {
      const rows = pending.splice(0)
      return { events: eventWrites(rows), ids: rows.map((row) => String(row.id)).filter((id) => !later.has(id)) }
    }
    const emit = (type: string, data: unknown, options?: EmitOptions) => {
      if (!feature.events || !Object.hasOwn(feature.events, type)) {
        throw new Error(`The "${feature.id}" feature doesn't declare a "${type}" event.`)
      }
      if (subscribersOf(feature.id, type).length === 0) {
        return
      }
      const row: Row = {
        id: crypto.randomUUID(),
        feature: feature.id,
        type,
        data: data ?? null,
        actor: scope.actor,
        author: scope.author,
        silent: scope.silent,
        createdAt: scope.now,
        availableAt: new Date(),
        attempts: 0
      }
      if (options?.later === true) {
        later.add(String(row.id))
        if (holdLater) {
          held.push(row)
          return
        }
      }
      pending.push(row)
    }
    const batch = async (operations: readonly WriteOperation[]) => {
      const { events, ids } = take()
      const results = await db.batch([...operations, ...events])
      written.push(...ids)
      return results.slice(0, operations.length)
    }
    const scoped = new Proxy(db, {
      get: (target, key, receiver) => (key === "batch" ? batch : Reflect.get(target, key, receiver))
    })
    const flush = async () => {
      const { events, ids } = take()
      if (events.length > 0) {
        await db.batch(events)
        written.push(...ids)
      }
    }
    return { db: scoped, emit, flush, written, held }
  }

  /** Writes event rows, many with one createMany, so a bulk job's page of them takes a few statements. */
  function eventWrites(rows: readonly Row[]): WriteOperation[] {
    if (rows.length > 1) {
      return [{ type: "createMany", model: eventModel, data: rows }]
    }
    return rows.map((data) => ({ type: "create", model: eventModel, data }))
  }

  // Claims an event, runs its subscribers, and removes it once they all succeed. Returns the events they emitted.
  async function deliverOne(id: string, report: DeliveryReport, waitUntil?: WaitUntil): Promise<string[]> {
    const now = new Date()
    const row = await db.incrementOne({
      model: eventModel,
      where: [
        { field: "id", value: id },
        { field: "availableAt", operator: "lte", value: now }
      ],
      increment: { attempts: 1 },
      set: { availableAt: new Date(now.getTime() + leaseMs) }
    })
    if (!row) {
      // Already delivered, or held by another run.
      return []
    }
    const event = toEvent(row)
    const emitted: string[] = []
    const later: Row[] = []
    try {
      for (const { feature, handle } of subscribersOf(event.feature, event.type)) {
        const scope = track(
          feature,
          { actor: event.actor, author: event.author, now: new Date(), silent: event.silent },
          { holdLater: true }
        )
        try {
          await handle(event, { db: scope.db, identity, subjects, emit: scope.emit })
          await scope.flush()
          later.push(...scope.held)
        } finally {
          emitted.push(...scope.written)
        }
      }
      // Events left for later are written with the event's removal, so a retried delivery emits them once.
      await db.batch([
        ...eventWrites(later),
        { type: "deleteMany", model: eventModel, where: [{ field: "id", value: id }] }
      ])
      report.delivered += 1
    } catch (error) {
      report.failed += 1
      onError(error, { feature: event.feature, event }, waitUntil)
      const retryAt = new Date(Date.now() + backoffMs(Number(row.attempts)))
      const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1000)
      await db
        .update({ model: eventModel, where: [{ field: "id", value: id }], update: { availableAt: retryAt, lastError } })
        .catch((updateError: unknown) => onError(updateError, { feature: event.feature, event }, waitUntil))
    }
    return emitted
  }

  /**
   * Delivers the given events, then any they cause. It never throws; failures are reported through `onError`, whose
   * reports are handed to `waitUntil` so they aren't cut off when the run ends.
   */
  async function deliver(ids: readonly string[], waitUntil?: WaitUntil): Promise<DeliveryReport> {
    const report: DeliveryReport = { delivered: 0, failed: 0 }
    const queue = [...ids]
    for (let count = 0; queue.length > 0 && count < maxDeliveriesPerRun; count += 1) {
      const id = queue.shift() as string
      try {
        queue.push(...(await deliverOne(id, report, waitUntil)))
      } catch (error) {
        // The outbox itself couldn't be read or written. The event stays for the next run.
        report.failed += 1
        onError(error, {}, waitUntil)
      }
    }
    return report
  }

  /** Delivers events that are due: new ones a crash left behind, and failed ones whose backoff has passed. */
  async function deliverPending({ limit = 100, waitUntil }: DeliverOptions = {}): Promise<DeliveryReport> {
    if (subscribers.size === 0) {
      return { delivered: 0, failed: 0 }
    }
    const due = await db.findMany<{ id: string }>({
      model: eventModel,
      where: [{ field: "availableAt", operator: "lte", value: new Date() }],
      sortBy: [
        { field: "availableAt", direction: "asc" },
        { field: "id", direction: "asc" }
      ],
      limit,
      select: ["id"]
    })
    return deliver(
      due.map((row) => row.id),
      waitUntil
    )
  }

  return { track, deliver, deliverPending }
}
