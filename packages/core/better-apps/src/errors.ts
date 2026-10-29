import type { StandardSchemaIssue } from "./standard-schema.js"

/**
 * Why an action failed. The handler sends the code to the client, which uses it to roll back optimistic changes.
 * Features may add codes of their own, which return 400 unless the error names a status.
 */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "LIMIT_EXCEEDED"
  | "RATE_LIMITED"
  | (string & {})

const statuses: Readonly<Record<string, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  CONFLICT: 409,
  LIMIT_EXCEEDED: 400,
  RATE_LIMITED: 429
}

/** One reason an input isn't valid, with its path as plain keys so it survives JSON. */
export interface InputIssue {
  message: string
  path?: (string | number)[] | undefined
}

function toInputIssue({ message, path }: StandardSchemaIssue): InputIssue {
  if (!path) {
    return { message }
  }
  const keys = path.map((segment) => (typeof segment === "object" ? segment.key : segment))
  return { message, path: keys.map((key) => (typeof key === "number" ? key : String(key))) }
}

/** An error an action throws on purpose. Its code and message reach the caller; any other error is hidden. */
export class BetterAppsError extends Error {
  readonly code: ErrorCode
  /** The HTTP status the handler responds with. */
  readonly status: number
  /** What's wrong with the input, for `INVALID_INPUT`. */
  readonly issues: InputIssue[] | undefined

  constructor(
    code: ErrorCode,
    message: string = code,
    options: { status?: number | undefined; issues?: readonly StandardSchemaIssue[] | undefined; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause })
    this.name = "BetterAppsError"
    this.code = code
    // An own-property check, so codes such as `constructor` don't read the object's prototype.
    this.status = options.status ?? (Object.hasOwn(statuses, code) ? statuses[code] : undefined) ?? 400
    this.issues = options.issues?.map(toInputIssue)
  }
}
