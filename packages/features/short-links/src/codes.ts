// Lowercase letters and digits, so codes compare alike on every database, whatever its collation.
const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
// The largest multiple of 36 a byte holds. Bytes at or above it are drawn again, so every character is equally likely.
const unbiased = 252

/** Code lengths and limits. */
export const codeLimits = {
  /** The shortest and longest generated codes. */
  minGenerated: 6,
  maxGenerated: 32,
  defaultLength: 8,
  /** The longest code. */
  maxCode: 64,
  /**
   * The length of the random part of a code that grants access, since the code is all it takes to see the record:
   * the whole of a generated code, or what follows a chosen one.
   */
  granting: 12
} as const

/** A random code of lowercase letters and digits, from `crypto.getRandomValues`, without bias. */
export function generateCode(length: number = codeLimits.defaultLength): string {
  let code = ""
  while (code.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < unbiased && code.length < length) {
        code += alphabet[byte % alphabet.length]
      }
    }
  }
  return code
}

const validCode = new RegExp(`^[A-Za-z0-9_-]{1,${codeLimits.maxCode}}$`)

/** Whether a code can be a link's: 1 to 64 letters, digits, `-` and `_`. */
export function isValidCode(code: string): boolean {
  return validCode.test(code)
}

/** A code as links store it. Codes aren't case-sensitive, so `Sale` and `sale` are the same link. */
export function normalizeCode(code: string): string {
  return code.toLowerCase()
}
