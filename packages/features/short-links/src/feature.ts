import {
  defineAction,
  defineFeature,
  defineRoute,
  type ActionContext,
  type Actor,
  type EventContext,
  type GrantArgs,
  type GrantCheck,
  type RouteContext,
  type SubjectContext,
  type SubjectGrants,
  type SubjectRef,
  type StandardSchemaV1,
  type Where,
  type WriteOperation
} from "better-apps"
import { z } from "zod"
import {
  clickOf,
  eventSettings,
  grant,
  passed,
  perMinuteLimit,
  sampled,
  type ClickRecord,
  type EventSettings
} from "./activity.js"
import { codeLimits, generateCode, isValidCode, normalizeCode } from "./codes.js"
import { grantCodes, grantCookie, isUnder, reachesHost, type CookieSettings } from "./cookie.js"
import { dayLimits, maxRangeDays, rangeOf, slotOf } from "./days.js"
import { ShortLinksError } from "./errors.js"
import { shortLinkEvents } from "./events.js"
import { isOpen, ownerKey, toLink, type ShortLink } from "./link.js"
import type {
  ClicksByDayInput,
  ClickTotalsInput,
  CreateLinkInput,
  LinkHosts,
  LinkRules,
  LinkSort,
  LinkSource,
  LinkSubject,
  ListLinksInput,
  OwnerType,
  RecordClicksInput,
  ShortLinksOptions,
  SubjectTypeOf,
  UpdateLinkInput
} from "./options.js"
import { clickModel, linkModel, shortLinksSchema, type ClickRow, type LinkRow } from "./schema.js"

/** A page of links, in the order `list` was asked for: newest first, or most opened first with `sort: "clicks"`. */
export interface LinkPage {
  links: ShortLink[]
  /** The cursor for the next page, or `null` on the last one. */
  cursor: string | null
}

/** One link's clicks on each day of a range, in a time zone. */
export interface ClicksByDay {
  /** Every day of the range, in order, including days without clicks. */
  days: { date: string; clicks: number }[]
  /** The clicks over the whole range. */
  total: number
}

/** Links' clicks over a range of days. */
export interface ClickTotals {
  /** The links asked for that the caller manages, by `id`, in the order asked, each with its clicks over the range. */
  links: { id: string; clicks: number }[]
  /** Their clicks together. */
  total: number
}

/** Size limits. */
export const limits = {
  linksPerPage: 20,
  maxLinksPerPage: 50,
  urlLength: 2048,
  /** The longest range clicks are counted over, in days. */
  maxRangeDays,
  /** The most clicks `recordClicks` records in one call. */
  maxRecordedClicks: 500,
  ...codeLimits
} as const

type Context = ActionContext<unknown>

/** Short links' settings, checked once when the feature is created. */
interface Config {
  subjects: Readonly<Record<string, LinkRules>>
  validateUrl: ShortLinksOptions["validateUrl"]
  canManage: ShortLinksOptions["canManage"]
  path: string
  baseUrl: string | undefined
  /** `hosts`, with `baseUrl`, which it needs. */
  hosts: (LinkHosts & { baseUrl: string }) | undefined
  codeLength: number
  cookie: CookieSettings
  notFound: NonNullable<ShortLinksOptions["notFound"]>
  events: EventSettings
  source: LinkSource | undefined
}

/** An http or https URL, with any host, including `127.0.0.1` and `[::1]`. */
// `abort` stops at a value that isn't a URL, so later checks can parse it.
const httpUrl = z.url({ protocol: /^https?$/, abort: true })

/** `baseUrl`: an http or https URL that short URLs can follow with a path, so without credentials, query or fragment. */
const baseUrlSchema = httpUrl.refine((value) => {
  const url = new URL(value)
  // A parsed URL escapes `?` and `#` in its path, so either one in `href` starts a query or a fragment.
  return url.username === "" && url.password === "" && !/[?#]/.test(url.href)
})

const refusedSchemes = new Set(["javascript:", "data:", "vbscript:", "file:"])

const notFoundPage = () =>
  new Response("This link isn't available. It may have been turned off, expired or mistyped.\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" }
  })

function resolve(options: ShortLinksOptions): Config {
  const path = options.path ?? "/s"
  if (!/^(\/[\w\-.~]+)+$/.test(path)) {
    throw new Error(`Short links' path "${path}" must start with / and have no empty segments or trailing /.`)
  }
  const codeLength = options.codeLength ?? codeLimits.defaultLength
  if (!Number.isInteger(codeLength) || codeLength < codeLimits.minGenerated || codeLength > codeLimits.maxGenerated) {
    throw new Error(
      `\`codeLength\` must be a whole number from ${codeLimits.minGenerated} to ${codeLimits.maxGenerated}.`
    )
  }
  let baseUrl: string | undefined
  if (options.baseUrl !== undefined) {
    const parsed = baseUrlSchema.safeParse(options.baseUrl)
    if (!parsed.success) {
      throw new Error(
        `\`baseUrl\` must be an http or https URL without credentials, a query or a fragment, such as https://go.example.com.`
      )
    }
    baseUrl = new URL(parsed.data).href.replace(/\/+$/, "")
  }
  let hosts: Config["hosts"]
  if (options.hosts !== undefined) {
    if (typeof options.hosts.resolve !== "function") {
      throw new Error("`hosts.resolve` must be a function that says whose links a host opens.")
    }
    // An action can be called from an organization's domain, which doesn't open everyone's links.
    if (baseUrl === undefined) {
      throw new Error("Short links with `hosts` need `baseUrl`, the app's own origin, which opens every link.")
    }
    hosts = { ...options.hosts, baseUrl }
  }
  const cookieName = options.cookie?.name ?? "better-apps-links"
  if (!/^[\w\-.]+$/.test(cookieName)) {
    throw new Error(`The cookie name "${cookieName}" may use only letters, digits, _, - and .`)
  }
  const cookieMaxAge = options.cookie?.maxAge ?? 30 * 24 * 60 * 60
  if (!Number.isInteger(cookieMaxAge) || cookieMaxAge <= 0) {
    throw new Error("The cookie's `maxAge` must be a whole number of seconds above 0.")
  }
  const domain = options.cookie?.domain
  if (domain !== undefined) {
    if (!/^\.?([a-z\d-]+\.)*[a-z\d-]+$/i.test(domain)) {
      throw new Error(`The cookie's domain "${domain}" must be a host name, such as example.com.`)
    }
    if (baseUrl !== undefined && !isUnder(new URL(baseUrl).hostname, domain)) {
      throw new Error(`\`baseUrl\`'s host must be under the cookie's domain, "${domain}", or browsers drop the cookie.`)
    }
  }
  const source = options.source
  if (source !== undefined && !/^[\w\-.]{1,64}$/.test(source.param)) {
    throw new Error(`The source parameter "${source.param}" must be 1 to 64 letters, digits, _, - and .`)
  }
  return {
    subjects: options.subjects ?? {},
    validateUrl: options.validateUrl,
    canManage: options.canManage,
    path,
    baseUrl,
    hosts,
    codeLength,
    cookie: { name: cookieName, maxAge: cookieMaxAge, domain },
    notFound: options.notFound ?? notFoundPage,
    events: eventSettings(options.events),
    source
  }
}

