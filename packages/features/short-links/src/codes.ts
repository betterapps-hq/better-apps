const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
// The largest multiple of 62 a byte holds. Bytes at or above it are drawn again, so every character is equally likely.
const unbiased = 248

/** Code lengths and limits. */
export const codeLimits = {
  /** The shortest and longest generated codes. */
  minGenerated: 6,
  maxGenerated: 32,
  defaultLength: 8,
  /** The longest custom code. */
  maxCustom: 64,
  /** The shortest code a link that grants access may have, since the code is all it takes to see the record. */
  minGranting: 8
} as const

/** A random code of letters and digits, from `crypto.getRandomValues`, without bias. */
export function generateCode(length: number = codeLimits.defaultLength): string {
  let code = ""
  while (code.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < unbiased && code.length < length) {
        code += alphabet[byte % 62]
      }
    }
  }
  return code
}

const customCode = new RegExp(`^[A-Za-z0-9_-]{1,${codeLimits.maxCustom}}$`)

/** Whether a code an app chose can be a link's: 1 to 64 letters, digits, `-` and `_`. */
export function isValidCode(code: string): boolean {
  return customCode.test(code)
}
