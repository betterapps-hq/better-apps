import type { AnchorKind } from "@better-apps/anchors"
import type { FieldAttribute, StandardSchemaV1 } from "better-apps"
import { CommentsError } from "./errors.js"
import type { BodyFormat } from "./formats.js"

/** Size and count limits. Queries that pass lists of ids stay under D1's 100 bound parameters. */
export const limits = {
  bodyBytes: 16 * 1024,
  anchorBytes: 4 * 1024,
  metadataBytes: 4 * 1024,
  mentions: 20,
  threadsPerPage: 20,
  maxThreadsPerPage: 50,
  commentsPerPage: 50,
  maxCommentsPerPage: 100,
  subjectsPerCount: 50,
  suggestions: 10
} as const

const encoder = new TextEncoder()

/** The size of a value as JSON, in UTF-8 bytes. */
export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value) ?? "").length
}

/** JSON with object keys sorted, so equal values compare equal however they were built. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)))
      : inner
  )
}

async function check<Output>(schema: StandardSchemaV1<unknown, Output>, value: unknown, what: string): Promise<Output> {
  const result = await schema["~standard"].validate(value)
  if (result.issues) {
    throw new CommentsError("INVALID_INPUT", `The ${what} isn't valid.`, { issues: result.issues })
  }
  return result.value
}

function capped(value: unknown, bytes: number, what: string): void {
  if (jsonBytes(value) > bytes) {
    throw new CommentsError("LIMIT_EXCEEDED", `The ${what} is over ${bytes / 1024} KB.`)
  }
}

/** A comment body after its format checked and sanitized it, with its text and mentions. */
export interface CheckedContent {
  format: string
  body: unknown
  bodyText: string
  mentions: string[]
}

/** Checks, sanitizes and measures a body in a registered format. */
export async function checkContent(
  formats: ReadonlyMap<string, BodyFormat>,
  formatName: string | undefined,
  body: unknown
): Promise<CheckedContent> {
  const name = formatName ?? "text"
  const format = formats.get(name)
  if (!format) {
    throw new CommentsError("INVALID_INPUT", `Comments aren't set up for the "${name}" body format.`)
  }
  const checked = await check(format.schema, body, "comment body")
  const sanitized = format.sanitize ? format.sanitize(checked) : checked
  capped(sanitized, limits.bodyBytes, "comment")
  const mentions = format.mentions(sanitized)
  if (mentions.length > limits.mentions) {
    throw new CommentsError("LIMIT_EXCEEDED", `A comment can mention at most ${limits.mentions} people.`)
  }
  return { format: name, body: sanitized, bodyText: format.toText(sanitized), mentions }
}

/** A thread's anchor as stored. */
export interface CheckedAnchor {
  anchorKind: string | null
  anchor: unknown
  anchorVersion: string | null
}

/** Checks an anchor against its registered kind. `null` puts the thread on the whole subject. */
export async function checkAnchor(
  anchors: ReadonlyMap<string, AnchorKind>,
  anchor: { kind: string; value: unknown; version?: string | null | undefined } | null | undefined
): Promise<CheckedAnchor> {
  if (!anchor) {
    return { anchorKind: null, anchor: null, anchorVersion: null }
  }
  const kind = anchors.get(anchor.kind)
  if (!kind) {
    throw new CommentsError("INVALID_INPUT", `Comments aren't set up for the "${anchor.kind}" anchor kind.`)
  }
  const value = await check(kind.schema, anchor.value, "anchor")
  capped(value, limits.anchorBytes, "anchor")
  return { anchorKind: kind.kind, anchor: value, anchorVersion: anchor.version ?? null }
}

/** Checks metadata against a subject type's schema, when it has one, and its size. */
export async function checkMetadata(
  schema: StandardSchemaV1<unknown, Record<string, unknown>> | undefined,
  metadata: Record<string, unknown> | null
): Promise<Record<string, unknown> | null> {
  if (metadata === null) {
    return null
  }
  const checked = schema ? await check(schema, metadata, "metadata") : metadata
  capped(checked, limits.metadataBytes, "metadata")
  return checked
}

function fieldValue(name: string, field: FieldAttribute, value: unknown): unknown {
  const invalid = () => new CommentsError("INVALID_INPUT", `The "${name}" field isn't valid.`)
  if (value === null) {
    if (field.required === false) {
      return null
    }
    throw invalid()
  }
  const { type } = field
  if (Array.isArray(type)) {
    if (typeof value === "string" && type.includes(value)) {
      return value
    }
    throw invalid()
  }
  switch (type) {
    case "string":
    case "number":
    case "boolean":
      if (typeof value === type && (type !== "number" || Number.isFinite(value))) {
        return value
      }
      throw invalid()
    case "date": {
      // JSON carries dates as strings.
      if (value instanceof Date || typeof value === "string") {
        const date = new Date(value)
        if (!Number.isNaN(date.getTime())) {
          return date
        }
      }
      throw invalid()
    }
    case "string[]":
    case "number[]": {
      const item = type === "string[]" ? "string" : "number"
      if (Array.isArray(value) && value.every((entry) => typeof entry === item)) {
        return value
      }
      throw invalid()
    }
    default:
      capped(value, limits.metadataBytes, `"${name}" field`)
      return value
  }
}

/** Checks values for an app's additional fields. Fields it didn't declare are refused. */
export function checkFields(
  declared: Readonly<Record<string, FieldAttribute>>,
  values: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> {
  const checked: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(values ?? {})) {
    if (value === undefined) {
      continue
    }
    const field = Object.hasOwn(declared, name) ? declared[name] : undefined
    if (!field) {
      throw new CommentsError("INVALID_INPUT", `There's no "${name}" field.`)
    }
    checked[name] = fieldValue(name, field, value)
  }
  return checked
}