/** Where a call's links live on the app's own host: `baseUrl`, or the request's origin, with the path. */
function prefixOf(config: Config, request: Request | null): string {
  return `${config.baseUrl ?? (request ? new URL(request.url).origin : "")}${config.path}`
}

/** The origin `hosts.origin` returned, or the setup error that says it isn't one. */
function originOf(value: string): string {
  const parsed = httpUrl.safeParse(value)
  if (!parsed.success) {
    throw new Error(
      `Short links' \`hosts.origin\` returned "${value}", which isn't an http or https origin, such as https://links.acme.com.`
    )
  }
  return new URL(parsed.data).origin
}

/** Where links' short URLs go within one call. */
interface Prefixer {
  /** The prefix of a link's short URL, such as `https://links.acme.com/s`. */
  of: (row: LinkRow) => Promise<string>
  /** Whether the cookie a link that grants access sets, on the host its short URL uses, reaches the record. */
  reaches: (row: LinkRow) => Promise<boolean>
}

/** Loads each key once, sharing the promise with later asks for the same key. */
function loadOnce<T>(): (key: string, load: () => T | Promise<T>) => Promise<T> {
  const loaded = new Map<string, Promise<T>>()
  return (key, load) => {
    let pending = loaded.get(key)
    if (!pending) {
      pending = Promise.resolve().then(load)
      loaded.set(key, pending)
    }
    return pending
  }
}

/**
 * Where each link's short URL goes in a call: on `hosts.origin`'s host for the link's organization, or the app's own. A
 * person's own link in an organization stays on the app's host, the only one that opens it. A link that grants access
 * also stays there when the cookie it would set on the organization's host can't reach the record. Each organization's
 * origin, and each record's `url`, is asked once per call.
 */
function prefixer(config: Config, request: Request | null): Prefixer {
  const own = prefixOf(config, request)
  const origin = config.hosts?.origin
  const origins = loadOnce<string | null>()
  const urls = loadOnce<string>()
  /** The prefix on the link's organization's host, or `null` without one, or for a person's own link made in one. */
  const sharedOf = async (row: LinkRow): Promise<string | null> => {
    if (!origin || (row.orgId !== "" && row.owner !== ownerKey("org", row.orgId))) {
      return null
    }
    const found = await origins(row.orgId, async () => {
      const value = await origin({ orgId: row.orgId === "" ? null : row.orgId })
      return value === null ? null : originOf(value)
    })
    return found === null ? null : `${found}${config.path}`
  }
  /**
   * Whether a link under `prefix` that grants access sets a cookie that reaches its record. Without a whole prefix,
   * which actions called without a request or `baseUrl` have, there's no host to tell from, so it's taken to reach.
   */
  const reachesFrom = async (row: LinkRow, prefix: string): Promise<boolean> => {
    const rules = rulesFor(config, row.subjectType)
    const { subjectType, subjectId } = row
    if (!row.grantsView || !rules || subjectType === null || subjectId === null || !URL.canParse(prefix)) {
      return true
    }
    const link = `${prefix}/${row.code}`
    const orgId = row.orgId === "" ? null : row.orgId
    const path = await urls(JSON.stringify([subjectType, subjectId, row.orgId]), () =>
      rules.url({ subjectType, subjectId, orgId })
    )
    return reachesHost(link, new URL(path, link).href, config.cookie.domain)
  }
  const of = async (row: LinkRow): Promise<string> => {
    const shared = await sharedOf(row)
    return shared !== null && (await reachesFrom(row, shared)) ? shared : own
  }
  return { of, reaches: async (row) => reachesFrom(row, await of(row)) }
}

/** A row as actions return it, with its short URL from `prefix`. */
async function present(prefix: Prefixer, row: LinkRow): Promise<ShortLink> {
  return toLink(row, await prefix.of(row))
}

/** Server code that passes neither an actor nor a request is trusted. It can't make links, since a link is someone's. */
function isTrusted(context: Context): boolean {
  return context.source === "api" && context.actor === null && context.request === null
}

/** How links work on a subject type, or `undefined` for one the feature doesn't have. */
function rulesFor(config: Config, subjectType: string | null): LinkRules | undefined {
  return subjectType !== null && Object.hasOwn(config.subjects, subjectType) ? config.subjects[subjectType] : undefined
}

function rulesOf(config: Config, subjectType: string): LinkRules {
  const rules = rulesFor(config, subjectType)
  if (!rules) {
    throw new ShortLinksError("INVALID_INPUT", `Links can't point to "${subjectType}" records.`)
  }
  return rules
}

/** Whether an actor manages an organization's links. */
async function managesOrg(config: Config, actor: Actor, orgId: string): Promise<boolean> {
  return actor.orgId === orgId && (config.canManage ? (await config.canManage({ actor, orgId })) === true : true)
}

/**
 * Whether the caller manages a link: trusted server code, the owner of a link made outside any organization, or, for a
 * link made in one, a member who owns or made it and the organization's managers.
 */
async function manages(config: Config, context: Context, row: LinkRow): Promise<boolean> {
  if (isTrusted(context)) {
    return true
  }
  const { actor } = context
  if (!actor) {
    return false
  }
  if (row.orgId === "") {
    return row.owner === ownerKey("user", actor.userId)
  }
  // A link made in an organization is managed from inside it, so someone who leaves can't change it any more, and the
  // organization's managers can turn off what they left behind.
  if (actor.orgId !== row.orgId) {
    return false
  }
  return (
    row.owner === ownerKey("user", actor.userId) ||
    row.createdBy === actor.userId ||
    managesOrg(config, actor, row.orgId)
  )
}

const byCode = (code: string): Where[] => [{ field: "code", value: normalizeCode(code) }]

/** A link the caller manages, by its code, or the error that says why not. */
async function requireLink(config: Config, context: Context, code: string): Promise<LinkRow> {
  return requireRow(config, context, byCode(code))
}

/** A link the caller manages, by its id, or the error that says why not. */
async function requireLinkById(config: Config, context: Context, id: string): Promise<LinkRow> {
  return requireRow(config, context, [{ field: "id", value: id }])
}

async function requireRow(config: Config, context: Context, where: Where[]): Promise<LinkRow> {
  const row = await context.db.findOne<LinkRow>({ model: linkModel, where })
  if (row && (await manages(config, context, row))) {
    return row
  }
  if (!context.actor && !isTrusted(context)) {
    throw new ShortLinksError("UNAUTHENTICATED", "Sign in to manage links.")
  }
  throw new ShortLinksError("NOT_FOUND", "That link doesn't exist, or you can't manage it.")
}

