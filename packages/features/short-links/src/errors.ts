import { BetterAppsError, type StandardSchemaIssue } from "better-apps"

/** The codes short links answer with. */
export type ShortLinksErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "CONFLICT"

/** An error short links return on purpose. */
export class ShortLinksError extends BetterAppsError {
  declare readonly code: ShortLinksErrorCode

  constructor(
    code: ShortLinksErrorCode,
    message: string = code,
    options: { issues?: readonly StandardSchemaIssue[] | undefined; cause?: unknown } = {}
  ) {
    super(code, message, options)
    this.name = "ShortLinksError"
  }
}
