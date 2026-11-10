import { BetterAppsError, type StandardSchemaIssue } from "better-apps"

/** The codes attachments answer with. */
export type AttachmentsErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "PAYLOAD_TOO_LARGE"
  | "LIMIT_EXCEEDED"
  | "CONFLICT"

/** An error attachments return on purpose. `PAYLOAD_TOO_LARGE` answers 413. */
export class AttachmentsError extends BetterAppsError {
  declare readonly code: AttachmentsErrorCode

  constructor(
    code: AttachmentsErrorCode,
    message: string = code,
    options: { issues?: readonly StandardSchemaIssue[] | undefined; cause?: unknown } = {}
  ) {
    super(code, message, { ...options, ...(code === "PAYLOAD_TOO_LARGE" ? { status: 413 } : {}) })
    this.name = "AttachmentsError"
  }
}