/** A URL a link may point to, written the WHATWG URL parser's way, or the error that says why not. */
async function checkUrl(config: Config, raw: string, actor: Actor | null, orgId: string | null): Promise<string> {
  if (!URL.canParse(raw)) {
    throw new ShortLinksError("INVALID_INPUT", "Enter a full URL, such as https://example.com.")
  }
  const url = new URL(raw)
  if (refusedSchemes.has(url.protocol)) {
    throw new ShortLinksError("INVALID_INPUT", `Links can't point to ${url.protocol} URLs.`)
  }
  if (url.href.length > limits.urlLength) {
    throw new ShortLinksError("INVALID_INPUT", `URLs can be up to ${limits.urlLength} characters.`)
  }
  if (config.validateUrl) {
    const verdict = await config.validateUrl({ url, actor, orgId })
    if (verdict !== true) {
      throw new ShortLinksError("INVALID_INPUT", typeof verdict === "string" ? verdict : "That URL isn't allowed here.")
    }
  }
  return url.href
}

/** Refuses an expiry that isn't later than now. */
function checkExpiry(expiresAt: Date | null | undefined): void {
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new ShortLinksError("INVALID_INPUT", "Pick an expiry time in the future.")
  }
}

/** Refuses a link to a record the caller can't see or share. Trusted server code may link to any. */
async function checkSharer(context: Context, rules: LinkRules, ref: SubjectRef): Promise<void> {
  if (isTrusted(context)) {
    return
  }
  const { actor } = context
  if (!actor || !(await context.subjects.canView(actor, ref))) {
    throw new ShortLinksError("NOT_FOUND", "That record doesn't exist, or you can't see it.")
  }
  if (rules.canShare && !(await rules.canShare({ actor, ...ref }))) {
    throw new ShortLinksError("FORBIDDEN", "You can't make links to this.")
  }
}

/**
 * Refuses access through a link the record's rules don't allow: a person `grantView` refuses, a link made in another
 * organization, or one a member owns rather than the record's organization.
 */
async function checkGrant(
  context: Context,
  rules: LinkRules,
  ref: SubjectRef,
  link: Pick<LinkRow, "owner" | "orgId">
): Promise<void> {
  const { actor } = context
  if (!isTrusted(context)) {
    const allowed =
      typeof rules.grantView === "function"
        ? actor !== null && (await rules.grantView({ actor, ...ref })) === true
        : rules.grantView === true
    if (!allowed) {
      throw new ShortLinksError("FORBIDDEN", "You can't let people see this through a link.")
    }
  }
  if (((await context.subjects.getOrgId(ref, actor)) ?? "") !== link.orgId) {
    throw new ShortLinksError("INVALID_INPUT", "Only links made in the record's organization can let people see it.")
  }
  if (link.orgId !== "" && link.owner !== ownerKey("org", link.orgId)) {
    throw new ShortLinksError("INVALID_INPUT", "Only your organization's links can let people see its records.")
  }
}

/**
 * Refuses a link that would grant access from a host whose cookie can't reach the record, since the grant would fail
 * without a word. The link is shared on its organization's host when the cookie reaches the record from there, and on
 * the app's own host otherwise.
 */
async function checkReach(prefixes: Prefixer, fields: Omit<LinkRow, "id" | "code">): Promise<void> {
  if (fields.grantsView && !(await prefixes.reaches({ id: "", code: "", ...fields }))) {
    throw new ShortLinksError(
      "INVALID_INPUT",
      "Links can't let people see this record, since its page is on a domain they can't give access to."
    )
  }
}

/** Whether two expiries are the same, where `null` is never. */
function sameTime(a: Date | null, b: Date | null): boolean {
  return a === null || b === null ? a === b : a.getTime() === b.getTime()
}

/**
 * Schedules `link.expired` for a link's expiry, held by the outbox until then, in the batch that saves the expiry. Its
 * token is the link's, so changing or clearing the expiry, or removing the link, leaves it doing nothing.
 */
function scheduleExpiry(context: Context, row: Pick<LinkRow, "id" | "expiresAt" | "expiryToken">): void {
  if (row.expiresAt !== null && row.expiryToken !== null) {
    context.emit("expiry.scheduled", { linkId: row.id, token: row.expiryToken }, { availableAt: row.expiresAt })
  }
}

/** What an `expiry.scheduled` event carries. */
interface ScheduledExpiry {
  linkId: string
  token: string
}

/**
 * A link's scheduled expiry, from its `expiry.scheduled` event: `link.expired`, unless the link is gone or its expiry
 * changed since. The token is cleared in the batch that writes the event, so a retried delivery emits it once. It's
 * emitted whether or not the link is on.
 */
async function expire(config: Config, context: EventContext, data: ScheduledExpiry): Promise<void> {
  const byId: Where = { field: "id", value: data.linkId }
  const row = await context.db.findOne<LinkRow>({ model: linkModel, where: [byId] })
  if (!row || row.expiryToken !== data.token || row.expiresAt === null) {
    return
  }
  if (row.expiresAt.getTime() > Date.now()) {
    // Delivered early, such as by a run whose clock is behind the one that wrote it: wait for the expiry.
    context.emit("expiry.scheduled", data, { availableAt: row.expiresAt })
    return
  }
  context.emit("link.expired", { link: await present(prefixer(config, null), row) })
  await context.db.batch([
    {
      type: "update",
      model: linkModel,
      where: [byId, { field: "expiryToken", value: data.token }],
      update: { expiryToken: null }
    }
  ])
}

/** Whether `next` is later than `current`, where `null` is never. */
function isLater(next: Date | null, current: Date | null): boolean {
  if (next === null) {
    return current !== null
  }
  return current !== null && next.getTime() > current.getTime()
}

const subjectType = z.string().min(1).max(255)
const subjectId = z.string().min(1).max(255)
const code = z.string().min(1).max(limits.maxCode)
const linkId = z.string().min(1).max(255)
const url = z.string().min(1).max(limits.urlLength)
const owner = z.enum(["user", "org"])
const date = z.coerce.date()
const subject = z.object({ subjectType, subjectId })
const days = {
  from: z.string().min(1).max(10),
  to: z.string().min(1).max(10),
  timeZone: z.string().min(1).max(64).optional()
}
const inputs = {
  create: z.object({
    target: z.union([z.object({ url }).strict(), subject.strict()]),
    code: code.optional(),
    owner: owner.optional(),
    grantsView: z.boolean().optional(),
    expiresAt: date.optional()
  }),
  code: z.object({ code }),
  list: z.object({
    subjectType: subjectType.optional(),
    subjectId: subjectId.optional(),
    owner: owner.optional(),
    sort: z.enum(["newest", "clicks"]).optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(limits.maxLinksPerPage).optional()
  }),
  update: z.object({
    code,
    url: url.optional(),
    grantsView: z.literal(false).optional(),
    enabled: z.boolean().optional(),
    expiresAt: date.nullable().optional()
  }),
  subject,
  removeOwner: z.object({ owner: z.object({ type: owner, id: z.string().min(1).max(255) }) }),
  clicksByDay: z.object({ id: linkId, ...days }),
  clickTotals: z.object({ ids: z.array(linkId).min(1).max(limits.maxLinksPerPage), ...days }),
  recordClicks: z.object({ id: linkId, at: z.array(date).min(1).max(limits.maxRecordedClicks) })
}

type Parsed<Input> = Omit<Input, "expiresAt"> & { expiresAt?: Date | null | undefined }

