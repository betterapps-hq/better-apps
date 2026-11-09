// Checking a custom domain and saving what the check found: proving the organization owns the hostname and taking
// it, asking the provider where it stands, and scheduling the next check.
import type { ActionContext, EventContext, Where } from "better-apps"
import {
  checkWindowMs,
  contestedError,
  describe,
  evictedError,
  expiredError,
  fromProvider,
  inspect,
  type Inspection,
  lookUp,
  lookupError,
  nextCheckAt,
  ownershipError,
  ownershipRecord,
  recheckMs,
  statusOf,
  unchecked
} from "./checks.js"
import type { Config } from "./config.js"
import { isRecordFound } from "./dns.js"
import { DomainsError } from "./errors.js"
import type { CertificateStatus, HostnameProvider } from "./provider.js"
import { publicOrg, summary } from "./rows.js"
import { domainModel, type CheckedRecord, type DomainRow, type DomainStatus } from "./schema.js"

/** What writes domains and emits their events: an action's context, or a subscriber's. */
export type Writer = Pick<ActionContext<unknown>, "db" | "emit">

type Announcement = readonly [type: string, data: unknown]

/**
 * Emits the events of a write that committed, and writes them at once, so a later batch that fails can't drop them.
 * Events are emitted only once a write is known to have changed something, never before a write that may match no row.
 */
export async function announce(writer: Writer, events: readonly Announcement[]): Promise<void> {
  if (events.length === 0) {
    return
  }
  for (const [type, data] of events) {
    writer.emit(type, data)
  }
  await writer.db.batch([])
}

/**
 * Makes an active domain its organization's primary one when the organization has none. Another domain becoming primary
 * at the same moment wins, through the unique `primaryOf`.
 */
export async function claimPrimary(writer: Writer, row: DomainRow): Promise<DomainRow> {
  if (row.status !== "active" || row.primaryOf !== null) {
    return row
  }
  const { db } = writer
  const current = await db.findOne<DomainRow>({ model: domainModel, where: [{ field: "primaryOf", value: row.orgId }] })
  if (current) {
    return row
  }
  let primary: DomainRow | null
  try {
    const [updated] = await db.batch([
      {
        type: "update",
        model: domainModel,
        where: [
          { field: "id", value: row.id },
          { field: "status", value: "active" },
          { field: "primaryOf", value: null }
        ],
        update: { primaryOf: row.orgId }
      }
    ])
    primary = updated as DomainRow | null
  } catch {
    return row
  }
  if (!primary) {
    return row
  }
  await announce(writer, [["primary.changed", { orgId: publicOrg(row.orgId), domain: summary(primary) }]])
  return primary
}

async function removeAtProvider(config: Config, row: DomainRow): Promise<void> {
  if (row.kind === "custom" && row.providerId !== null && config.provider) {
    const { provider } = config
    const { providerId } = row
    await fromProvider(() => provider.remove(providerId))
  }
}

/**
 * Removes a domain: from the provider first, so a failure there keeps the row to try again, then from the app. Returns
 * whether this call removed it.
 */
export async function removeDomain(config: Config, writer: Writer, row: DomainRow): Promise<boolean> {
  await removeAtProvider(config, row)
  const [removed] = await writer.db.batch([
    { type: "deleteMany", model: domainModel, where: [{ field: "id", value: row.id }] }
  ])
  if ((removed as number) === 0) {
    return false
  }
  await announce(writer, [
    ["domain.removed", { domain: summary(row) }],
    ...(row.primaryOf === null
      ? []
      : [["primary.changed", { orgId: publicOrg(row.orgId), domain: null }] as const satisfies Announcement])
  ])
  return true
}

/** How a domain is being checked: the schedule its check belongs to. */
export interface Schedule {
  /** Scheduled checks since checking started. */
  attempts: number
  checkingSince: Date
  token: string
}

/** What a check of a custom domain found. */
interface Finding {
  /** Whether the domain holds its hostname. */
  claimed: boolean
  providerId: string | null
  status: DomainStatus
  certificate: CertificateStatus
  records: CheckedRecord[]
  error: string | null
  /** The provider id of a hostname the check registered, or `null` when it registered none. */
  registered: string | null
}

const providerOf = (config: Config) => config.provider as HostnameProvider

/**
 * Frees a hostname from the domain holding it, for an organization that just proved it owns the hostname, unless the
 * holder's own ownership record is still in place. Returns why it can't, or `null` once the hostname is free.
 */
