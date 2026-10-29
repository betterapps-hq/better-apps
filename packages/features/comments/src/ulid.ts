// ULIDs: 48 bits of time and 80 random bits in Crockford's base 32, so ids sort roughly by creation and a client can
// make one before the server sees the write.
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const pattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/

/** Makes a ULID, such as the id of a comment a client is about to write. */
export function ulid(time: number = Date.now()): string {
  let timePart = ""
  let rest = Math.floor(time)
  for (let index = 0; index < 10; index += 1) {
    timePart = alphabet[rest % 32] + timePart
    rest = Math.floor(rest / 32)
  }
  // 256 is a multiple of 32, so each byte maps to a character without bias.
  const random = crypto.getRandomValues(new Uint8Array(16))
  let randomPart = ""
  for (const byte of random) {
    randomPart += alphabet[byte % 32]
  }
  return timePart + randomPart
}

/** Whether a value is a ULID in canonical upper case. */
export function isUlid(value: unknown): value is string {
  return typeof value === "string" && pattern.test(value)
}