async function create(config: Config, context: Context): Promise<ShortLink> {
  const input = context.input as Parsed<CreateLinkInput>
  const { actor } = context
  if (!actor) {
    throw new ShortLinksError("UNAUTHENTICATED", "Sign in to make links.")
  }
  const manager = actor.orgId !== null && (await managesOrg(config, actor, actor.orgId))
  // Inside an organization, a manager's links and links that grant access are the organization's by default, and
  // other links their maker's.
  const ownerType: OwnerType =
    input.owner ?? (actor.orgId !== null && (manager || input.grantsView === true) ? "org" : "user")
  if (ownerType === "org") {
    if (actor.orgId === null) {
      throw new ShortLinksError("INVALID_INPUT", "You're not in an organization, so the link can only be yours.")
    }
    // A member who may share a record can make the organization's link to it. Other links need a manager.
    if (!manager && "url" in input.target) {
      throw new ShortLinksError("FORBIDDEN", "You can't make links for your organization.")
    }
  }
  const orgId = actor.orgId ?? ""
  if (input.code !== undefined && !isValidCode(input.code)) {
    throw new ShortLinksError("INVALID_INPUT", "Codes are 1 to 64 letters, digits, - and _.")
  }
  const chosen = input.code === undefined ? undefined : normalizeCode(input.code)
  // The code is all it takes to see the record, so a link that grants access always has a long random part.
  const chosenLimit = codeLimits.maxCode - codeLimits.granting - 1
  if (input.grantsView && chosen !== undefined && chosen.length > chosenLimit) {
    throw new ShortLinksError(
      "INVALID_INPUT",
      `Codes of links that let people see a record are up to ${chosenLimit} characters, before the random part.`
    )
  }
  checkExpiry(input.expiresAt)
  const owner = ownerKey(ownerType, ownerType === "org" ? orgId : actor.userId)
  const prefixes = prefixer(config, context.request)
  let target: Pick<LinkRow, "url" | "subjectType" | "subjectId">
  if ("url" in input.target) {
    if (input.grantsView) {
      throw new ShortLinksError("INVALID_INPUT", "Only links to records can let people see them.")
    }
    target = { url: await checkUrl(config, input.target.url, actor, actor.orgId), subjectType: null, subjectId: null }
  } else {
    const ref = { subjectType: input.target.subjectType, subjectId: input.target.subjectId }
    const rules = rulesOf(config, ref.subjectType)
    await checkSharer(context, rules, ref)
    const recordOrg = (await context.subjects.getOrgId(ref, actor)) ?? ""
    if (ownerType === "org" && recordOrg !== "" && recordOrg !== orgId) {
      throw new ShortLinksError("INVALID_INPUT", "Your organization's links can only point to its own records.")
    }
    if (input.grantsView) {
      await checkGrant(context, rules, ref, { owner, orgId })
    }
    target = { url: null, ...ref }
  }
  const random = chosen === undefined || input.grantsView === true
  const codeFor = (): string => {
    if (!input.grantsView) {
      return chosen ?? generateCode(config.codeLength)
    }
    return chosen === undefined
      ? generateCode(Math.max(config.codeLength, codeLimits.granting))
      : `${chosen}-${generateCode(codeLimits.granting)}`
  }
  const fields: Omit<LinkRow, "id" | "code"> = {
    owner,
    orgId,
    createdBy: actor.userId,
    ...target,
    grantsView: input.grantsView === true,
    enabled: true,
    expiresAt: input.expiresAt ?? null,
    expiryToken: input.expiresAt ? crypto.randomUUID() : null,
    clicks: 0,
    lastClickedAt: null,
    createdAt: context.now,
    updatedAt: context.now
  }
  await checkReach(prefixes, fields)
  // A code with a random part that's taken is replaced, up to three times. A taken code is told apart from other failed
  // writes by reading it back.
  for (let attempt = 1; ; attempt += 1) {
    const row: LinkRow = { id: crypto.randomUUID(), code: codeFor(), ...fields }
    const link = await present(prefixes, row)
    context.emit("link.created", { link })
    scheduleExpiry(context, row)
    try {
      await context.db.batch([{ type: "create", model: linkModel, data: row }])
      return link
    } catch (error) {
      if (!(await context.db.findOne({ model: linkModel, where: byCode(row.code), select: ["id"] }))) {
        throw error
      }
      if (!random) {
        throw new ShortLinksError("CONFLICT", "That code is taken. Try another.", { cause: error })
      }
      if (attempt >= 3) {
        throw new ShortLinksError("CONFLICT", "No free code was found. Try again.", { cause: error })
      }
    }
  }
}

async function get(config: Config, context: Context): Promise<ShortLink> {
  const { code: wanted } = context.input as { code: string }
  return present(prefixer(config, context.request), await requireLink(config, context, wanted))
}

/** The sort keys of each order, the first ones first. */
const sortKeys: Record<LinkSort, readonly ("clicks" | "createdAt" | "id")[]> = {
  newest: ["createdAt", "id"],
  clicks: ["clicks", "createdAt", "id"]
}

/** The largest click count a cursor carries: the most a 32-bit integer column, as `clicks` is in most schemas, holds. */
const maxClicks = 2_147_483_647

