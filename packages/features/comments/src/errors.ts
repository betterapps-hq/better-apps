import { BetterAppsError, type StandardSchemaIssue } from "better-apps"

/** The codes comments answer with. The client uses them to roll back optimistic changes. */
export type CommentsErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "REJECTED_BY_HOOK"

/**
 * An error comments return on purpose. A before hook throws one to refuse a write with its code, such as `FORBIDDEN` or
 * `RATE_LIMITED`; any other error from a hook becomes `REJECTED_BY_HOOK`.
 */
export class CommentsError extends BetterAppsError {
  declare readonly code: CommentsErrorCode

  constructor(
    code: CommentsErrorCode,
    message: string = code,
    options: { issues?: readonly StandardSchemaIssue[] | undefined; cause?: unknown } = {}
  ) {
    super(code, message, options)
    this.name = "CommentsError"
  }
}
