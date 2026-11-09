import {
  defineAction,
  defineFeature,
  defineRoute,
  type ActionContext,
  type Actor,
  type RouteContext,
  type SubjectContext,
  type SubjectGrants,
  type SubjectRef,
  type StandardSchemaV1,
  type Where
} from "better-apps"
import { z } from "zod"
import { codeLimits, generateCode, isValidCode } from "./codes.js"
import { grantCodes, grantCookie } from "./cookie.js"
import { ShortLinksError } from "./errors.js"
import { shortLinkEvents } from "./events.js"
import { isOpen, ownerKey, toLink, type ShortLink } from "./link.js"
import type {
  CreateLinkInput,
  LinkRules,
  LinkSubject,
  ListLinksInput,
  OwnerType,
  ShortLinksOptions,
  SubjectTypeOf,
  UpdateLinkInput
} from "./options.js"
import { linkModel, shortLinksSchema, type LinkRow } from "./schema.js"

/** A page of links, newest first. */
export interface LinkPage {
  links: ShortLink[]
  /** The cursor for the next page, or `null` on the last one. */
  cursor: string | null
}

/** Size limits. */
export const limits = {
  linksPerPage: 20,
  maxLinksPerPage: 50,
  urlLength: 2048,
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
  codeLength: number
  cookieName: string
  cookieMaxAge: number
  notFound: NonNullable<ShortLinksOptions["notFound"]>
}

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
    const parsed = URL.canParse(options.baseUrl) ? new URL(options.baseUrl) : null
    if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
      throw new Error(`\`baseUrl\` must be an http or https URL, such as https://go.example.com.`)
    }
    baseUrl = parsed.href.replace(/\/+$/, "")
  }
  const cookieName = options.cookie?.name ?? "better-apps-links"
  if (!/^[\w\-.]+$/.test(cookieName)) {
    throw new Error(`The cookie name "${cookieName}" may use only letters, digits, _, - and .`)
  }
  const cookieMaxAge = options.cookie?.maxAge ?? 30 * 24 * 60 * 60
  if (!Number.isInteger(cookieMaxAge) || cookieMaxAge <= 0) {
    throw new Error("The cookie's `maxAge` must be a whole number of seconds above 0.")
  }
  return {
    subjects: options.subjects ?? {},
    validateUrl: options.validateUrl,
    canManage: options.canManage,
    path,
    baseUrl,
    codeLength,
    cookieName,
    cookieMaxAge,
    notFound: options.notFound ?? notFoundPage
  }
}

/** Where a call's links live: `baseUrl`, or the request's origin, with the path. */
function prefixOf(config: Config, request: Request | null): string {
  return `${config.baseUrl ?? (request ? new URL(request.url).origin : "")}${config.path}`
}

/** Server code that passes neither an actor nor a request is trusted. It can't make links, since a link is someone's. */
function isTrusted(context: Context): boolean {
  return context.source === "api" && context.actor === null && context.request === null
}

function rulesOf(config: Config, subjectType: string): LinkRules {
  const rules = Object.hasOwn(config.subjects, subjectType) ? config.subjects[subjectType] : undefined
  if (!rules) {
    throw new ShortLinksError("INVALID_INPUT", `Links can't point to "${subjectType}" records.`)
  }
  return rules
}

/** Whether an actor manages an organization's links. */
async function managesOrg(config: Config, actor: Actor, orgId: string): Promise<boolean> {
  return actor.orgId === orgId && (config.canManage ? (await config.canManage({ actor, orgId })) === true : true)
}

/** Whether the caller manages a link: its owner, a manager of its organization, or trusted server code. */
async function manages(config: Config, context: Context, row: LinkRow): Promise<boolean> {
  if (isTrusted(context)) {
    return true
  }
  const { actor } = context
  if (!actor) {
    return false
  }
  if (row.owner === ownerKey("user", actor.userId)) {
    return true
  }
  return actor.orgId !== null && row.owner === ownerKey("org", actor.orgId) && managesOrg(config, actor, actor.orgId)
}

const byCode = (code: string): Where[] => [{ field: "code", value: code }]

