import type { LinkClick, LinkGrant, OpenedLink } from "./events.js"
import { ownerOf } from "./link.js"
import type { LinkEventOptions } from "./options.js"
import type { LinkRow } from "./schema.js"

/** How often opening links emits events, checked once when the feature is created. */
export interface EventSettings {
  clickRate: number
  /** Click counts that emit `link.milestone`, smallest first. */
  milestones: readonly number[]
  notFoundPerMinute: number
}

const defaultMilestones = [1, 10, 100, 1000, 10_000] as const

/** `events` with its defaults, or the setup error that says what's wrong. */
export function eventSettings(options: LinkEventOptions = {}): EventSettings {
  const clickRate = options.clickRate ?? 1
  if (!Number.isFinite(clickRate) || clickRate < 0 || clickRate > 1) {
    throw new Error("`events.clickRate` must be a number from 0 to 1, such as 0.1 for 1 open in 10.")
  }
  const milestones = options.milestones ?? defaultMilestones
  if (!milestones.every((count) => Number.isSafeInteger(count) && count > 0)) {
    throw new Error("`events.milestones` must be whole numbers above 0, such as [1, 10, 100].")
  }
  const notFoundPerMinute = options.notFoundPerMinute ?? 10
  if (!Number.isSafeInteger(notFoundPerMinute) || notFoundPerMinute < 0) {
    throw new Error("`events.notFoundPerMinute` must be a whole number, 0 or more.")
  }
  return { clickRate, milestones: [...new Set(milestones)].sort((a, b) => a - b), notFoundPerMinute }
}

/** The milestones a count passed when it went from `before` to `after`. */
export function passed(settings: EventSettings, before: number, after: number): number[] {
  return settings.milestones.filter((count) => count > before && count <= after)
}

/** Whose link was opened, and where, for the events about opening it. */
export function opened(row: LinkRow, host: string): OpenedLink {
  return {
    linkId: row.id,
    owner: ownerOf(row.owner),
    orgId: row.orgId === "" ? null : row.orgId,
    subject:
      row.subjectType !== null && row.subjectId !== null
        ? { subjectType: row.subjectType, subjectId: row.subjectId }
        : null,
    host
  }
}

export function click(
  settings: EventSettings,
  row: LinkRow,
  host: string,
  at: Date,
  { granted, forwardedTo }: Pick<LinkClick, "granted" | "forwardedTo">
): LinkClick {
  return { ...opened(row, host), granted, forwardedTo, clickedAt: at, sampleRate: settings.clickRate }
}

export function grant(row: LinkRow, host: string, at: Date): LinkGrant | null {
  const link = opened(row, host)
  return link.subject === null ? null : { ...link, subject: link.subject, grantedAt: at }
}

/** Whether this open is sampled for `link.clicked`. */
export function sampled(settings: EventSettings): boolean {
  return settings.clickRate > 0 && Math.random() < settings.clickRate
}

// Hosts a limiter counts at once. Past it, new hosts wait for the next minute, so many hosts can't grow memory.
const maxHosts = 1000

/**
 * Allows up to `perMinute` events a host each minute, counted in this running copy of the app. A new minute starts every
 * count again.
 */
export function perMinuteLimit(perMinute: number): (host: string, now: Date) => boolean {
  let minute = -1
  const counts = new Map<string, number>()
  return (host, now) => {
    if (perMinute === 0) {
      return false
    }
    const current = Math.floor(now.getTime() / 60_000)
    if (current !== minute) {
      minute = current
      counts.clear()
    }
    const count = counts.get(host)
    if (count === undefined ? counts.size >= maxHosts : count >= perMinute) {
      return false
    }
    counts.set(host, (count ?? 0) + 1)
    return true
  }
}
