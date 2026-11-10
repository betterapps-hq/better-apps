// Calendar days in a time zone, for clicks per day. Intl does the zone arithmetic, so no time zone data ships here.
import { ShortLinksError } from "./errors.js"

const slotMs = 15 * 60 * 1000
const dayMs = 24 * 60 * 60 * 1000
/** How far from a day's midnight in UTC its start can be. */
const scanMs = 15 * 60 * 60 * 1000

/**
 * The first and last days clicks are counted on. Since 1980, every zone's offset has been a whole number of 15 minutes,
 * which slots rely on. Before then, some weren't, such as Monrovia's until 1972.
 */
export const dayLimits = { first: "1980-01-01", last: "9998-12-31" } as const

/** The longest range clicks are counted over, in days. */
export const maxRangeDays = 366

/**
 * The start of the 15-minute slot a time falls in, in UTC. Since 1980, every time zone's offset has been a whole number
 * of 15 minutes, so no slot spans two days in any zone.
 */
export function slotOf(date: Date): Date {
  return new Date(Math.floor(date.getTime() / slotMs) * slotMs)
}

/** A time zone's calendar, from an IANA name such as `Europe/Paris`. */
export interface Zone {
  /** The calendar day a time falls on there, as `YYYY-MM-DD`. */
  dateOf: (time: number) => string
  /** The first moment of a calendar day there. */
  startOf: (date: string) => number
}

// IANA names only, such as `UTC`, `Etc/GMT+5` and `America/Argentina/Buenos_Aires`. Offsets such as `+05:07` aren't
// whole 15-minute slots.
const zoneName = /^[A-Za-z][\w+-]*(\/[\w+-]+)*$/

/** The calendar of an IANA time zone, or the error that says it isn't one. */
export function zoneOf(timeZone: string): Zone {
  let format: Intl.DateTimeFormat | undefined
  if (zoneName.test(timeZone)) {
    try {
      format = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric"
      })
    } catch {
      // Reported below.
    }
  }
  if (!format) {
    throw new ShortLinksError(
      "INVALID_INPUT",
      `"${timeZone}" isn't a time zone. Use an IANA name, such as Europe/Paris.`
    )
  }
  const zoned = format
  const fields = (time: number) => {
    const values: Record<string, number> = {}
    for (const part of zoned.formatToParts(time)) {
      if (part.type !== "literal") {
        values[part.type] = Number(part.value)
      }
    }
    return values as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>
  }
  const dateOf = (time: number) => {
    const { year, month, day } = fields(time)
    return calendarDate(Date.UTC(year, month - 1, day))
  }
  const startOf = (date: string) => {
    // A day starts at a slot's edge, since offsets are whole slots, within 15 hours of its midnight in UTC, as no offset
    // is larger. The first slot that falls on it is its start, even where midnight is skipped or happens twice. A day a
    // zone skips altogether starts where the next day does.
    const midnight = Date.parse(`${date}T00:00:00Z`)
    const last = midnight + scanMs
    for (let time = midnight - scanMs; time <= last; time += slotMs) {
      if (dateOf(time) >= date) {
        return time
      }
    }
    return last
  }
  return { dateOf, startOf }
}

/** A UTC midnight as `YYYY-MM-DD`. */
function calendarDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

/** The calendar day after one. */
export function nextDate(date: string): string {
  return calendarDate(Date.parse(`${date}T00:00:00Z`) + dayMs)
}

/** Whether a string is a real calendar day, as `YYYY-MM-DD`. */
export function isDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    calendarDate(Date.parse(`${value}T00:00:00Z`)) === value
  )
}

/** A range of calendar days in a zone, from `from` to `to`, both included. */
export interface DayRange {
  zone: Zone
  /** Every day in the range, in order. */
  dates: string[]
  /** The first moment of `from`, and the first moment after `to`, in the zone. */
  start: Date
  end: Date
}

/** The days from `from` to `to` in a zone, or the error that says why the range doesn't work. */
export function rangeOf(input: { from: string; to: string; timeZone?: string | undefined }): DayRange {
  const { from, to } = input
  if (!isDate(from) || !isDate(to)) {
    throw new ShortLinksError("INVALID_INPUT", "Enter days as YYYY-MM-DD, such as 2026-11-10.")
  }
  if (from < dayLimits.first || to > dayLimits.last) {
    throw new ShortLinksError("INVALID_INPUT", `Pick days from ${dayLimits.first} to ${dayLimits.last}.`)
  }
  if (to < from) {
    throw new ShortLinksError("INVALID_INPUT", "The range's last day can't come before its first.")
  }
  const length = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs + 1
  if (length > maxRangeDays) {
    throw new ShortLinksError("INVALID_INPUT", `Pick a range of up to ${maxRangeDays} days.`)
  }
  const zone = zoneOf(input.timeZone ?? "UTC")
  const dates = [from]
  while (dates.length < length) {
    dates.push(nextDate(dates.at(-1) as string))
  }
  return { zone, dates, start: new Date(zone.startOf(from)), end: new Date(zone.startOf(nextDate(to))) }
}
