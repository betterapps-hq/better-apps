import {
  defineAction,
  defineFeature,
  type ActionContext,
  type Actor,
  type DatabaseAdapter,
  type WriteOperation
} from "better-apps"
import { z } from "zod"
import { announce, claimPrimary, removeDomain, runCheck, scheduledCheck, type ScheduledCheck } from "./checking.js"
import { checkCooldownMs, nextCheckAt, ownershipRecord, proveError, unchecked } from "./checks.js"
import { limits, resolve, type Config } from "./config.js"
import { DomainsError } from "./errors.js"
import { domainEvents } from "./events.js"
import {
  customHostnameProblem,
  labelProblem,
  maxHostnameLength,
  normalizeHostname,
  normalizeLabel
} from "./hostname.js"
import type { AddDomainInput, DomainInput, DomainsOptions, SetPrimaryInput } from "./options.js"
import type { HostnameProvider } from "./provider.js"
import { publicOrg, summary, toDomain, type Domain } from "./rows.js"
import { domainModel, domainsSchema, type DomainKind, type DomainRow, type DomainStatus } from "./schema.js"

export { limits } from "./config.js"
export type { Domain } from "./rows.js"

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

type Context = ActionContext<unknown>

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
  org: z.object({ orgId: z.string().max(200).nullable() })
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
  const problem = customHostnameProblem(hostname, config.subdomains?.zone ?? null, config.provider.zone ?? null)
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

/**
 * Why a hostname can't be added, or `null`: the organization already added it, or another holds the subdomain. A custom
 * domain another organization added doesn't stop it, since the one that proves it owns the hostname takes it.
 */
async function conflictOf(db: DatabaseAdapter, orgId: string, hostname: string, kind: DomainKind) {
  const own = await db.findOne({
    model: domainModel,
    where: [
      { field: "orgId", value: orgId },
      { field: "hostname", value: hostname }
    ]
  })
  if (own) {
    return "Your organization already added that domain."
  }
  if (kind === "subdomain") {
    const holder = await db.findOne({ model: domainModel, where: [{ field: "claimedHostname", value: hostname }] })
    if (holder) {
      return "That subdomain is taken."
    }
  }
  return null
}

/** Writes a new domain, answering `CONFLICT` when another add of the hostname got there first. */
async function insert(db: DatabaseAdapter, row: DomainRow): Promise<DomainRow> {
  try {
    const [created] = await db.batch([{ type: "create", model: domainModel, data: row }])
    return created as DomainRow
  } catch (caught) {
    const conflict = await conflictOf(db, row.orgId, row.hostname, row.kind)
    if (conflict) {
      throw new DomainsError("CONFLICT", conflict, { cause: caught })
    }
    throw caught
  }
}

/** A custom domain's ownership token: random, so only someone who can add records for the hostname can prove it. */
const ownershipToken = () => crypto.randomUUID().replaceAll("-", "")

