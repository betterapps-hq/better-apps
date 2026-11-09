import {
  defineAction,
  defineFeature,
  type ActionContext,
  type Actor,
  type DatabaseAdapter,
  type EventContext,
  type WriteOperation
} from "better-apps"
import { z } from "zod"
import {
  checkCooldownMs,
  checkWindowMs,
  evaluate,
  expiredError,
  fromProvider,
  inspect,
  nextCheckAt,
  type Inspection
} from "./checks.js"
import { dnsOverHttps, type DnsResolver } from "./dns.js"
import { DomainsError } from "./errors.js"
import { domainEvents, type DomainSummary } from "./events.js"
import {
  customHostnameProblem,
  defaultReservedSubdomains,
  isZone,
  labelProblem,
  maxHostnameLength,
  normalizeHostname,
  normalizeLabel
} from "./hostname.js"
import type { AddDomainInput, DomainInput, DomainsOptions, ManageArgs, SetPrimaryInput } from "./options.js"
import type { HostnameProvider } from "./provider.js"
import {
  domainModel,
  domainsSchema,
  type CertificateStatus,
  type CheckedRecord,
  type DomainKind,
  type DomainRow,
  type DomainStatus
} from "./schema.js"

/** A domain as actions return it. */
export interface Domain {
  id: string
  hostname: string
  kind: DomainKind
  status: DomainStatus
  certificate: CertificateStatus
  /** Whether it's the organization's primary domain. */
  primary: boolean
  /** The DNS records the customer adds, with what the last check found. None for subdomains. */
  records: CheckedRecord[]
  /** Why it isn't ready, in words to show, or `null`. */
  error: string | null
  createdAt: Date
  lastCheckedAt: Date | null
  /** When the next scheduled check is due, or `null` when none is. */
  nextCheckAt: Date | null
  verifiedAt: Date | null
}

/** What `list` returns: an organization's domains and everything a settings screen needs to manage them. */
export interface DomainList {
  /** In the order they were added. */
  domains: Domain[]
  /** Whether the caller can add, check and remove domains and choose the primary one. */
  canManage: boolean
  /** The zone subdomains go under, or `null` when the app doesn't offer them. */
  subdomainZone: string | null
  /** Whether the app offers custom domains. */
  customDomains: boolean
  /** How many domains of both kinds one organization can have. */
  maxPerOrg: number
}

/** What `lookup` returns for a hostname a domain holds. */
export interface HostnameMatch {
  domainId: string
  /** The organization, or `null` in an app without organizations. */
  orgId: string | null
  hostname: string
  kind: DomainKind
  status: DomainStatus
  /** Whether the domain is `active`, so the app can serve it. */
  verified: boolean
  primary: boolean
}

/** Size limits. */
export const limits = {
  maxPerOrg: 10,
  maxPerOrgCap: 100,
  subdomainsPerOrg: 1,
  minLabelLength: 3
} as const

/** How domains are set up, resolved once when the feature is created. */
interface Config {
  subdomains: { zone: string; reserved: ReadonlySet<string>; minLength: number; maxPerOrg: number } | null
  provider: HostnameProvider | null
  dns: DnsResolver
  canManage: (args: ManageArgs) => boolean | Promise<boolean>
  maxPerOrg: number
}

type Context = ActionContext<unknown>

const defaultCanManage = ({ actor }: ManageArgs) => actor.roles.includes("owner") || actor.roles.includes("admin")

function wholeNumber(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`\`${name}\` is a whole number from ${min} to ${max}.`)
  }
  return resolved
}

