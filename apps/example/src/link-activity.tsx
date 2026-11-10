import { useBetterApps } from "@better-apps/react"
import type { ClickDimension, ClicksBy, ShortLink } from "@better-apps/short-links/client"
import type { BetterAppsClient } from "better-apps/client"
import { useEffect, useState } from "react"
import type { App } from "./app-types"
import { plural } from "./format"

const days = 30

/** The breakdowns the panel shows, each with its heading and the words for a value. */
const breakdowns: { by: ClickDimension; title: string; label: (value: string | null) => string }[] = [
  { by: "host", title: "Domains", label: (value) => value ?? "Not recorded" },
  { by: "country", title: "Countries", label: countryName },
  {
    by: "referrer",
    title: "Referring sites",
    label: (value) => (value === null ? "Direct or hidden" : siteName(value))
  },
  {
    by: "outcome",
    title: "Access",
    label: (value) => (value === "granted" ? "Gave access" : "Opened")
  }
]

type Activity = { state: "loading" } | { state: "error" } | { state: "ready"; results: ClicksBy[] }

/**
 * Where the links were opened over the last 30 days: on which domain, from which country and site, and whether they
 * gave access, for the first 50 links listed. Countries come from Cloudflare, so a local run shows them as unknown.
 */
export function LinkActivity({ links }: { links: readonly ShortLink[] }) {
  const client = useBetterApps<BetterAppsClient<App>>()
  const [activity, setActivity] = useState<Activity>({ state: "loading" })
  // Asked again when a link is added, removed or opened. `clicksBy` takes 50 links at most, more than two loaded pages.
  const key = links
    .slice(0, 50)
    .map((link) => `${link.id}:${link.clicks}`)
    .join(",")

  useEffect(() => {
    if (key === "") {
      return
    }
    let current = true
    const range = lastDays(days)
    const ids = key.split(",").map((entry) => entry.split(":")[0] ?? "")
    Promise.all(breakdowns.map(async ({ by }) => client.shortLinks.clicksBy({ ids, by, ...range, limit: 5 })))
      .then((results) => current && setActivity({ state: "ready", results }))
      .catch(() => current && setActivity({ state: "error" }))
    return () => {
      current = false
    }
  }, [client, key])

  if (links.length === 0) {
    return null
  }
  const total = activity.state === "ready" ? (activity.results[0]?.total ?? 0) : 0
  return (
    <section className="link-activity" aria-labelledby="link-activity-title">
      <h3 id="link-activity-title">Last {days} days</h3>
      {activity.state === "loading" && <p className="muted">Loading activity</p>}
      {activity.state === "error" && <p className="form-error">Activity couldn’t load. Try again in a moment.</p>}
      {activity.state === "ready" && total === 0 && <p className="muted">Not opened in the last {days} days.</p>}
      {activity.state === "ready" && total > 0 && (
        <>
          <p className="muted">Opened {plural(total, "time", "times")}.</p>
          <div className="link-activity-grid">
            {breakdowns.map(({ by, title, label }, index) => (
              <div key={by}>
                <h4>{title}</h4>
                <ul>
                  {(activity.results[index]?.values ?? []).map(({ value, clicks }) => (
                    <li key={value ?? ""}>
                      <span>{label(value)}</span>
                      <span className="link-activity-count">
                        {clicks}
                        <span className="visually-hidden">{clicks === 1 ? " open" : " opens"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

/** The last `count` days where the viewer is, today included. */
function lastDays(count: number) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  // Canadian English writes dates as YYYY-MM-DD.
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
  const now = Date.now()
  return { from: format.format(now - (count - 1) * 86_400_000), to: format.format(now), timeZone }
}

const regions = new Intl.DisplayNames(["en-US"], { type: "region" })

/** A country's name, such as Germany for `DE`, or the code itself for Cloudflare's own, such as Tor's `T1`. */
function countryName(code: string | null) {
  if (code === null) {
    return "Unknown"
  }
  try {
    return regions.of(code) ?? code
  } catch {
    return code
  }
}

/** A site's hostname, such as news.example for `https://news.example`. */
function siteName(origin: string) {
  return URL.canParse(origin) ? new URL(origin).host : origin
}