async function add(config: Config, context: Context, input: AddDomainInput): Promise<Domain> {
  const orgId = await managedOrg(config, context, input)
  const { db, now } = context
  const hostname = hostnameFor(config, input)
  await checkLimits(config, db, orgId, input.kind)
  const conflict = await conflictOf(db, orgId, hostname, input.kind)
  if (conflict) {
    throw new DomainsError("CONFLICT", conflict)
  }
  const id = crypto.randomUUID()
  const createdBy = context.author?.type === "user" ? context.author.userId : null
  const base = { id, orgId, hostname, kind: input.kind, primaryOf: null, attempts: 0, createdAt: now, createdBy }
  if (input.kind === "subdomain") {
    const row: DomainRow = {
      ...base,
      claimedHostname: hostname,
      ownershipToken: null,
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
    // A create either commits with its events or fails without them.
    context.emit("domain.added", { domain: summary(row) })
    return toDomain(await claimPrimary(context, await insert(db, row)))
  }
  const provider = config.provider as HostnameProvider
  const ownership = ownershipRecord(config.ownershipLabel, hostname, ownershipToken())
  const token = crypto.randomUUID()
  const firstCheck = nextCheckAt(0, now)
  const row: DomainRow = {
    ...base,
    claimedHostname: null,
    ownershipToken: ownership.value,
    status: "pending",
    certificate: "pending",
    records: unchecked([...provider.routing(hostname), ownership]),
    providerId: null,
    error: proveError(ownership.name),
    checkToken: token,
    checkingSince: now,
    nextCheckAt: firstCheck,
    lastCheckedAt: null,
    verifiedAt: null
  }
  // Nothing is checked yet: the ownership record's token is new, so no DNS holds it. The first scheduled check is
  // written with the domain, so it's never left without one.
  context.emit("domain.added", { domain: summary(row) })
  context.emit("check.scheduled", { domainId: id, token, dueAt: firstCheck.toISOString() }, { later: true })
  return toDomain(await insert(db, row))
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
  // Checking now starts the schedule over, so an older schedule's next event stops.
  const saved = await runCheck(
    config,
    context,
    row,
    now,
    { attempts: 0, checkingSince: now, token: crypto.randomUUID() },
    []
  )
  if (saved) {
    return toDomain(saved)
  }
  return toDomain(await requireDomain(db, orgId, row.id))
}

async function remove(config: Config, context: Context, input: DomainInput): Promise<{ removed: boolean }> {
  const orgId = await managedOrg(config, context, input)
  const row = await findDomain(context.db, orgId, input.domainId)
  return { removed: row !== null && (await removeDomain(config, context, row)) }
}

async function removeAll(config: Config, context: Context, input: { orgId: string | null }) {
  const rows = await context.db.findMany<DomainRow>({
    model: domainModel,
    where: [{ field: "orgId", value: input.orgId ?? "" }],
    limit: limits.maxPerOrgCap
  })
  let removed = 0
  for (const row of rows) {
    if (await removeDomain(config, context, row)) {
      removed += 1
    }
  }
  return { removed }
}

async function setPrimary(
  config: Config,
  context: Context,
  input: SetPrimaryInput
): Promise<{ primary: Domain | null }> {
  const orgId = await managedOrg(config, context, input)
  const { db } = context
  const clear: WriteOperation = {
    type: "updateMany",
    model: domainModel,
    where: [{ field: "primaryOf", value: orgId }],
    update: { primaryOf: null }
  }
  const cleared = [["primary.changed", { orgId: publicOrg(orgId), domain: null }] as const]
  if (input.domainId === null) {
    const [count] = await db.batch([clear])
    await announce(context, (count as number) > 0 ? cleared : [])
    return { primary: null }
  }
  const row = await requireDomain(db, orgId, input.domainId)
  if (row.primaryOf !== null) {
    return { primary: toDomain(row) }
  }
  if (row.status !== "active") {
    throw new DomainsError("CONFLICT", "Only a domain that’s ready can be primary.")
  }
  let results: unknown[]
  try {
    results = await db.batch([
      clear,
      {
        type: "update",
        model: domainModel,
        where: [
          { field: "id", value: row.id },
          { field: "status", value: "active" }
        ],
        update: { primaryOf: orgId }
      }
    ])
  } catch (caught) {
    throw new DomainsError("CONFLICT", "The primary domain just changed. Try again.", { cause: caught })
  }
  const [count, updated] = results as [number, DomainRow | null]
  if (!updated) {
    // The domain was removed or stopped being ready meanwhile, so the batch only cleared the old primary.
    await announce(context, count > 0 ? cleared : [])
    throw new DomainsError("CONFLICT", "That domain just changed. Check its status, then try again.")
  }
  await announce(context, [["primary.changed", { orgId: publicOrg(orgId), domain: summary(updated) }]])
  return { primary: toDomain(updated) }
}

async function lookup(context: Context, input: { hostname: string }): Promise<HostnameMatch | null> {
  const hostname = normalizeHostname(input.hostname, { allowPort: true })
  if (hostname === null) {
    return null
  }
  const row = await context.db.findOne<DomainRow>({
    model: domainModel,
    where: [{ field: "claimedHostname", value: hostname }]
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
 * Subdomains and custom domains for an app's organizations. A custom domain is taken by the organization that proves it
 * owns it with a TXT record, its records are shown and checked, it's checked again on a schedule that backs off while
 * pending and daily once active, and `lookup` says which organization a hostname belongs to.
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
        "check.scheduled": (event, context) => scheduledCheck(config, context, event.data as ScheduledCheck)
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
        input: inputs.org,
        serverOnly: true,
        handler: (context): Promise<Domain | null> => getPrimary(context, context.input)
      }),
      removeAll: defineAction({
        input: inputs.org,
        serverOnly: true,
        handler: (context): Promise<{ removed: number }> => removeAll(config, context, context.input)
      })
    }
  })
}

/** The domains feature as `domains()` returns it. */
export type DomainsFeature<Options extends DomainsOptions = DomainsOptions> = ReturnType<typeof domains<Options>>