function resolve(options: DomainsOptions): Config {
  if (!options.subdomains && !options.custom) {
    throw new Error("Set up `subdomains`, `custom` or both for organizations to have domains.")
  }
  const { subdomains } = options
  if (subdomains && !isZone(subdomains.zone)) {
    throw new Error(
      `"${subdomains.zone}" isn't a zone subdomains can go under. Use a lowercase name such as yourapp.com.`
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
    provider: options.custom?.provider ?? null,
    dns: options.dns ?? dnsOverHttps(),
    canManage: options.canManage ?? defaultCanManage,
    maxPerOrg: wholeNumber(options.maxPerOrg, limits.maxPerOrg, 1, limits.maxPerOrgCap, "maxPerOrg")
  }
}

const publicOrg = (orgId: string) => (orgId === "" ? null : orgId)

function toDomain(row: DomainRow): Domain {
  return {
    id: row.id,
    hostname: row.hostname,
    kind: row.kind,
    status: row.status,
    certificate: row.certificate,
    primary: row.primaryOf !== null,
    records: row.records ?? [],
    error: row.error,
    createdAt: row.createdAt,
    lastCheckedAt: row.lastCheckedAt,
    nextCheckAt: row.nextCheckAt,
    verifiedAt: row.verifiedAt
  }
}

function summary(row: DomainRow): DomainSummary {
  return {
    id: row.id,
    orgId: publicOrg(row.orgId),
    hostname: row.hostname,
    kind: row.kind,
    status: row.status,
    primary: row.primaryOf !== null
  }
}

/**
 * Server code that passes neither an actor nor a request is trusted: it names the organization in the input and skips
 * `canManage`.
 */
function isTrusted(context: Context): boolean {
  return context.source === "api" && context.actor === null && context.request === null
}

/** The organization a call acts on, and the actor, or `null` for trusted server code. */
function orgOf(context: Context, input: { orgId?: string | null | undefined }): { orgId: string; actor: Actor | null } {
  if (isTrusted(context)) {
    return { orgId: input.orgId ?? "", actor: null }
  }
  const { actor } = context
  if (!actor) {
    throw new DomainsError("UNAUTHENTICATED", "Sign in to see domains.")
  }
  const orgId = actor.orgId ?? ""
  if (input.orgId !== undefined && (input.orgId ?? "") !== orgId) {
    throw new DomainsError("FORBIDDEN", "You can only see your own organization's domains.")
  }
  return { orgId, actor }
}

/** The organization a manager acts on, or the error that says why the caller can't manage its domains. */
async function managedOrg(config: Config, context: Context, input: { orgId?: string | null | undefined }) {
  const { orgId, actor } = orgOf(context, input)
  if (actor && !(await config.canManage({ actor, orgId: publicOrg(orgId) }))) {
    throw new DomainsError("FORBIDDEN", "Only the organization's admins can change its domains.")
  }
  return orgId
}

async function findDomain(db: DatabaseAdapter, orgId: string, domainId: string): Promise<DomainRow | null> {
  return db.findOne<DomainRow>({
    model: domainModel,
    where: [
      { field: "id", value: domainId },
      { field: "orgId", value: orgId }
    ]
  })
}

async function requireDomain(db: DatabaseAdapter, orgId: string, domainId: string): Promise<DomainRow> {
  const row = await findDomain(db, orgId, domainId)
  if (!row) {
    throw new DomainsError("NOT_FOUND", "That domain doesn't exist.")
  }
  return row
}

type Writer = Pick<Context, "db" | "emit">

/**
 * Makes an active domain its organization's primary one when the organization has none. Another domain becoming primary
 * at the same moment wins, through the unique `primaryOf`.
 */
async function claimPrimary(writer: Writer, row: DomainRow): Promise<DomainRow> {
  if (row.status !== "active" || row.primaryOf !== null) {
    return row
  }
  const { db } = writer
  const current = await db.findOne<DomainRow>({ model: domainModel, where: [{ field: "primaryOf", value: row.orgId }] })
  if (current) {
    return row
  }
  const primary = { ...row, primaryOf: row.orgId }
  writer.emit("primary.changed", { orgId: publicOrg(row.orgId), domain: summary(primary) })
  try {
    const [updated] = await db.batch([
      { type: "update", model: domainModel, where: [{ field: "id", value: row.id }], update: { primaryOf: row.orgId } }
    ])
    return (updated as DomainRow | null) ?? row
  } catch {
    return row
  }
}

/** The writes and events that remove a domain, with `primary.changed` when it was the primary one. */
function removal(writer: Writer, row: DomainRow): WriteOperation[] {
  writer.emit("domain.removed", { domain: summary(row) })
  if (row.primaryOf !== null) {
    writer.emit("primary.changed", { orgId: publicOrg(row.orgId), domain: null })
  }
  return [{ type: "deleteMany", model: domainModel, where: [{ field: "id", value: row.id }] }]
}

async function removeAtProvider(config: Config, row: DomainRow): Promise<void> {
  if (row.kind === "custom" && row.providerId !== null && config.provider) {
    const { provider } = config
    const { providerId } = row
    await fromProvider(() => provider.remove(providerId))
  }
}

/** The fields a check saves, and the next scheduled check while the domain is pending. */
function checkedFields(
  writer: Writer,
  row: DomainRow,
  inspection: Inspection,
  now: Date,
  schedule: { attempts: number; checkingSince: Date; token: string }
): Partial<DomainRow> {
  const expired = inspection.status === "pending" && now.getTime() - schedule.checkingSince.getTime() >= checkWindowMs
  const status: DomainStatus = expired ? "failed" : inspection.status
  const pending = status === "pending"
  const next = { ...row, ...inspection, status }
  if (status !== row.status) {
    writer.emit("domain.status.changed", { domain: summary(next), from: row.status })
    if (status === "active") {
      writer.emit("domain.verified", { domain: summary(next) })
    }
  }
  if (pending) {
    writer.emit("check.scheduled", { domainId: row.id, token: schedule.token }, { later: true })
  }
  return {
    ...inspection,
    status,
    error: expired ? expiredError : inspection.error,
    attempts: schedule.attempts,
    checkingSince: schedule.checkingSince,
    checkToken: pending ? schedule.token : null,
    nextCheckAt: pending ? nextCheckAt(schedule.attempts, now) : null,
    lastCheckedAt: now,
    verifiedAt: status === "active" && row.status !== "active" ? now : row.verifiedAt
  }
}

const orgInput = z.string().max(200).nullable().optional()

const inputs = {
  list: z.object({ orgId: orgInput }).optional(),
  add: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("subdomain"), label: z.string().max(100), orgId: orgInput }),
    z.object({ kind: z.literal("custom"), hostname: z.string().max(maxHostnameLength + 50), orgId: orgInput })
  ]),
  domain: z.object({ domainId: z.string().min(1).max(200), orgId: orgInput }),
  setPrimary: z.object({ domainId: z.string().min(1).max(200).nullable(), orgId: orgInput }),
  lookup: z.object({ hostname: z.string().max(maxHostnameLength + 50) }),
  getPrimary: z.object({ orgId: z.string().max(200).nullable() })
}