async function evict(config: Config, writer: Writer, holder: DomainRow): Promise<string | null> {
  if (holder.ownershipToken === null) {
    return "That domain is in use."
  }
  const record = ownershipRecord(config.ownershipLabel, holder.hostname, holder.ownershipToken)
  const stillProven = await isRecordFound(config.dns, record)
  if (stillProven === null) {
    return lookupError
  }
  if (stillProven) {
    return contestedError(record.name)
  }
  // The provider's hostname stays for the new holder, which registering again returns, so it isn't the evicted
  // domain's to remove anymore.
  const [evicted] = await writer.db.batch([
    {
      type: "update",
      model: domainModel,
      where: [
        { field: "id", value: holder.id },
        { field: "claimedHostname", value: holder.hostname }
      ],
      update: {
        claimedHostname: null,
        providerId: null,
        primaryOf: null,
        status: "failed",
        records: unchecked([...providerOf(config).routing(holder.hostname), record]),
        error: evictedError,
        checkToken: null,
        checkingSince: null,
        nextCheckAt: null
      }
    }
  ])
  if (evicted) {
    const row = evicted as DomainRow
    await announce(writer, [
      ...(holder.status === "failed"
        ? []
        : [["domain.status.changed", { domain: summary(row), from: holder.status }] as const]),
      ...(holder.primaryOf === null
        ? []
        : [["primary.changed", { orgId: publicOrg(holder.orgId), domain: null }] as const])
    ])
  }
  return null
}

/** Takes the hostname for a domain whose ownership record was found. Returns `true`, why it can't, or `null` if gone. */
async function claim(config: Config, writer: Writer, row: DomainRow): Promise<true | string | null> {
  const { db } = writer
  const holderOf = () =>
    db.findOne<DomainRow>({ model: domainModel, where: [{ field: "claimedHostname", value: row.hostname }] })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const holder = await holderOf()
    if (holder?.id === row.id) {
      return true
    }
    if (holder) {
      const blocked = await evict(config, writer, holder)
      if (blocked !== null) {
        return blocked
      }
    }
    try {
      const [taken] = await db.batch([
        {
          type: "update",
          model: domainModel,
          where: [
            { field: "id", value: row.id },
            { field: "claimedHostname", value: null }
          ],
          update: { claimedHostname: row.hostname }
        }
      ])
      if (taken) {
        return true
      }
      // Nothing matched: the domain was removed, or a check that ran alongside this one took the hostname for it.
      const current = await db.findOne<DomainRow>({ model: domainModel, where: [{ field: "id", value: row.id }] })
      return current ? true : null
    } catch (caught) {
      // Another domain took the hostname after it was read: look again. Anything else is the database's.
      if (!(await holderOf())) {
        throw caught
      }
    }
  }
  return "Another organization just took this domain. Check again in a moment."
}

/** Proves the organization owns a custom domain's hostname, taking it once its ownership record is found. */
async function prove(config: Config, writer: Writer, row: DomainRow): Promise<Finding | "claimed" | null> {
  if (row.claimedHostname !== null) {
    return "claimed"
  }
  const ownership = ownershipRecord(config.ownershipLabel, row.hostname, row.ownershipToken as string)
  const proven = await isRecordFound(config.dns, ownership)
  let error: string | null = null
  if (proven === true) {
    const claimed = await claim(config, writer, row)
    if (claimed === true) {
      return "claimed"
    }
    if (claimed === null) {
      return null
    }
    error = claimed
  }
  const records = [
    ...(await lookUp(config.dns, providerOf(config).routing(row.hostname))),
    { ...ownership, found: proven }
  ]
  return {
    claimed: false,
    providerId: null,
    status: "pending",
    certificate: "pending",
    records,
    error: error ?? ownershipError(records),
    registered: null
  }
}

/** Asks the provider where a domain the organization holds stands, registering it when it has to. */
async function serve(config: Config, row: DomainRow): Promise<Finding> {
  const provider = providerOf(config)
  let inspection: Inspection
  try {
    inspection = await inspect(provider, row)
  } catch (caught) {
    // A provider that can't be reached is tried again. One that refuses the hostname, such as when it has to
    // register it again, won't change its mind, so the domain fails with its reason.
    if (!(caught instanceof DomainsError) || caught.code === "PROVIDER_ERROR") {
      throw caught
    }
    return {
      claimed: true,
      providerId: row.providerId,
      status: "failed",
      certificate: row.certificate,
      records: row.records ?? [],
      error: caught.message,
      registered: null
    }
  }
  const { state } = inspection
  const records = await lookUp(config.dns, [...provider.routing(row.hostname), ...state.records])
  const active = row.status === "active"
  const status = statusOf(inspection, active)
  // A ready domain keeps the error of a renewal that stalled until its certificate is issued, since the provider
  // reports the renewal asked for again as pending.
  const kept = active && status === "active" && state.certificate !== "active" ? row.error : null
  return {
    claimed: true,
    providerId: state.id,
    status,
    certificate: state.certificate,
    records,
    error: describe(inspection, records, status) ?? kept,
    registered: inspection.registered ? state.id : null
  }
}

/**
 * Removes a hostname a check registered at the provider once no domain holds it, such as when the domain was removed
 * while it was being checked, so the provider isn't left with a hostname nothing tracks. A domain that holds it, such
 * as one that took it over, keeps it, since registering it again returns the same one.
 */
