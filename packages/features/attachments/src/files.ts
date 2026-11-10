// Pure rules about files: cleaning up names and media types, matching them against limits, and how a download is
// presented to the browser.

const maxNameLength = 255

/**
 * A file name safe to store and show: the last part of a path, without control characters, trimmed, at most 255
 * characters, keeping the extension when it shortens one. `file` when nothing is left.
 */
export function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ""
  const visible = Array.from(base)
    .filter((char) => {
      const code = char.codePointAt(0) as number
      return code > 0x1f && code !== 0x7f
    })
    .join("")
  const cleaned = visible.trim().replace(/^\.+$/, "")
  if (cleaned === "") {
    return "file"
  }
  const characters = Array.from(cleaned)
  if (characters.length <= maxNameLength) {
    return cleaned
  }
  const dot = cleaned.lastIndexOf(".")
  const extension = dot > 0 ? Array.from(cleaned.slice(dot)) : []
  if (extension.length > 0 && extension.length < 16) {
    return characters.slice(0, maxNameLength - extension.length).join("") + extension.join("")
  }
  return characters.slice(0, maxNameLength).join("")
}

const token = "[a-z0-9!#$&^_.+-]+"
const mediaType = new RegExp(`^${token}/${token}$`)
const pattern = new RegExp(`^(?:${token}/${token}|${token}/\\*|\\*/\\*)$`)

/** A media type in lower case without parameters, such as `image/png`, or `null` when it isn't one. */
export function cleanContentType(contentType: string): string | null {
  const type = (contentType.split(";")[0] ?? "").trim().toLowerCase()
  return mediaType.test(type) ? type : null
}

/** Checks a list of allowed media types, as `image/*` or exact types, and returns it in lower case. */
export function cleanContentTypes(list: readonly string[], where: string): string[] {
  return list.map((entry) => {
    const type = entry.trim().toLowerCase()
    if (!pattern.test(type)) {
      throw new Error(`${where} lists "${entry}", which isn't a media type such as "image/png" or "image/*".`)
    }
    return type
  })
}

/** Whether a media type is in an allowed list, or the list allows any. */
export function allowsType(allowed: readonly string[] | null, contentType: string): boolean {
  if (!allowed) {
    return true
  }
  const [kind] = contentType.split("/")
  return allowed.some((entry) => entry === "*/*" || entry === contentType || entry === `${kind}/*`)
}

/** Types a browser shows in place without risk to the app's origin. Everything else downloads. */
const inlineTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
  "text/plain"
])

/** Whether a file is shown in place, rather than downloaded. */
export function isInline(contentType: string): boolean {
  const [kind] = contentType.split("/")
  return inlineTypes.has(contentType) || kind === "audio" || kind === "video"
}

/** Image types previews can be made of. */
export const previewTypes: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif"
])

/**
 * A `Content-Disposition` header: `inline` or `attachment`, with the name as RFC 5987 `filename*` and an ASCII
 * `filename` for older clients.
 */
export function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/** A file name as a URL path segment. */
export function nameSegment(name: string): string {
  return encodeURIComponent(name)
}