async function list(config: Config, context: Context, input: { orgId?: string | null | undefined }) {
  const { orgId, actor } = orgOf(context, input)
  const rows = await context.db.findMany<DomainRow>({
    model: domainModel,
    where: [{ field: "orgId", value: orgId }],
    sortBy: [
      { field: "createdAt", direction: "asc" },
      { field: "id", direction: "asc" }
    ],
    limit: limits.maxPerOrgCap
  })
  return {
    domains: rows.map(toDomain),
    canManage: actor === null || (await config.canManage({ actor, orgId: publicOrg(orgId) })),
    subdomainZone: config.subdomains?.zone ?? null,
    customDomains: config.provider !== null,
    maxPerOrg: config.maxPerOrg
  } satisfies DomainList
}

/** Checks a requested hostname against the rules, returning it normalized. */
function hostnameFor(config: Config, input: AddDomainInput): string {
  if (input.kind === "subdomain") {
    const { subdomains } = config
    if (!subdomains) {
      throw new DomainsError("INVALID_INPUT", "This app doesn't offer subdomains.")
    }
    const label = normalizeLabel(input.label)
    const problem = labelProblem(label, subdomains)
    if (problem) {
      throw new DomainsError("INVALID_INPUT", problem)
    }
    return `${label}.${subdomains.zone}`
  }
  if (!config.provider) {
    throw new DomainsError("INVALID_INPUT", "This app doesn't offer custom domains.")
  }
  const hostname = normalizeHostname(input.hostname)
  if (hostname === null) {
    throw new DomainsError("INVALID_INPUT", "Enter a domain such as links.example.com, without a path or port.")
  }
  const problem = customHostnameProblem(hostname, config.subdomains?.zone ?? null)
  if (problem) {
    throw new DomainsError("INVALID_INPUT", problem)
  }
  return hostname
}