/** A cursor after a row: its values of the order's sort keys. */
function encodeCursor(row: LinkRow, sort: LinkSort): string {
  const values = sortKeys[sort].map((key) => (key === "createdAt" ? row.createdAt.toISOString() : row[key]))
  return btoa(JSON.stringify(values)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function decodeCursor(cursor: string, sort: LinkSort): Partial<Pick<LinkRow, "clicks" | "createdAt" | "id">> {
  try {
    const values = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/"))) as unknown[]
    const keys = sortKeys[sort]
    const [clicks, time, id] = keys.length === 3 ? values : [0, ...values]
    const createdAt = new Date(String(time))
    const year = createdAt.getUTCFullYear()
    // Values every database takes, so a tampered cursor fails here rather than in the query: clicks within a 32-bit
    // integer column, a date within years 1 to 9999, and an id of printable characters.
    if (
      Array.isArray(values) &&
      values.length === keys.length &&
      Number.isInteger(clicks) &&
      (clicks as number) >= 0 &&
      (clicks as number) <= maxClicks &&
      typeof time === "string" &&
      year >= 1 &&
      year <= 9999 &&
      typeof id === "string" &&
      /^[!-~]{1,255}$/.test(id)
    ) {
      return keys.length === 3 ? { clicks: clicks as number, createdAt, id } : { createdAt, id }
    }
  } catch {
    // Reported below.
  }
  throw new ShortLinksError("INVALID_INPUT", "That page cursor isn't valid.")
}

async function list(config: Config, context: Context): Promise<LinkPage> {
  const input = context.input as ListLinksInput
  if ((input.subjectType === undefined) !== (input.subjectId === undefined)) {
    throw new ShortLinksError("INVALID_INPUT", "Pass both `subjectType` and `subjectId` to list a record's links.")
  }
  const where: Where[] = []
  if (input.subjectType !== undefined && input.subjectId !== undefined) {
    where.push({ field: "subjectType", value: input.subjectType }, { field: "subjectId", value: input.subjectId })
  }
  const { actor } = context
  if (!isTrusted(context)) {
    if (!actor) {
      throw new ShortLinksError("UNAUTHENTICATED", "Sign in to see your links.")
    }
    // Lists hold the links the caller manages: those made in their organization, and their own made outside any. A link
    // made outside any organization is always its maker's, so owning or making it is the same there.
    const scope = actor.orgId ?? ""
    const manager = actor.orgId !== null && (await managesOrg(config, actor, actor.orgId))
    const mine: Where = { field: "owner", value: ownerKey("user", actor.userId) }
    const made: Where = { field: "createdBy", value: actor.userId }
    if (input.owner === "org") {
      if (scope === "") {
        return { links: [], cursor: null }
      }
      where.push({ field: "owner", value: ownerKey("org", scope) }, ...(manager ? [] : [made]))
    } else {
      where.push({ field: "orgId", operator: "in", value: [...new Set([scope, ""])] })
      if (input.owner === "user") {
        where.push(mine)
      } else {
        // A manager sees every link made in the organization. Others see the ones they own or made.
        where.push(
          { ...mine, connector: "OR" },
          { ...made, connector: "OR" },
          ...(manager ? [{ field: "orgId", value: scope, connector: "OR" } satisfies Where] : [])
        )
      }
    }
  } else if (where.length === 0) {
    throw new ShortLinksError("INVALID_INPUT", "Server code without an actor lists one record's links at a time.")
  }
  const limit = input.limit ?? limits.linksPerPage
  const sort = input.sort ?? "newest"
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor, sort)
  const rows = await context.db.findMany<LinkRow>({
    model: linkModel,
    where,
    sortBy: sortKeys[sort].map((field) => ({ field, direction: "desc" as const })),
    after,
    limit: limit + 1
  })
  const page = rows.slice(0, limit)
  const prefix = prefixer(config, context.request)
  const last = page.at(-1)
  return {
    links: await Promise.all(page.map(async (row) => present(prefix, row))),
    cursor: rows.length > limit && last ? encodeCursor(last, sort) : null
  }
}

async function update(config: Config, context: Context): Promise<ShortLink> {
  const input = context.input as Parsed<UpdateLinkInput>
  const row = await requireLink(config, context, input.code)
  const changes: Partial<LinkRow> = { updatedAt: context.now }
  if (input.url !== undefined) {
    if (row.url === null) {
      throw new ShortLinksError("INVALID_INPUT", "Only links to a URL can change where they go.")
    }
    changes.url = await checkUrl(config, input.url, context.actor, row.orgId === "" ? null : row.orgId)
  }
  if (input.grantsView === false) {
    changes.grantsView = false
  }
  if (input.enabled !== undefined) {
    changes.enabled = input.enabled
  }
  if (input.expiresAt !== undefined && !sameTime(input.expiresAt, row.expiresAt)) {
    checkExpiry(input.expiresAt)
    changes.expiresAt = input.expiresAt
    // A new token, so the old expiry's scheduled event does nothing.
    changes.expiryToken = input.expiresAt ? crypto.randomUUID() : null
  }
  // A link that lets people see a record, turned back on or given longer, is checked again as if it were made now, so
  // someone who has since lost access to the record, or left its organization, can't reopen it.
  const reopens =
    (input.enabled === true && !row.enabled) ||
    (input.expiresAt !== undefined && isLater(input.expiresAt, row.expiresAt))
  const grants = (changes.grantsView ?? row.grantsView) && (changes.enabled ?? row.enabled)
  if (grants && reopens && row.subjectType !== null && row.subjectId !== null) {
    const ref = { subjectType: row.subjectType, subjectId: row.subjectId }
    const rules = rulesOf(config, ref.subjectType)
    await checkSharer(context, rules, ref)
    await checkGrant(context, rules, ref, row)
  }
  const link = await present(prefixer(config, context.request), { ...row, ...changes })
  context.emit("link.updated", { link })
  if (changes.expiryToken !== undefined) {
    scheduleExpiry(context, { ...row, ...changes })
  }
  const [updated] = await context.db.batch([
    { type: "update", model: linkModel, where: [{ field: "id", value: row.id }], update: changes }
  ])
  if (!updated) {
    throw new ShortLinksError("NOT_FOUND", "That link doesn't exist, or you can't manage it.")
  }
  return link
}

async function remove(config: Config, context: Context): Promise<{ removed: boolean }> {
  const { code: wanted } = context.input as { code: string }
  const row = await requireLink(config, context, wanted)
  context.emit("link.removed", { link: await present(prefixer(config, context.request), row) })
  const [removed] = await context.db.batch([
    { type: "deleteMany", model: linkModel, where: [{ field: "id", value: row.id }] }
  ])
  return { removed: removed === 1 }
}

async function removeSubject(_config: Config, context: Context): Promise<{ removed: number }> {
  const { subjectType: type, subjectId: id } = context.input as LinkSubject
  // The event is written in the same batch as the delete, so neither happens without the other.
  context.emit("subject.removed", { subjectType: type, subjectId: id })
  const [removed] = await context.db.batch([
    {
      type: "deleteMany",
      model: linkModel,
      where: [
        { field: "subjectType", value: type },
        { field: "subjectId", value: id }
      ]
    }
  ])
  return { removed: typeof removed === "number" ? removed : 0 }
}

async function removeOwner(_config: Config, context: Context): Promise<{ removed: number }> {
  const { owner: who } = context.input as { owner: { type: OwnerType; id: string } }
  context.emit("owner.removed", { owner: { type: who.type, id: who.id } })
  const [removed] = await context.db.batch([
    { type: "deleteMany", model: linkModel, where: [{ field: "owner", value: ownerKey(who.type, who.id) }] }
  ])
  return { removed: typeof removed === "number" ? removed : 0 }
}

/**
 * The organization whose links a request's host opens, `""` for the app's own host, which opens every link, or `null`
 * for a host that opens none. Every host opens every link without `hosts`. The host is the request URL's, without a
 * trailing dot, so `acme.com.` is `acme.com`.
 */
async function scopeOf(config: Config, request: Request, url: URL): Promise<string | null> {
  if (!config.hosts) {
    return ""
  }
  const host = await config.hosts.resolve({ hostname: url.hostname.replace(/\.$/, ""), request })
  if (host === "app") {
    return ""
  }
  return typeof host?.orgId === "string" && host.orgId !== "" ? host.orgId : null
}

/** What opening links keeps between requests: how many `link.notFound` events each host emitted this minute. */
interface Opener {
  allowNotFound: (host: string, now: Date) => boolean
}

/**
 * Opens a link: one read by its code, then a temporary redirect, so a link turned off or changed takes effect at once.
 * On an organization's domain, only its own links open. A link that grants access adds its code to the visitor's
 * cookie. The click, and the events about it, are written after the response, and only for `GET`.
 */
async function open(config: Config, opener: Opener, context: RouteContext): Promise<Response> {
  const { request, params, db, now, emit } = context
  const wanted = params.code ?? ""
  const counted = request.method === "GET"
  const host = context.url.hostname.replace(/\.$/, "")
  // A host that opens no links, and another organization's link, answer as a missing link does, so a domain tells
  // nothing about the codes it doesn't open.
  const scope = await scopeOf(config, request, context.url)
  if (scope === null) {
    return config.notFound({ request, code: wanted })
  }
  /** The missing link's answer, with `link.notFound`, which is the same whatever kept the code from opening. */
  const missing = () => {
    if (counted && opener.allowNotFound(host, now)) {
      const code = wanted.slice(0, limits.maxCode)
      emit("link.notFound", { host, orgId: scope === "" ? null : scope, code, requestedAt: now })
    }
    return config.notFound({ request, code: wanted })
  }
  const row = isValidCode(wanted) ? await db.findOne<LinkRow>({ model: linkModel, where: byCode(wanted) }) : null
  if (!row || !isOpen(row, now) || (scope !== "" && row.owner !== ownerKey("org", scope))) {
    return missing()
  }
  let location = row.url
  if (location === null) {
    const { subjectType: type, subjectId: id } = row
    // A record link of a subject type the feature no longer has opens nothing.
    const rules = rulesFor(config, type)
    if (!rules || type === null || id === null) {
      return missing()
    }
    const path = await rules.url({ subjectType: type, subjectId: id, orgId: row.orgId === "" ? null : row.orgId })
    location = new URL(path, request.url).href
  }
  /** Emits `link.clicked` for the opens `events.clickRate` samples. */
  const clicked = (click: ClickRecord) => {
    if (sampled(config.events)) {
      emit("link.clicked", { ...click, sampleRate: config.events.clickRate })
    }
  }
  const headers = new Headers({
    location: await withSource(config, row, location),
    "cache-control": "private, no-store"
  })
  let outcome: ClickRecord["outcome"] = "opened"
  if (row.grantsView) {
    if (config.hosts && !reachesHost(request.url, location, config.cookie.domain)) {
      // The cookie set on this host wouldn't reach the record, so the link opens where it does: on the app's own host,
      // which opens every link, or else on the record's host. Neither is this host. The click counts there.
      const app = `${config.hosts.baseUrl}${config.path}`
      const code = encodeURIComponent(row.code)
      const there = reachesHost(app, location, config.cookie.domain)
        ? `${app}/${code}`
        : new URL(`${config.path}/${code}`, location).href
      if (counted) {
        clicked(clickOf(row, request, host, now, { outcome: "hopped", forwardedTo: new URL(there).host }))
      }
      return new Response(null, { status: 302, headers: { location: there, "cache-control": "private, no-store" } })
    }
    outcome = "granted"
    // A visitor whose cookie already holds the link was given access before.
    const fresh = !grantCodes(request, config.cookie.name).includes(row.code)
    headers.set("set-cookie", grantCookie(request, config.cookie, row.code))
    const event = counted && fresh ? grant(row, host, now) : null
    if (event) {
      emit("link.granted", event)
    }
  }
  if (counted) {
    const click = clickOf(row, request, host, now, { outcome, forwardedTo: null })
    clicked(click)
    context.waitUntil(countClick(config, context, row, click))
  }
  return new Response(null, { status: 302, headers })
}

/**
 * Counts a click and writes its row, in one batch with the events the open emitted, then emits `link.milestone` for each milestone the
 * count passed. Each count comes back from one click's increment alone, so each milestone is emitted once, however
 * many clicks land at the same moment.
 */
async function countClick(config: Config, context: RouteContext, row: LinkRow, click: ClickRecord): Promise<void> {
  // The counter's increment comes first, so its result, the new count, is the batch's first.
  const [counted] = await context.db.batch(clickWrites(row.id, [click.clickedAt], click.clickedAt))
  const updated = counted as LinkRow | null
  if (!updated) {
    return
  }
  const reached = passed(config.events, updated.clicks - 1, updated.clicks)
  if (reached.length > 0) {
    const link = await present(prefixer(config, context.request), updated)
    for (const clicks of reached) {
      context.emit("link.milestone", { link, clicks })
    }
  }
}

/**
 * The address a link redirects to, with its code in `source.param`, so the page knows which link opened it. Links that
 * grant access carry it only with `source.grants`, since their code is all it takes to see the record. Links to web
 * addresses carry it only where `source.urls` allows, and only to http and https ones. The rest of the query stays as
 * it was written, since servers differ in how they read `+`, `;` and bare names.
 */
async function withSource(config: Config, row: LinkRow, location: string): Promise<string> {
  const { source } = config
  if (!source || (row.grantsView && source.grants !== true)) {
    return location
  }
  const url = new URL(location)
  if (row.url !== null) {
    const allowed =
      (url.protocol === "https:" || url.protocol === "http:") &&
      (typeof source.urls === "function"
        ? (await source.urls({ url: new URL(location) })) === true
        : source.urls === true)
    if (!allowed) {
      return location
    }
  }
  const kept = url.search
    .slice(1)
    .split("&")
    .filter((pair) => pair !== "" && pair.split("=")[0] !== source.param)
  url.search = [...kept, `${source.param}=${encodeURIComponent(row.code)}`].join("&")
  return url.href
}

/**
 * Records clicks on a link, in one batch: its counter and last click, then a row per click, so the counter and the rows
 * always agree. The adapter splits the rows into statements under the database's limit of bound parameters.
 */
function clickWrites(linkId: string, times: readonly Date[], lastClickedAt: Date): WriteOperation[] {
  const rows: ClickRow[] = times.map((clickedAt) => ({
    id: crypto.randomUUID(),
    linkId,
    clickedAt,
    slot: slotOf(clickedAt)
  }))
  return [
    {
      type: "incrementOne",
      model: linkModel,
      where: [{ field: "id", value: linkId }],
      increment: { clicks: times.length },
      set: { lastClickedAt }
    },
    { type: "createMany", model: clickModel, data: rows }
  ]
}

/** A link's clicks on each day of a range, in the range's time zone, in one query. */
async function clicksByDay(config: Config, context: Context): Promise<ClicksByDay> {
  const input = context.input as ClicksByDayInput
  const row = await requireLinkById(config, context, input.id)
  const range = rangeOf(input)
  // Each 15-minute slot falls on one day in every zone, so the slots' counts add up to each day's.
  const groups = await context.db.countGroups({
    model: clickModel,
    where: [{ field: "linkId", value: row.id }, ...within(range)],
    groupBy: ["slot"]
  })
  const counts = new Map(range.dates.map((date) => [date, 0]))
  for (const { group, count } of groups) {
    const date = range.zone.dateOf(new Date(group.slot as Date).getTime())
    const current = counts.get(date)
    if (current !== undefined) {
      counts.set(date, current + count)
    }
  }
  const days = [...counts].map(([date, clicks]) => ({ date, clicks }))
  return { days, total: days.reduce((sum, day) => sum + day.clicks, 0) }
}

/** Clicks in a range of days. */
function within(range: { start: Date; end: Date }): Where[] {
  return [
    { field: "slot", operator: "gte", value: range.start },
    { field: "slot", operator: "lt", value: range.end }
  ]
}

/**
 * Links' clicks over a range of days: one read for the links and one count, each 90 links to a query. Links the caller
 * doesn't manage, and ids of no link, are left out, so they look alike.
 */
async function clickTotals(config: Config, context: Context): Promise<ClickTotals> {
  const input = context.input as ClickTotalsInput
  if (!context.actor && !isTrusted(context)) {
    throw new ShortLinksError("UNAUTHENTICATED", "Sign in to see your links.")
  }
  const range = rangeOf(input)
  const ids = [...new Set(input.ids)]
  const read = await Promise.all(
    chunks(ids).map(async (list) =>
      context.db.findMany<LinkRow>({ model: linkModel, where: [{ field: "id", operator: "in", value: list }] })
    )
  )
  const rows = read.flat()
  const managed = await Promise.all(rows.map(async (row) => manages(config, context, row)))
  const byId = new Map(rows.filter((_, index) => managed[index]).map((row) => [row.id, row]))
  const counted = await Promise.all(
    chunks([...byId.keys()]).map(async (list) =>
      context.db.countGroups({
        model: clickModel,
        where: [{ field: "linkId", operator: "in", value: list }, ...within(range)],
        groupBy: ["linkId"]
      })
    )
  )
  const clicksOf = new Map(counted.flat().map(({ group, count }) => [group.linkId as string, count]))
  const links = ids.flatMap((id) => (byId.has(id) ? [{ id, clicks: clicksOf.get(id) ?? 0 }] : []))
  return { links, total: links.reduce((sum, link) => sum + link.clicks, 0) }
}

/**
 * Records clicks at given times, such as a demo's history, keeping the counter and last click in step with them. It's
 * for trusted server code, so it trusts the times it's given, as long as none is later than now.
 */
async function recordClicks(config: Config, context: Context): Promise<ShortLink> {
  const input = context.input as Omit<RecordClicksInput, "at"> & { at: Date[] }
  const row = await requireLinkById(config, context, input.id)
  const times = input.at.map((time) => time.getTime())
  const latest = Math.max(...times)
  if (latest > context.now.getTime()) {
    throw new ShortLinksError("INVALID_INPUT", "Clicks can't be recorded later than now.")
  }
  // Clicks per day need offsets that change only at a slot's edge, as every zone's have since 2011.
  if (Math.min(...times) < Date.parse(`${dayLimits.first}T00:00:00Z`)) {
    throw new ShortLinksError("INVALID_INPUT", `Clicks can be recorded from ${dayLimits.first} on.`)
  }
  const lastClickedAt = new Date(Math.max(latest, row.lastClickedAt?.getTime() ?? latest))
  const gone = () => new ShortLinksError("NOT_FOUND", "That link doesn't exist, or you can't manage it.")
  const writes = clickWrites(row.id, input.at, lastClickedAt)
  let updated: unknown
  try {
    const written = await context.db.batch(writes)
    updated = written[0]
  } catch (error) {
    // A link removed since it was read fails the click rows' foreign key, and the batch rolls back.
    if (!(await context.db.findOne({ model: linkModel, where: [{ field: "id", value: row.id }], select: ["id"] }))) {
      throw gone()
    }
    throw error
  }
  if (!updated || typeof updated !== "object") {
    // Without enforced foreign keys, the batch wrote the rows of a link removed since it was read. They go again.
    const ids = writes.flatMap((write) => (write.type === "createMany" ? write.data.map((data) => data.id) : []))
    await context.db.batch(
      chunks(ids).map((list) => ({
        type: "deleteMany" as const,
        model: clickModel,
        where: [{ field: "id", operator: "in" as const, value: list }]
      }))
    )
    throw gone()
  }
  return present(prefixer(config, context.request), updated as LinkRow)
}

/**
 * Whether a link may still grant access: its subject type still lets links do so, and a link to an organization's
 * record is the organization's. So turning `grantView` off ends the access existing links give at once.
 */
function mayGrant(config: Config, row: LinkRow): boolean {
  return grantsOn(config, row.subjectType) && (row.orgId === "" || row.owner === ownerKey("org", row.orgId))
}

/** Whether links to a subject type may let people see its records at all. */
function grantsOn(config: Config, subjectType: string | null): boolean {
  const rules = rulesFor(config, subjectType)
  return rules !== undefined && rules.grantView !== undefined && rules.grantView !== false
}

/** Splits codes into lists of at most 90, under D1's limit of 100 bound parameters. */
function chunks<Item>(items: readonly Item[], size = 90): Item[][] {
  const lists: Item[][] = []
  for (let start = 0; start < items.length; start += size) {
    lists.push(items.slice(start, start + size))
  }
  return lists
}

/**
 * Which subjects each request may see through the links in its cookie: one query for every request's links, then each
 * subject is granted by a link to it in that request's cookie that's on, unexpired, and in the record's current
 * organization. Subject types whose links can't grant access cost nothing. Nothing is kept between checks, so a link
 * turned off counts at once, even for a live connection that reuses its request.
 */
function grantsFor(config: Config): SubjectGrants {
  return {
    async canViewMany(checks: readonly GrantCheck[], { reportError }: GrantArgs, context: SubjectContext) {
      const codesOf = checks.map(({ subjectType, request }) =>
        grantsOn(config, subjectType) ? grantCodes(request, config.cookie.name) : []
      )
      const codes = [...new Set(codesOf.flat())]
      if (codes.length === 0) {
        return checks.map(() => false)
      }
      const now = new Date()
      const byCode = new Map(
        (
          await readLinks(
            context,
            codes,
            checks.filter((_, index) => (codesOf[index] ?? []).length > 0)
          )
        )
          .filter((row) => row.grantsView && isOpen(row, now) && mayGrant(config, row))
          .map((row) => [row.code, row])
      )
      const links = checks.map((check, index) =>
        (codesOf[index] ?? []).flatMap((code) => {
          const row = byCode.get(code)
          return row && row.subjectType === check.subjectType && row.subjectId === check.subjectId ? [row] : []
        })
      )
      const found = [...new Set(links.flat())]
      if (found.length === 0) {
        return checks.map(() => false)
      }
      // The record's organization must still be the link's, looked up once per record however many links it has.
      const records = new Map(found.map((row) => [recordKey(refOf(row)), refOf(row)]))
      const orgIds = await context.subjects.getOrgIds([...records.values()])
      const orgOf = new Map([...records.keys()].map((key, index) => [key, orgIds[index] ?? ""]))
      const placed = found.filter((row) => orgOf.get(recordKey(refOf(row))) === row.orgId)
      const valid = new Set(placed.filter((row) => row.orgId !== ""))
      const loose = placed.filter((row) => row.orgId === "")
      if (loose.length > 0) {
        // Each link's maker is checked once, however many requests hold the link.
        const answers = await stillShared(config, context, loose, reportError)
        for (const [index, row] of loose.entries()) {
          if (answers[index]) {
            valid.add(row)
          }
        }
      }
      return checks.map((_, index) => (links[index] ?? []).some((row) => valid.has(row)))
    }
  }
}

const refOf = (row: LinkRow): SubjectRef => ({ subjectType: row.subjectType ?? "", subjectId: row.subjectId ?? "" })

const recordKey = ({ subjectType, subjectId }: SubjectRef) => JSON.stringify([subjectType, subjectId])

/**
 * The links a batch of checks may be granted by, in as few queries as it takes: by their codes, 90 to a query, or, when
 * the checks name fewer records than that takes, such as one record shown to many live viewers, by those records and
 * matched to the codes here.
 */
async function readLinks(
  context: SubjectContext,
  codes: readonly string[],
  checks: readonly SubjectRef[]
): Promise<LinkRow[]> {
  const records = new Map<string, Set<string>>()
  for (const { subjectType, subjectId } of checks) {
    records.set(subjectType, (records.get(subjectType) ?? new Set()).add(subjectId))
  }
  const byRecord = [...records].flatMap(([subjectType, ids]) => chunks([...ids]).map((list) => ({ subjectType, list })))
  const byCode = chunks(codes)
  if (byRecord.length < byCode.length) {
    const wanted = new Set(codes)
    const read = await Promise.all(
      byRecord.map(async ({ subjectType, list }) =>
        context.db.findMany<LinkRow>({
          model: linkModel,
          where: [
            { field: "subjectType", value: subjectType },
            { field: "subjectId", operator: "in", value: list },
            { field: "grantsView", value: true }
          ]
        })
      )
    )
    return read.flat().filter((row) => wanted.has(row.code))
  }
  const read = await Promise.all(
    byCode.map(async (list) =>
      context.db.findMany<LinkRow>({ model: linkModel, where: [{ field: "code", operator: "in", value: list }] })
    )
  )
  return read.flat()
}

/**
 * The links outside any organization whose maker could still make them: they can see the record, and `canShare` and
 * `grantView` allow them. Such a link stands for its maker alone, so it grants nothing once they lose access. An
 * organization's links stand for the organization instead, and outlive the members who made them. When a check fails,
 * such as when the identity service is down, these links grant nothing to any request in the batch being checked, and
 * other links still count.
 */
async function stillShared(
  config: Config,
  context: SubjectContext,
  rows: readonly LinkRow[],
  reportError: GrantArgs["reportError"]
): Promise<boolean[]> {
  try {
    const shared = new Set(await sharedByMaker(config, context, rows))
    return rows.map((row) => shared.has(row))
  } catch (error) {
    // Reported, so links don't quietly stop granting, such as after an identity key rotation.
    reportError(error)
    return rows.map(() => false)
  }
}

async function sharedByMaker(config: Config, context: SubjectContext, rows: readonly LinkRow[]): Promise<LinkRow[]> {
  const makers = await context.identity.getActorsFor([...new Set(rows.map((row) => row.createdBy))], null)
  const makerOf = new Map(makers.map((maker) => [maker.userId, maker]))
  const checks = rows.flatMap((row) => {
    const maker = makerOf.get(row.createdBy)
    return maker ? [{ row, maker }] : []
  })
  // Without the request, so the check is the maker's own access, not what the visitor's links grant.
  const viewable = await context.subjects.canViewMany(checks.map(({ row, maker }) => ({ actor: maker, ...refOf(row) })))
  const allowed = await Promise.all(
    checks.map(async ({ row, maker }, index) => {
      if (!viewable[index]) {
        return false
      }
      const rules = config.subjects[row.subjectType ?? ""] as LinkRules
      const args = { actor: maker, ...refOf(row) }
      const sharable = !rules.canShare || (await rules.canShare(args)) === true
      const grantable = typeof rules.grantView !== "function" || (await rules.grantView(args)) === true
      return sharable && grantable
    })
  )
  return checks.flatMap(({ row }, index) => (allowed[index] ? [row] : []))
}

const unchecked = <Input>(): StandardSchemaV1<Input, Input> => ({
  "~standard": { version: 1, vendor: "better-apps", validate: (value) => ({ value: value as Input }) }
})

/**
 * Short links to the app's records or to any URL, owned by a user or an organization, with click counts. A link to a
 * record can let anyone who has it see the record, when the record's rules allow it.
 */
export function shortLinks<const Options extends ShortLinksOptions>(options: Options = {} as Options) {
  type SubjectType = SubjectTypeOf<Options>
  const config = resolve(options)
  const opener: Opener = { allowNotFound: perMinuteLimit(config.events.notFoundPerMinute) }
  // `serverOnly` keeps its literal type, so the browser client leaves server-only actions out.
  const action = <Input, Output, ServerOnly extends boolean = false>(
    schema: StandardSchemaV1 | null,
    run: (config: Config, context: Context) => Promise<Output>,
    serverOnly?: ServerOnly
  ) =>
    defineAction<StandardSchemaV1<Input, Input>, Output, ServerOnly>({
      input: (schema ?? unchecked<Input>()) as StandardSchemaV1<Input, Input>,
      serverOnly,
      handler: async (context) => run(config, context as Context)
    })
  const granting = Object.values(config.subjects).some(
    (rules) => rules.grantView !== undefined && rules.grantView !== false
  )

  return defineFeature({
    id: "shortLinks",
    schema: shortLinksSchema,
    events: shortLinkEvents,
    usesSubjects: Object.keys(config.subjects),
    options,
    routes: {
      open: defineRoute({
        path: `${config.path}/:code`,
        method: "GET",
        handler: async (context) => open(config, opener, context)
      })
    },
    // Scheduled expiries are short links' own events, delivered by later `app.deliverEvents()` runs.
    on: {
      shortLinks: {
        "expiry.scheduled": (event, context) => expire(config, context, event.data as ScheduledExpiry)
      }
    },
    // Only apps that let links grant access ask the cookie about every refused check.
    grants: granting ? grantsFor(config) : undefined,
    actions: {
      create: action<CreateLinkInput<SubjectType>, ShortLink>(inputs.create, create),
      get: action<{ code: string }, ShortLink>(inputs.code, get),
      list: action<ListLinksInput<SubjectType>, LinkPage>(inputs.list, list),
      update: action<UpdateLinkInput, ShortLink>(inputs.update, update),
      remove: action<{ code: string }, { removed: boolean }>(inputs.code, remove),
      removeSubject: action<LinkSubject<SubjectType>, { removed: number }, true>(inputs.subject, removeSubject, true),
      removeOwner: action<{ owner: { type: OwnerType; id: string } }, { removed: number }, true>(
        inputs.removeOwner,
        removeOwner,
        true
      ),
      clicksByDay: action<ClicksByDayInput, ClicksByDay>(inputs.clicksByDay, clicksByDay),
      clickTotals: action<ClickTotalsInput, ClickTotals>(inputs.clickTotals, clickTotals),
      recordClicks: action<RecordClicksInput, ShortLink, true>(inputs.recordClicks, recordClicks, true)
    }
  })
}

/** The short links feature as `shortLinks()` returns it. */
export type ShortLinksFeature<Options extends ShortLinksOptions = ShortLinksOptions> = ReturnType<
  typeof shortLinks<Options>
>