async function release(config: Config, writer: Writer, hostname: string, providerId: string): Promise<void> {
  const holder = await writer.db.findOne<DomainRow>({
    model: domainModel,
    where: [{ field: "claimedHostname", value: hostname }]
  })
  if (!holder) {
    const provider = providerOf(config)
    await fromProvider(() => provider.remove(providerId))
  }
}

/** The schedule fields a check saves: the next check while the domain is pending or active, none once it failed. */
function scheduleFields(status: DomainStatus, schedule: Schedule, now: Date): Partial<DomainRow> {
  if (status === "failed") {
    return { attempts: schedule.attempts, checkToken: null, checkingSince: null, nextCheckAt: null }
  }
  if (status === "active") {
    return {
      attempts: 0,
      checkToken: schedule.token,
      checkingSince: null,
      nextCheckAt: new Date(now.getTime() + recheckMs)
    }
  }
  return {
    attempts: schedule.attempts,
    checkToken: schedule.token,
    checkingSince: schedule.checkingSince,
    nextCheckAt: nextCheckAt(schedule.attempts, now)
  }
}

/**
 * Checks a custom domain and saves what it found, with its next check, while `where` still holds, such as the
 * schedule still being this one. Returns the saved domain, or `null` when it changed meanwhile: removed, given another
 * schedule, or its hostname taken. A provider that can't be reached throws.
 */
export async function runCheck(
  config: Config,
  writer: Writer,
  row: DomainRow,
  now: Date,
  schedule: Schedule,
  where: Where[]
): Promise<DomainRow | null> {
  const proof = await prove(config, writer, row)
  if (proof === null) {
    return null
  }
  let finding = proof === "claimed" ? await serve(config, row) : proof
  if (finding.status === "pending" && now.getTime() - schedule.checkingSince.getTime() >= checkWindowMs) {
    // A domain nobody finished setting up stops holding a hostname at the provider; checking it again registers it.
    await removeAtProvider(config, { ...row, providerId: finding.providerId })
    finding = { ...finding, status: "failed", providerId: null, error: expiredError, registered: null }
  }
  const { claimed, registered, ...found } = finding
  const update: Partial<DomainRow> = {
    ...found,
    ...scheduleFields(finding.status, schedule, now),
    lastCheckedAt: now,
    verifiedAt: finding.status === "active" && row.status !== "active" ? now : row.verifiedAt
  }
  if (update.checkToken && update.nextCheckAt) {
    // Not read before it's due. From an action, it's written with the save. In a scheduled check, the outbox writes it
    // as it removes the event being handled, and a run that stops before then gets that event again. Either way, the
    // schedule never stops.
    writer.emit("check.scheduled", { domainId: row.id, token: update.checkToken }, { availableAt: update.nextCheckAt })
  }
  const [updated] = await writer.db.batch([
    {
      type: "update",
      model: domainModel,
      where: [
        { field: "id", value: row.id },
        { field: "claimedHostname", value: claimed ? row.hostname : null },
        ...where
      ],
      update
    }
  ])
  if (!updated) {
    if (registered !== null) {
      await release(config, writer, row.hostname, registered)
    }
    return null
  }
  const saved = updated as DomainRow
  if (saved.status !== row.status) {
    await announce(writer, [
      ["domain.status.changed", { domain: summary(saved), from: row.status }],
      ...(saved.status === "active" ? [["domain.verified", { domain: summary(saved) }] as const] : [])
    ])
  }
  return claimPrimary(writer, saved)
}

/** What a `check.scheduled` event carries. */
export interface ScheduledCheck {
  domainId: string
  token: string
}

/**
 * A domain's scheduled check, from its `check.scheduled` event, which the outbox holds until it's due: skipped when a
 * newer schedule replaced it, then run, scheduling the next one while the domain is pending or active.
 */
export async function scheduledCheck(config: Config, context: EventContext, data: ScheduledCheck): Promise<void> {
  const now = new Date()
  const row = await context.db.findOne<DomainRow>({
    model: domainModel,
    where: [{ field: "id", value: data.domainId }]
  })
  if (!row || row.checkToken !== data.token || row.kind !== "custom" || !config.provider) {
    return
  }
  // A run that stopped after saving a check but before the outbox heard delivers the event again: wait for the
  // domain's next check instead.
  if (row.nextCheckAt && row.nextCheckAt.getTime() > now.getTime()) {
    context.emit("check.scheduled", data, { availableAt: row.nextCheckAt })
    return
  }
  // An active domain that stopped being ready starts the schedule of a pending one.
  const resumed = row.status === "active"
  await runCheck(
    config,
    context,
    row,
    now,
    {
      attempts: resumed ? 0 : row.attempts + 1,
      checkingSince: resumed ? now : (row.checkingSince ?? now),
      token: data.token
    },
    [{ field: "checkToken", value: data.token }]
  )
}
