import { BetterAppsError, type StandardSchemaIssue } from "better-apps"

/** The codes reactions answer with. */
export type ReactionsErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "CONFLICT"

/** An error reactions return on purpose. */
export class ReactionsError extends BetterAppsError {
  declare readonly code: ReactionsErrorCode

  constructor(
    code: ReactionsErrorCode,
    message: string = code,
    options: { issues?: readonly StandardSchemaIssue[] | undefined; cause?: unknown } = {}
  ) {
    super(code, message, options)
    this.name = "ReactionsError"
  }
}
