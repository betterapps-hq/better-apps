/** The longest reaction, in UTF-16 code units, enough for the longest emoji sequences and an app's own names. */
export const maxEmojiLength = 64

// One emoji element: a pictograph, optionally in emoji style and with a skin tone.
const element = String.raw`\p{Extended_Pictographic}️?\p{Emoji_Modifier}?`
// A whole emoji: a flag of two regional indicators, a keycap, or elements joined by zero-width joiners, the first of
// which may carry tags, as subdivision flags such as 🏴󠁧󠁢󠁳󠁣󠁴󠁿 do.
const sequence = new RegExp(
  String.raw`^(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|${element}(?:[\u{E0020}-\u{E007E}]+\u{E007F})?(?:‍${element})*)$`,
  "u"
)
const textStyle = /^\p{Emoji}$/u
const emojiStyle = /^\p{Emoji_Presentation}$/u
const modifier = /^\p{Emoji_Modifier}$/u

/** Whether a string is exactly one emoji, such as `👍🏽`, `👩‍💻`, `🇳🇿` or `1️⃣`, and nothing else. */
export function isEmoji(value: string): boolean {
  return value.length > 0 && value.length <= maxEmojiLength && sequence.test(value)
}

/**
 * The one spelling reactions store for an emoji, so `❤` and `❤️` are the same reaction: each character that shows as
 * text by default is followed by the emoji-style selector, U+FE0F, unless a skin tone follows it. Strings that aren't
 * emoji, such as `:shipit:`, are returned unchanged.
 */
export function normalizeEmoji(value: string): string {
  const points = [...value.replace(/️/g, "")]
  let normalized = ""
  for (const [index, point] of points.entries()) {
    normalized += point
    const next = points[index + 1]
    if (textStyle.test(point) && !emojiStyle.test(point) && !(next !== undefined && modifier.test(next))) {
      normalized += "️"
    }
  }
  return isEmoji(normalized) ? normalized : value
}
