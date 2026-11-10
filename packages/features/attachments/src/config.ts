import { AttachmentsError } from "./errors.js"
import { allowsType, cleanContentTypes } from "./files.js"
import type { AttachmentRules, AttachmentsOptions, PreviewOptions, StandaloneRules } from "./options.js"
import type { StorageAdapter } from "./storage.js"
import { createSigner, type Signer } from "./tokens.js"

/** Size and count limits. Lists of ids stay under D1's 100 bound parameters a statement. */
export const limits = {
  /** Records one `listFiles` call reads. */
  subjectsPerList: 20,
  ownFilesPerPage: 20,
  maxOwnFilesPerPage: 50,
  maxFiles: 10,
  /** The most `maxFiles` can be, so a reorder's updates stay under D1's 50 queries a request. */
  maxFilesLimit: 30,
  maxSize: 25 * 1024 * 1024,
  nameLength: 1024
} as const

/** The widths previews are made at, by default. */
export const previewWidths = [96, 256, 640, 1280, 1920] as const

/** How files on one subject type, or standalone files, are checked. */
export interface Limits {
  /** The allowed media types, or `null` for any. */
  contentTypes: string[] | null
  maxSize: number
}

/** How attachments work on one subject type, resolved once when the feature is created. */
export interface Settings extends Limits {
  rules: AttachmentRules
  maxFiles: number
}

/** The feature's options, checked and filled in. */
export interface Config {
  storage: StorageAdapter
  subjects: Readonly<Record<string, Settings>>
  standalone: (Limits & { rules: StandaloneRules }) | null
  /** The routes' path, without a trailing slash. */
  path: string
  /** The origin of returned URLs, or `""` for paths. */
  baseUrl: string
  signer: Signer | null
  uploadTtlMs: number
  draftTtlMs: number
  maxDrafts: number
  downloadTtlMs: number
  previews: { widths: number[]; transform: PreviewOptions["transform"] } | null
}

function positiveSeconds(name: string, value: number | undefined, fallback: number): number {
  const seconds = value ?? fallback
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 7 * 24 * 60 * 60) {
    throw new Error(`\`${name}\` must be a whole number of seconds from 1 to a week.`)
  }
  return seconds * 1000
}

function resolveMaxDrafts(value: number | undefined): number {
  const count = value ?? 50
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new Error("`maxDrafts` must be a whole number from 1 to 1000.")
  }
  return count
}

function resolveMaxSize(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`\`${name}\` must be a whole number of bytes, at least 1.`)
  }
  return value
}

function resolveLimits(
  where: string,
  own: { contentTypes?: readonly string[] | undefined; maxSize?: number | undefined },
  defaults: Limits
): Limits {
  return {
    contentTypes: own.contentTypes ? cleanContentTypes(own.contentTypes, where) : defaults.contentTypes,
    maxSize: own.maxSize === undefined ? defaults.maxSize : resolveMaxSize(`${where}'s maxSize`, own.maxSize)
  }
}

function resolvePath(path: string): string {
  const trimmed = `/${path.replace(/^\/+|\/+$/g, "")}`
  if (trimmed === "/" || !/^(?:\/[\w\-.~!$&'()*+,;=@]+)+$/.test(trimmed)) {
    throw new Error(`The attachments \`path\` "${path}" must be a path such as "/api/apps/attachments".`)
  }
  return trimmed
}

function resolveBaseUrl(baseUrl: string | undefined): string {
  if (baseUrl === undefined) {
    return ""
  }
  const url = new URL(baseUrl)
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`The attachments \`baseUrl\` "${baseUrl}" must be an origin, such as "https://app.example.com".`)
  }
  return url.origin
}

function resolvePreviews(previews: PreviewOptions | undefined): Config["previews"] {
  if (!previews) {
    return null
  }
  const widths = [...new Set(previews.widths ?? previewWidths)].sort((a, b) => a - b)
  if (widths.length === 0 || widths.some((width) => !Number.isInteger(width) || width < 1 || width > 4096)) {
    throw new Error("Preview `widths` must be whole numbers of pixels from 1 to 4096.")
  }
  return { widths, transform: previews.transform }
}

/** Checks the options and fills in their defaults. */
export function resolve(options: AttachmentsOptions): Config {
  const defaults = resolveLimits("The attachments options", options, {
    contentTypes: null,
    maxSize: limits.maxSize
  })
  const subjects: Record<string, Settings> = {}
  for (const [subjectType, rules] of Object.entries(options.subjects ?? {})) {
    const maxFiles = rules.maxFiles ?? limits.maxFiles
    if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > limits.maxFilesLimit) {
      throw new Error(`\`maxFiles\` for "${subjectType}" must be a whole number from 1 to ${limits.maxFilesLimit}.`)
    }
    subjects[subjectType] = { rules, maxFiles, ...resolveLimits(`The "${subjectType}" subject type`, rules, defaults) }
  }
  if (Object.keys(subjects).length === 0 && !options.standalone) {
    throw new Error("Attachments need at least one subject type, or `standalone` for files on their own.")
  }
  return {
    storage: options.storage,
    subjects,
    standalone: options.standalone
      ? { rules: options.standalone, ...resolveLimits("`standalone`", options.standalone, defaults) }
      : null,
    path: resolvePath(options.path ?? "/api/apps/attachments"),
    baseUrl: resolveBaseUrl(options.baseUrl),
    signer: options.secret === undefined ? null : createSigner(options.secret),
    uploadTtlMs: positiveSeconds("uploadTtl", options.uploadTtl, 15 * 60),
    draftTtlMs: positiveSeconds("draftTtl", options.draftTtl, 24 * 60 * 60),
    maxDrafts: resolveMaxDrafts(options.maxDrafts),
    downloadTtlMs: positiveSeconds("downloadTtl", options.downloadTtl, 60 * 60),
    previews: resolvePreviews(options.previews)
  }
}

/** The settings of a subject type, or `INVALID_INPUT` when attachments aren't set up for it. */
export function settingsOf(config: Config, subjectType: string): Settings {
  if (!Object.hasOwn(config.subjects, subjectType)) {
    throw new AttachmentsError("INVALID_INPUT", `Attachments aren't set up for the "${subjectType}" subject type.`)
  }
  return config.subjects[subjectType] as Settings
}

/** Refuses a file its limits don't allow. */
export function checkLimits(limits: Limits, contentType: string, size: number): void {
  if (!allowsType(limits.contentTypes, contentType)) {
    throw new AttachmentsError("INVALID_INPUT", `Files of type ${contentType} aren't allowed here.`)
  }
  if (size > limits.maxSize) {
    throw new AttachmentsError("PAYLOAD_TOO_LARGE", `Files here can be up to ${limits.maxSize} bytes.`)
  }
}
