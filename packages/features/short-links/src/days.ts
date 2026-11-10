// Calendar days in a time zone, for clicks per day, through date-fns and its time zone support.
import { tz, TZDate } from "@date-fns/tz"
import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  format,
  isValid,
  parse,
  roundToNearestMinutes,
  startOfDay
} from "date-fns"
import { ShortLinksError } from "./errors.js"

/**
 * The first and last days clicks are counted on. Since 2011, every zone's offset has been a whole number of 15 minutes
 * and has changed only at a slot's edge without stepping the date back, which slots rely on. Before then, some didn't,
 * such as St. John's, whose clocks went back at 00:01 until November 2010.
 */
export const dayLimits = { first: "2011-01-01", last: "9998-12-31" } as const

/** The longest range clicks are counted over, in days. */
export const maxRangeDays = 366

const utc = tz("UTC")
const dayFormat = "yyyy-MM-dd"

/**
 * The start of the 15-minute slot a time falls in, in UTC. Since 2011, every time zone's offset has been a whole number
 * of 15 minutes, changing only at a slot's edge, so no slot spans two days in any zone.
 */
export function slotOf(date: Date): Date {
  return new Date(roundToNearestMinutes(date, { nearestTo: 15, roundingMethod: "floor", in: utc }).getTime())
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

/** Whether a name is a time zone the runtime knows. */
function isZone(timeZone: string): boolean {
  try {
    return zoneName.test(timeZone) && isValid(new TZDate(0, timeZone))
  } catch {
    return false
  }
}

/** The calendar of an IANA time zone, or the error that says it isn't one. */
export function zoneOf(timeZone: string): Zone {
  if (!isZone(timeZone)) {
    throw new ShortLinksError(
      "INVALID_INPUT",
      `"${timeZone}" isn't a time zone. Use an IANA name, such as Europe/Paris.`
    )
  }
  const zone = tz(timeZone)
  const dateOf = (time: number) => format(time, dayFormat, { in: zone })
  // The first moment of the day there. date-fns reads a midnight that happens twice as the second, as in Havana each
  // November, and a 23:59 the clocks skip as the moment after the jump, as in Nuuk each March, so the start is the
  // earlier of the day's midnight and the moment after the previous day's end that falls on the day. A day the zone
  // skipped altogether, such as 30 December 2011 in Samoa, starts where the next one does.
  const startOf = (date: string) => {
    const day = parse(date, dayFormat, new Date(0), { in: zone })
    const midnight = startOfDay(day).getTime()
    const afterPrevious = endOfDay(addDays(day, -1, { in: zone }), { in: zone }).getTime() + 1
    const onDay = [midnight, afterPrevious].filter((time) => dateOf(time) === date)
    return onDay.length > 0 ? Math.min(...onDay) : midnight
  }
  return { dateOf, startOf }
}

/** A day as a date at UTC midnight, or an invalid date for anything but a real `YYYY-MM-DD` day. */
function dayOf(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parse(value, dayFormat, new Date(0), { in: utc }) : new Date(Number.NaN)
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
  const first = dayOf(from)
  const last = dayOf(to)
  if (!isValid(first) || !isValid(last)) {
    throw new ShortLinksError("INVALID_INPUT", "Enter days as YYYY-MM-DD, such as 2026-11-10.")
  }
  if (from < dayLimits.first || to > dayLimits.last) {
    throw new ShortLinksError("INVALID_INPUT", `Pick days from ${dayLimits.first} to ${dayLimits.last}.`)
  }
  const length = differenceInCalendarDays(last, first, { in: utc }) + 1
  if (length < 1) {
    throw new ShortLinksError("INVALID_INPUT", "The range's last day can't come before its first.")
  }
  if (length > maxRangeDays) {
    throw new ShortLinksError("INVALID_INPUT", `Pick a range of up to ${maxRangeDays} days.`)
  }
  const zone = zoneOf(input.timeZone ?? "UTC")
  const dates = Array.from({ length }, (_, index) => format(addDays(first, index, { in: utc }), dayFormat, { in: utc }))
  const after = format(addDays(last, 1, { in: utc }), dayFormat, { in: utc })
  return { zone, dates, start: new Date(zone.startOf(from)), end: new Date(zone.startOf(after)) }
}