/** A link the caller manages, or the error that says why not. */
async function requireLink(config: Config, context: Context, code: string): Promise<LinkRow> {
  const row = await context.db.findOne<LinkRow>({ model: linkModel, where: byCode(code) })
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

/** Refuses access through a link whose code is short enough to guess, since the code is all it takes. */
function checkGrantingCode(code: string): void {
  if (code.length < codeLimits.minGranting) {
    throw new ShortLinksError(
      "INVALID_INPUT",
      `Links that let people see a record need codes of at least ${codeLimits.minGranting} characters.`
    )
  }
}

/** Refuses access through a link the record's rules don't allow: a person `grantView` refuses, or another organization. */
async function checkGrant(context: Context, rules: LinkRules, ref: SubjectRef, orgId: string): Promise<void> {
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
  if (((await context.subjects.getOrgId(ref, actor)) ?? "") !== orgId) {
    throw new ShortLinksError("INVALID_INPUT", "Only links made in the record's organization can let people see it.")
  }
}

const subjectType = z.string().min(1).max(255)
const subjectId = z.string().min(1).max(255)
const code = z.string().min(1).max(limits.maxCustom)
const url = z.string().min(1).max(limits.urlLength)
const owner = z.enum(["user", "org"])
const date = z.coerce.date()
const subject = z.object({ subjectType, subjectId })
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
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(limits.maxLinksPerPage).optional()
  }),
  update: z.object({
    code,
    url: url.optional(),
    grantsView: z.boolean().optional(),
    enabled: z.boolean().optional(),
    expiresAt: date.nullable().optional()
  }),
  subject,
  removeOwner: z.object({ owner: z.object({ type: owner, id: z.string().min(1).max(255) }) })
}

type Parsed<Input> = Omit<Input, "expiresAt"> & { expiresAt?: Date | null | undefined }

