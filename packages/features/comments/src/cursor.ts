import { CommentsError } from "./errors.js"

// A page cursor holds the last row's sort time and id, so rows that share a time are never skipped or repeated.

/** Encodes the position after a row. */
export function encodeCursor(time: Date, id: string): string {
  return btoa(JSON.stringify([time.toISOString(), id]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/** Decodes a cursor from `encodeCursor`, or refuses it as `INVALID_INPUT`. */
export function decodeCursor(cursor: string): { time: Date; id: string } {
  try {
    const [time, id] = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/"))) as unknown[]
    const date = new Date(String(time))
    if (typeof time === "string" && typeof id === "string" && !Number.isNaN(date.getTime())) {
      return { time: date, id }
    }
  } catch {
    // Reported below.
  }
  throw new CommentsError("INVALID_INPUT", "That page cursor isn't valid.")
}
