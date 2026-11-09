import { BetterAppsError } from "better-apps"

/** The codes domains answers with. */
export type DomainsErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "LIMIT_EXCEEDED"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"

/** An error domains returns on purpose. `PROVIDER_ERROR` answers 502, since the provider failed rather than the call. */
export class DomainsError extends BetterAppsError {
  declare readonly code: DomainsErrorCode

  constructor(code: DomainsErrorCode, message: string = code, options: { cause?: unknown } = {}) {
    super(code, message, { ...options, status: code === "PROVIDER_ERROR" ? 502 : undefined })
    this.name = "DomainsError"
  }
}
