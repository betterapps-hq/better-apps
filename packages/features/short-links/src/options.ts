import type { Actor, SubjectArgs } from "better-apps"

/** What a subject type's `url` receives: the record a link points to. */
export interface LinkTargetArgs {
  subjectType: string
  subjectId: string
  /** The organization the link belongs to, or `null` outside any. */
  orgId: string | null
}

/** How links work on one subject type, such as `invoice`. */
export interface LinkRules {
  /**
   * Where the record lives in the app: a path, resolved against the link's own address, or an absolute URL. It runs
   * each time a link opens, so links follow the app's routes as they change.
   */
  url: (args: LinkTargetArgs) => string | Promise<string>
  /** Whether the actor can make links to the record. Everyone who can see it, by default. */
  canShare?: ((args: SubjectArgs) => boolean | Promise<boolean>) | undefined
  /**
   * Whether links to the record may let anyone who has them see it: `true`, a check per actor and record, or `false`,
   * the default. Setting it back to `false` ends the access existing links give. A check per record runs again on each
   * request only for links made outside any organization; an organization's links keep the access they were made with.
   */
  grantView?: boolean | ((args: SubjectArgs) => boolean | Promise<boolean>) | undefined
}

/** What `validateUrl` receives. */
export interface ValidateUrlArgs {
  url: URL
  /** Who's making or changing the link, or `null` for trusted server code. */
  actor: Actor | null
  /** The organization the link would belong to, or `null` outside any. */
  orgId: string | null
}

/** What `canManage` receives. */
export interface ManageArgs {
  actor: Actor
  orgId: string
}

/** What `notFound` receives. */
export interface NotFoundArgs {
  request: Request
  code: string
}

/** The cookie that remembers links that grant access. */
export interface GrantCookie {
  /** `better-apps-links` by default. */
  name?: string | undefined
  /** How long it lasts, in seconds. 30 days by default. */
  maxAge?: number | undefined
  /**
   * The cookie's `Domain`, such as `example.com`, so links on one host, such as `go.example.com`, grant access on
   * another under it, such as `app.example.com`. Without it, the cookie stays on the link's host.
   */
  domain?: string | undefined
}

/**
 * Whose links a host opens: `"app"` for the app's own host, which opens every link, `{ orgId }` for a domain an
 * organization verified, which opens only the links that organization owns, or `null` for any other host, which opens
 * none.
 */
export type LinkHost = "app" | { orgId: string } | null

/** What `hosts.resolve` receives. */
export interface ResolveHostArgs {
  /**
   * The host of the request's URL, lowercase and without the port or a trailing dot, such as `links.acme.com`. Headers
   * such as `X-Forwarded-Host` play no part.
   */
  hostname: string
  request: Request
}

/** What `hosts.origin` receives: the links whose short URLs are being written. */
export interface LinkOriginArgs {
  /** The organization that owns the links, or `null` for links made outside any. */
  orgId: string | null
}

/**
 * Where links open, and the host their short URLs use, for an app whose organizations have their own domains, such as
 * the domains feature's. Short links never import such a feature: the app connects the two.
 */
export interface LinkHosts {
  /** Says whose links a host opens, for the host a link was opened on. It runs before the link is read. */
  resolve: (args: ResolveHostArgs) => LinkHost | Promise<LinkHost>
  /**
   * The origin of an organization's short URLs, such as `https://links.acme.com`, or `null` for `baseUrl`. Return a
   * host that opens its links: the organization's domain, or a host `resolve` says is the app's. A person's own links
   * made in an organization always use `baseUrl`, the only host that opens them. `baseUrl`, by default.
   */
  origin?: ((args: LinkOriginArgs) => string | null | Promise<string | null>) | undefined
}

/** What `source.urls` receives: the web address a link is about to redirect to. */
export interface SourceUrlArgs {
  url: URL
}

/**
 * Tells the page a link opens which link opened it, as a query parameter on the redirect, so the app can record where a
 * visit came from, such as a booking's source. It reaches the page whatever host it's on, which a cookie on the link's
 * host wouldn't.
 */
export interface LinkSource {
  /** The query parameter that carries the link's code, such as `via` in `/book/intro?via=intro-linkedin`. */
  param: string
  /**
   * Whether links to web addresses carry it too: `true`, a check per address, such as the app's own sites, or `false`,
   * the default, so codes don't reach other sites. Links to records carry it.
   */
  urls?: boolean | ((args: SourceUrlArgs) => boolean | Promise<boolean>) | undefined
  /**
   * Whether links that let people see a record carry it too. Their code is all it takes to see the record, so it would
   * show in the page's address, its history, its logs and any analytics on the page. `false` by default.
   */
  grants?: boolean | undefined
}