async function checkLimits(config: Config, db: DatabaseAdapter, orgId: string, kind: DomainKind) {
  const count = await db.count({ model: domainModel, where: [{ field: "orgId", value: orgId }] })
  if (count >= config.maxPerOrg) {
    throw new DomainsError("LIMIT_EXCEEDED", `An organization can have up to ${config.maxPerOrg} domains.`)
  }
  const perKind = kind === "subdomain" ? (config.subdomains?.maxPerOrg ?? 0) : null
  if (perKind !== null) {
    const subdomains = await db.count({
      model: domainModel,
      where: [
        { field: "orgId", value: orgId },
        { field: "kind", value: "subdomain" }
      ]
    })
    if (subdomains >= perKind) {
      throw new DomainsError(
        "LIMIT_EXCEEDED",
        perKind === 1
          ? "An organization can have one subdomain. Remove it to choose another."
          : `An organization can have up to ${perKind} subdomains.`
      )
    }
  }
}

/** Frees a hostname another organization holds when that domain failed, or says it's taken. */
async function claimHostname(config: Config, writer: Writer, orgId: string, hostname: string, kind: DomainKind) {
  const existing = await writer.db.findOne<DomainRow>({
    model: domainModel,
    where: [{ field: "hostname", value: hostname }]
  })
  if (!existing) {
    return
  }
  if (existing.orgId === orgId) {
    throw new DomainsError("CONFLICT", "Your organization already added that domain.")
  }
  if (existing.status !== "failed") {
    throw new DomainsError(
      "CONFLICT",
      kind === "subdomain" ? "That subdomain is taken." : "That domain is already in use."
    )
  }
  await removeAtProvider(config, existing)
  await writer.db.batch(removal(writer, existing))
}

async function add(config: Config, context: Context, input: AddDomainInput): Promise<Domain> {
  const orgId = await managedOrg(config, context, input)
  const { db, now } = context
  const hostname = hostnameFor(config, input)
  await checkLimits(config, db, orgId, input.kind)
  await claimHostname(config, context, orgId, hostname, input.kind)
  const id = crypto.randomUUID()
  const createdBy = context.author?.type === "user" ? context.author.userId : null
  const base = { id, orgId, hostname, kind: input.kind, primaryOf: null, attempts: 0, createdAt: now, createdBy }
  if (input.kind === "subdomain") {
    const row: DomainRow = {
      ...base,
      status: "active",
      certificate: "active",
      records: [],
      providerId: null,
      error: null,
      checkToken: null,
      checkingSince: null,
      nextCheckAt: null,
      lastCheckedAt: null,
      verifiedAt: now
    }
    context.emit("domain.added", { domain: summary(row) })
    const [created] = await insert(db, () => db.batch([{ type: "create", model: domainModel, data: row }]), hostname)
    return toDomain(await claimPrimary(context, created as DomainRow))
  }
  const provider = config.provider as HostnameProvider
  const token = crypto.randomUUID()
  // The row claims the hostname before the provider hears of it, so two organizations can't both register it.
  const row = await insert(
    db,
    () =>
      db.create<DomainRow>({
        model: domainModel,
        data: {
          ...base,
          status: "pending",
          certificate: "pending",
          records: [],
          providerId: null,
          error: null,
          checkToken: token,
          checkingSince: now,
          nextCheckAt: nextCheckAt(0, now),
          lastCheckedAt: null,
          verifiedAt: null
        }
      }),
    hostname
  )
  let inspection: Inspection
  try {
    inspection = await fromProvider(async () => evaluate(config.dns, await provider.create(hostname)))
  } catch (caught) {
    await db.deleteMany({ model: domainModel, where: [{ field: "id", value: id }] })
    throw caught
  }
  context.emit("domain.added", { domain: summary({ ...row, ...inspection }) })
  const update = checkedFields(context, row, inspection, now, { attempts: 0, checkingSince: now, token })
  const [updated] = await db.batch([
    { type: "update", model: domainModel, where: [{ field: "id", value: id }], update }
  ])
  return toDomain(await claimPrimary(context, (updated as DomainRow | null) ?? { ...row, ...update }))
}

