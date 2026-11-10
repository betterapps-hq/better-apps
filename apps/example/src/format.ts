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

/** Totals amounts per currency, largest first, so mixed currencies are never added together. */
export function totalsByCurrency(items: readonly { amount: number; currency: string }[]) {
  const totals = new Map<string, number>()
  for (const { amount, currency } of items) {
    totals.set(currency, (totals.get(currency) ?? 0) + amount)
  }
  return [...totals].sort(([, a], [, b]) => b - a).map(([currency, amount]) => ({ currency, amount }))
}

/** A count of things in words, such as "1 invoice" or "3 invoices". */
export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

/** A file's size, such as "820 bytes", "14 KB" or "2.5 MB". */
export function formatSize(bytes: number) {
  if (bytes < 1024) {
    return plural(bytes, "byte", "bytes")
  }
  const [amount, unit] = bytes < 1024 * 1024 ? [bytes / 1024, "KB"] : [bytes / (1024 * 1024), "MB"]
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(amount)} ${unit}`
}