/** How short links are set up in an app. */
export interface ShortLinksOptions {
  /** The subject types links can point to, keyed by name. The app or a feature declares each one. */
  subjects?: Readonly<Record<string, LinkRules>> | undefined
  /**
   * Checks a URL a link would point to: `true` allows it, and `false` or a message refuses it. Without it, any URL is
   * allowed but `javascript:`, `data:`, `vbscript:` and `file:` ones.
   */
  validateUrl?: ((args: ValidateUrlArgs) => boolean | string | Promise<boolean | string>) | undefined
  /**
   * Who manages an organization's links: the ones it owns, and the ones its members made in it, and makes its URL links.
   * Every member, by default. Members who may share a record make the organization's links to it either way.
   */
  canManage?: ((args: ManageArgs) => boolean | Promise<boolean>) | undefined
  /** Where links open, `/s` by default, so a link is `/s/{code}`. */
  path?: string | undefined
  /**
   * The origin of the short URLs actions return, such as `https://go.example.com`. The request's, by default. Required
   * with `hosts`.
   */
  baseUrl?: string | undefined
  /**
   * Opens links on organizations' own domains, each only its organization's, and shares them there. It needs `baseUrl`,
   * the app's own host, which opens every link. Without it, every host that serves the app opens every link.
   */
  hosts?: LinkHosts | undefined
  /** The length of generated codes, from 6 to 32. 8 by default. */
  codeLength?: number | undefined
  /** The cookie that remembers links that grant access. */
  cookie?: GrantCookie | undefined
  /**
   * Answers a link that doesn't exist, is turned off or has expired. A plain 404 page by default. It isn't told which,
   * so it can't tell visitors which codes were links once.
   */
  notFound?: ((args: NotFoundArgs) => Response | Promise<Response>) | undefined
  /** Adds the link's code to the address it redirects to, so the page knows which link opened it. Off by default. */
  source?: LinkSource | undefined
}

/** Who owns a link: a user, or an organization. */
export type OwnerType = "user" | "org"

/** Where a link goes: any URL, or one of the app's records. */
export type LinkTarget<SubjectType extends string = string> = { url: string } | LinkSubject<SubjectType>

/** A record links point to. */
export interface LinkSubject<SubjectType extends string = string> {
  subjectType: SubjectType
  subjectId: string
}

/** The input of `create`. */
export interface CreateLinkInput<SubjectType extends string = string> {
  target: LinkTarget<SubjectType>
  /**
   * A code of 1 to 64 letters, digits, `-` and `_`, which isn't case-sensitive. A link that lets people see a record
   * adds a random part to it, so it can be up to 51. A random code, by default.
   */
  code?: string | undefined
  /**
   * `org` for the actor's organization, `user` for the actor. Inside an organization, the organization's by default when
   * the actor manages its links or the link grants access, and the actor's otherwise.
   */
  owner?: OwnerType | undefined
  /**
   * Whether opening the link lets anyone who has it see the record. `false` by default. A link to an organization's
   * record that does is the organization's.
   */
  grantsView?: boolean | undefined
  /** When it stops opening. Never, by default. */
  expiresAt?: Date | string | undefined
}

/** The input of `update`: the link's code and what to change. */
export interface UpdateLinkInput {
  code: string
  /** A new target, for a URL link. */
  url?: string | undefined
  /** `false` stops the link letting people see the record. To let people see one, make a new link. */
  grantsView?: false | undefined
  enabled?: boolean | undefined
  /** `null` to never expire. */
  expiresAt?: Date | string | null | undefined
}

/** The input of `list`. */
export interface ListLinksInput<SubjectType extends string = string> {
  /** With `subjectId`, lists one record's links. */
  subjectType?: SubjectType | undefined
  subjectId?: string | undefined
  /**
   * Only the caller's own links, `user`, or their organization's, `org`. By default, every link the caller manages: the
   * ones made in their current organization, and their own made outside any.
   */
  owner?: OwnerType | undefined
  /**
   * `newest`, the default, lists links newest first. `clicks` lists the most opened first, then the newest, such as for
   * top links. Clicks keep coming while someone pages, so a link can move between pages.
   */
  sort?: LinkSort | undefined
  cursor?: string | undefined
  /** 20 by default, at most 50. */
  limit?: number | undefined
}

/** The order of `list`: newest first, or most opened first. */
export type LinkSort = "newest" | "clicks"

/** A range of calendar days in a time zone, both days included, such as the last 30 days where the viewer is. */
export interface DayRangeInput {
  /** The first day, as `YYYY-MM-DD`. */
  from: string
  /** The last day, as `YYYY-MM-DD`. Up to 366 days after `from`, counting both. */
  to: string
  /** The IANA time zone the days are in, such as `Europe/Paris`. `UTC` by default. */
  timeZone?: string | undefined
}

/** The input of `clicksByDay`: a link, by its `id`, and the days to count its clicks on. */
export interface ClicksByDayInput extends DayRangeInput {
  id: string
}

/** The input of `clickTotals`: links, by their `id`s, and the days to count their clicks over. */
export interface ClickTotalsInput extends DayRangeInput {
  /** Up to 50 link ids, such as a page of `list`. */
  ids: readonly string[]
}

/** The input of `recordClicks`: a link, by its `id`, and when it was opened. */
export interface RecordClicksInput {
  id: string
  /** Up to 500 times, from 2011 to now. */
  at: readonly (Date | string)[]
}

/** The subject types a set of options lets links point to. */
export type SubjectTypeOf<Options extends ShortLinksOptions> =
  Options["subjects"] extends Readonly<Record<string, LinkRules>> ? keyof Options["subjects"] & string : never
