// A fixed locale and time zone, so the server and the browser render the same text.
const locale = "en-US"

/** Formats an amount in the currency's minor unit, such as cents. */
export function formatMoney(amount: number, currency: string) {
  const format = new Intl.NumberFormat(locale, { style: "currency", currency })
  return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2))
}

/** Formats a `YYYY-MM-DD` calendar date. */
export function formatDate(date: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))
}

/** Formats a moment in UTC, and says so. */
export function formatTime(time: Date) {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(time)
}