/** Runs the write that claims a hostname, answering `CONFLICT` when another claim of it got there first. */
async function insert<Result>(db: DatabaseAdapter, write: () => Promise<Result>, hostname: string): Promise<Result> {
  try {
    return await write()
  } catch (caught) {
    const taken = await db.findOne({ model: domainModel, where: [{ field: "hostname", value: hostname }] })
    if (taken) {
      throw new DomainsError("CONFLICT", "That domain was just taken.", { cause: caught })
    }
    throw caught
  }
}

async function check(config: Config, context: Context, input: DomainInput): Promise<Domain> {
  const orgId = await managedOrg(config, context, input)
  const { db, now } = context
  const row = await requireDomain(db, orgId, input.domainId)
  if (row.kind === "subdomain") {
    return toDomain(row)
  }
  if (row.lastCheckedAt && now.getTime() - row.lastCheckedAt.getTime() < checkCooldownMs) {
    throw new DomainsError("RATE_LIMITED", "This domain was checked a moment ago. Try again in a few seconds.")
  }
  if (!config.provider) {
    throw new DomainsError("INVALID_INPUT", "This app doesn't offer custom domains anymore.")
  }
  const inspection = await inspect(config.provider, config.dns, row)
  // Checking now starts the schedule over, so an older schedule's next event stops.
  const update = checkedFields(context, row, inspection, now, {
    attempts: 0,
    checkingSince: now,
    token: crypto.randomUUID()
  })
  const [updated] = await db.batch([
    { type: "update", model: domainModel, where: [{ field: "id", value: row.id }], update }
  ])
  if (!updated) {
    throw new DomainsError("NOT_FOUND", "That domain was just removed.")
  }
  return toDomain(await claimPrimary(context, updated as DomainRow))
}

async function remove(config: Config, context: Context, input: DomainInput): Promise<{ removed: boolean }> {
  const orgId = await managedOrg(config, context, input)
  const row = await findDomain(context.db, orgId, input.domainId)
  if (!row) {
    return { removed: false }
  }
  await removeAtProvider(config, row)
  const [removed] = await context.db.batch(removal(context, row))
  return { removed: (removed as number) > 0 }
}

async function setPrimary(
  config: Config,
  context: Context,
  input: SetPrimaryInput
): Promise<{ primary: Domain | null }> {
  const orgId = await managedOrg(config, context, input)
  const { db } = context
  const current = await db.findOne<DomainRow>({ model: domainModel, where: [{ field: "primaryOf", value: orgId }] })
  const clear: WriteOperation = {
    type: "updateMany",
    model: domainModel,
    where: [{ field: "primaryOf", value: orgId }],
    update: { primaryOf: null }
  }
  if (input.domainId === null) {
    if (current) {
      context.emit("primary.changed", { orgId: publicOrg(orgId), domain: null })
      await db.batch([clear])
    }
    return { primary: null }
  }
  const row = await requireDomain(db, orgId, input.domainId)
  if (row.primaryOf !== null) {
    return { primary: toDomain(row) }
  }
  if (row.status !== "active") {
    throw new DomainsError("CONFLICT", "Only a domain that’s ready can be primary.")
  }
  const primary = { ...row, primaryOf: orgId }
  context.emit("primary.changed", { orgId: publicOrg(orgId), domain: summary(primary) })
  try {
    await db.batch([
      clear,
      { type: "update", model: domainModel, where: [{ field: "id", value: row.id }], update: { primaryOf: orgId } }
    ])
  } catch (caught) {
    throw new DomainsError("CONFLICT", "The primary domain just changed. Try again.", { cause: caught })
  }
  return { primary: toDomain(primary) }
}

async function lookup(context: Context, input: { hostname: string }): Promise<HostnameMatch | null> {
  const hostname = normalizeHostname(input.hostname, { allowPort: true })
  if (hostname === null) {
    return null
  }
  const row = await context.db.findOne<DomainRow>({
    model: domainModel,
    where: [{ field: "hostname", value: hostname }]
  })
  if (!row) {
    return null
  }
  return {
    domainId: row.id,
    orgId: publicOrg(row.orgId),
    hostname: row.hostname,
    kind: row.kind,
    status: row.status,
    verified: row.status === "active",
    primary: row.primaryOf !== null
  }
}