async function create(config: Config, context: Context): Promise<ShortLink> {
  const input = context.input as Parsed<CreateLinkInput>
  const { actor } = context
  if (!actor) {
    throw new ShortLinksError("UNAUTHENTICATED", "Sign in to make links.")
  }
  const ownerType: OwnerType = input.owner ?? (actor.orgId === null ? "user" : "org")
  if (ownerType === "org") {
    if (actor.orgId === null) {
      throw new ShortLinksError("INVALID_INPUT", "You're not in an organization, so the link can only be yours.")
    }
    if (!(await managesOrg(config, actor, actor.orgId))) {
      throw new ShortLinksError("FORBIDDEN", "You can't make links for your organization.")
    }
  }
  const orgId = actor.orgId ?? ""
  if (input.code !== undefined && !isValidCode(input.code)) {
    throw new ShortLinksError("INVALID_INPUT", "Codes are 1 to 64 letters, digits, - and _.")
  }
  checkExpiry(input.expiresAt)
  let target: Pick<LinkRow, "url" | "subjectType" | "subjectId">
  if ("url" in input.target) {
    if (input.grantsView) {
      throw new ShortLinksError("INVALID_INPUT", "Only links to records can let people see them.")
    }
    target = { url: await checkUrl(config, input.target.url, actor, actor.orgId), subjectType: null, subjectId: null }
  } else {
    const ref = { subjectType: input.target.subjectType, subjectId: input.target.subjectId }
    const rules = rulesOf(config, ref.subjectType)
    if (!(await context.subjects.canView(actor, ref))) {
      throw new ShortLinksError("NOT_FOUND", "That record doesn't exist, or you can't see it.")
    }
    if (rules.canShare && !(await rules.canShare({ actor, ...ref }))) {
      throw new ShortLinksError("FORBIDDEN", "You can't make links to this.")
    }
    const recordOrg = (await context.subjects.getOrgId(ref, actor)) ?? ""
    if (ownerType === "org" && recordOrg !== "" && recordOrg !== orgId) {
      throw new ShortLinksError("INVALID_INPUT", "Your organization's links can only point to its own records.")
    }
    if (input.grantsView) {
      await checkGrant(context, rules, ref, orgId)
      if (input.code !== undefined) {
        checkGrantingCode(input.code)
      }
    }
    target = { url: null, ...ref }
  }
  const prefix = prefixOf(config, context.request)
  // Generated codes of links that grant access are long enough to stay secret, whatever `codeLength` says.
  const length = input.grantsView ? Math.max(config.codeLength, codeLimits.minGranting) : config.codeLength
  const fields: Omit<LinkRow, "id" | "code"> = {
    owner: ownerKey(ownerType, ownerType === "org" ? orgId : actor.userId),
    orgId,
    createdBy: actor.userId,
    ...target,
    grantsView: input.grantsView === true,
    enabled: true,
    expiresAt: input.expiresAt ?? null,
    clicks: 0,
    lastClickedAt: null,
    createdAt: context.now,
    updatedAt: context.now
  }
  // A generated code that's taken is replaced, up to three times. A taken code is told apart from other failed writes
  // by reading it back.
  for (let attempt = 1; ; attempt += 1) {
    const row: LinkRow = { id: crypto.randomUUID(), code: input.code ?? generateCode(length), ...fields }
    const link = toLink(row, prefix)
    context.emit("link.created", { link })
    try {
      await context.db.batch([{ type: "create", model: linkModel, data: row }])
      return link
    } catch (error) {
      if (!(await context.db.findOne({ model: linkModel, where: byCode(row.code), select: ["id"] }))) {
        throw error
      }
      if (input.code !== undefined) {
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
  return toLink(await requireLink(config, context, wanted), prefixOf(config, context.request))
}

function encodeCursor(row: LinkRow): string {
  return btoa(JSON.stringify([row.createdAt.toISOString(), row.id]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const [time, id] = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/"))) as unknown[]
    const createdAt = new Date(String(time))
    if (typeof time === "string" && typeof id === "string" && !Number.isNaN(createdAt.getTime())) {
      return { createdAt, id }
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
    const owners = [
      ...(input.owner === "org" ? [] : [ownerKey("user", actor.userId)]),
      ...(input.owner !== "user" && actor.orgId !== null && (await managesOrg(config, actor, actor.orgId))
        ? [ownerKey("org", actor.orgId)]
        : [])
    ]
    if (owners.length === 0) {
      return { links: [], cursor: null }
    }
    where.push({ field: "owner", operator: "in", value: owners })
  } else if (where.length === 0) {
    throw new ShortLinksError("INVALID_INPUT", "Server code without an actor lists one record's links at a time.")
  }
  const limit = input.limit ?? limits.linksPerPage
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
  const rows = await context.db.findMany<LinkRow>({
    model: linkModel,
    where,
    sortBy: [
      { field: "createdAt", direction: "desc" },
      { field: "id", direction: "desc" }
    ],
    after,
    limit: limit + 1
  })
  const page = rows.slice(0, limit)
  const prefix = prefixOf(config, context.request)
  const last = page.at(-1)
  return {
    links: page.map((row) => toLink(row, prefix)),
    cursor: rows.length > limit && last ? encodeCursor(last) : null
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
  if (input.grantsView !== undefined && input.grantsView !== row.grantsView) {
    if (input.grantsView) {
      if (row.subjectType === null || row.subjectId === null) {
        throw new ShortLinksError("INVALID_INPUT", "Only links to records can let people see them.")
      }
      const ref = { subjectType: row.subjectType, subjectId: row.subjectId }
      await checkGrant(context, rulesOf(config, ref.subjectType), ref, row.orgId)
      checkGrantingCode(row.code)
    }
    changes.grantsView = input.grantsView
  }
  if (input.enabled !== undefined) {
    changes.enabled = input.enabled
  }
  if (input.expiresAt !== undefined) {
    checkExpiry(input.expiresAt)
    changes.expiresAt = input.expiresAt
  }
  const link = toLink({ ...row, ...changes }, prefixOf(config, context.request))
  context.emit("link.updated", { link })
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
  context.emit("link.removed", { link: toLink(row, prefixOf(config, context.request)) })
  const [removed] = await context.db.batch([
    { type: "deleteMany", model: linkModel, where: [{ field: "id", value: row.id }] }
  ])
  return { removed: removed === 1 }
}

async function removeSubject(_config: Config, context: Context): Promise<{ removed: number }> {
  const ref = context.input as LinkSubject
  const removed = await context.db.deleteMany({
    model: linkModel,
    where: [
      { field: "subjectType", value: ref.subjectType },
      { field: "subjectId", value: ref.subjectId }
    ]
  })
  context.emit("subject.removed", { ...ref, removed })
  return { removed }
}

async function removeOwner(_config: Config, context: Context): Promise<{ removed: number }> {
  const { owner: who } = context.input as { owner: { type: OwnerType; id: string } }
  const removed = await context.db.deleteMany({
    model: linkModel,
    where: [{ field: "owner", value: ownerKey(who.type, who.id) }]
  })
  context.emit("owner.removed", { owner: { type: who.type, id: who.id }, removed })
  return { removed }
}

/**
 * Opens a link: one read by its code, then a temporary redirect, so a link turned off or changed takes effect at once.
 * A link that grants access adds its code to the visitor's cookie. The click is written after the response.
 */
async function open(config: Config, context: RouteContext): Promise<Response> {
  const { request, params, db, now } = context
  const wanted = params.code ?? ""
  const row = isValidCode(wanted) ? await db.findOne<LinkRow>({ model: linkModel, where: byCode(wanted) }) : null
  if (!row || !isOpen(row, now)) {
    return config.notFound({ request, code: wanted })
  }
  let location = row.url
  if (location === null) {
    const { subjectType: type, subjectId: id } = row
    // A record link of a subject type the feature no longer has opens nothing.
    const rules = type !== null && Object.hasOwn(config.subjects, type) ? config.subjects[type] : undefined
    if (!rules || id === null) {
      return config.notFound({ request, code: wanted })
    }
    const path = await rules.url({
      subjectType: type as string,
      subjectId: id,
      orgId: row.orgId === "" ? null : row.orgId
    })
    location = new URL(path, request.url).href
  }
  const headers = new Headers({ location, "cache-control": "private, no-store" })
  if (row.grantsView) {
    headers.set("set-cookie", grantCookie(request, config.cookieName, config.cookieMaxAge, row.code))
  }
  if (request.method === "GET") {
    context.waitUntil(
      db.incrementOne({
        model: linkModel,
        where: [{ field: "id", value: row.id }],
        increment: { clicks: 1 },
        set: { lastClickedAt: new Date() }
      })
    )
  }
  return new Response(null, { status: 302, headers })
}

/**
 * Which subjects a request may see through the links in its cookie: one query for the links, cached for the request,
 * then each subject is granted by a link to it that's on, unexpired, and in the record's current organization.
 */
function grantsFor(config: Config): SubjectGrants {
  const read = new WeakMap<Request, Promise<LinkRow[]>>()
  return {
    async canViewMany(refs: readonly SubjectRef[], { request }: { request: Request }, context: SubjectContext) {
      const codes = grantCodes(request, config.cookieName)
      if (codes.length === 0) {
        return refs.map(() => false)
      }
      let rows = read.get(request)
      if (!rows) {
        rows = context.db.findMany<LinkRow>({
          model: linkModel,
          where: [{ field: "code", operator: "in", value: codes }]
        })
        read.set(request, rows)
      }
      const now = new Date()
      const granting = (await rows).filter(
        (row) => row.grantsView && isOpen(row, now) && Object.hasOwn(config.subjects, row.subjectType ?? "")
      )
      const links = refs.map((ref) =>
        granting.filter((row) => row.subjectType === ref.subjectType && row.subjectId === ref.subjectId)
      )
      const found = refs.flatMap((ref, index) => ((links[index] ?? []).length > 0 ? [ref] : []))
      if (found.length === 0) {
        return refs.map(() => false)
      }
      const orgs = await context.subjects.getOrgIds(found)
      const orgOf = new Map(found.map((ref, index) => [JSON.stringify([ref.subjectType, ref.subjectId]), orgs[index]]))
      return refs.map((ref, index) => {
        const org = orgOf.get(JSON.stringify([ref.subjectType, ref.subjectId])) ?? ""
        return (links[index] ?? []).some((row) => row.orgId === org)
      })
    }
  }
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
        handler: async (context) => open(config, context)
      })
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
      )
    }
  })
}

/** The short links feature as `shortLinks()` returns it. */
export type ShortLinksFeature<Options extends ShortLinksOptions = ShortLinksOptions> = ReturnType<
  typeof shortLinks<Options>
>