async function getPrimary(context: Context, input: { orgId: string | null }): Promise<Domain | null> {
  const row = await context.db.findOne<DomainRow>({
    model: domainModel,
    where: [{ field: "primaryOf", value: input.orgId ?? "" }]
  })
  return row ? toDomain(row) : null
}

/**
 * A domain's scheduled check, from its `check.scheduled` event: skipped when a newer schedule replaced it, passed on to
 * the next delivery run until it's due, then run, scheduling the next one while the domain is still pending.
 */
async function scheduledCheck(config: Config, context: EventContext, data: { domainId: string; token: string }) {
  const { db } = context
  const row = await db.findOne<DomainRow>({ model: domainModel, where: [{ field: "id", value: data.domainId }] })
  if (!row || row.checkToken !== data.token || row.status !== "pending" || !config.provider) {
    return
  }
  const now = new Date()
  if (row.nextCheckAt && row.nextCheckAt.getTime() > now.getTime()) {
    context.emit("check.scheduled", data, { later: true })
    return
  }
  let inspection: Inspection
  try {
    inspection = await inspect(config.provider, config.dns, row)
  } catch (caught) {
    // A provider that can't be reached is retried by the outbox. One that refuses the hostname, such as when it has
    // to create it again, won't change its mind, so the domain fails with its reason.
    if (!(caught instanceof DomainsError) || caught.code === "PROVIDER_ERROR") {
      throw caught
    }
    inspection = {
      providerId: row.providerId,
      status: "failed",
      certificate: row.certificate,
      records: row.records ?? [],
      error: caught.message
    }
  }
  const update = checkedFields(context, row, inspection, now, {
    attempts: row.attempts + 1,
    checkingSince: row.checkingSince ?? row.createdAt,
    token: data.token
  })
  // Saved only while this schedule is still the domain's, so a check that raced "check now" doesn't undo it.
  const [updated] = await db.batch([
    {
      type: "update",
      model: domainModel,
      where: [
        { field: "id", value: row.id },
        { field: "checkToken", value: data.token }
      ],
      update
    }
  ])
  if (updated) {
    await claimPrimary(context, updated as DomainRow)
  }
}

/**
 * Subdomains and custom domains for an app's organizations. Each domain's DNS records are shown and checked, pending
 * custom domains are checked again on a schedule that backs off, and `lookup` says which organization a hostname
 * belongs to.
 */
export function domains<const Options extends DomainsOptions>(options: Options) {
  const config = resolve(options)
  return defineFeature({
    id: "domains",
    schema: domainsSchema,
    events: domainEvents,
    // Scheduled checks are domains' own events, delivered by later `app.deliverEvents()` runs.
    on: {
      domains: {
        "check.scheduled": (event, context) =>
          scheduledCheck(config, context, event.data as { domainId: string; token: string })
      }
    },
    options,
    actions: {
      list: defineAction({
        input: inputs.list,
        handler: (context): Promise<DomainList> => list(config, context, context.input ?? {})
      }),
      add: defineAction({
        input: inputs.add,
        handler: (context): Promise<Domain> => add(config, context, context.input)
      }),
      check: defineAction({
        input: inputs.domain,
        handler: (context): Promise<Domain> => check(config, context, context.input)
      }),
      remove: defineAction({
        input: inputs.domain,
        handler: (context): Promise<{ removed: boolean }> => remove(config, context, context.input)
      }),
      setPrimary: defineAction({
        input: inputs.setPrimary,
        handler: (context): Promise<{ primary: Domain | null }> => setPrimary(config, context, context.input)
      }),
      lookup: defineAction({
        input: inputs.lookup,
        serverOnly: true,
        handler: (context): Promise<HostnameMatch | null> => lookup(context, context.input)
      }),
      getPrimary: defineAction({
        input: inputs.getPrimary,
        serverOnly: true,
        handler: (context): Promise<Domain | null> => getPrimary(context, context.input)
      })
    }
  })
}

/** The domains feature as `domains()` returns it. */
export type DomainsFeature<Options extends DomainsOptions = DomainsOptions> = ReturnType<typeof domains<Options>>
