// Tokens for uploads through the server, and signatures for download URLs, on Web Crypto.

const encoder = new TextEncoder()

/** Bytes as unpadded base64url. */
export function base64url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Bytes from unpadded base64url, or `null` when it isn't. */
function fromBase64url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[\w-]*$/.test(value)) {
    return null
  }
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/** A random token of 32 bytes, as base64url. */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

/** The SHA-256 of a string, as hex, which is what the database keeps of an upload token. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Signs and checks download URLs with an app's secret. */
export interface Signer {
  sign(fileId: string, expires: number): Promise<string>
  verify(fileId: string, expires: number, signature: string, now: number): Promise<boolean>
}

/** A signer for one secret, with the HMAC key imported once. */
export function createSigner(secret: string): Signer {
  if (secret.length < 32) {
    throw new Error("The attachments `secret` must be at least 32 characters.")
  }
  const key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify"
  ])
  const message = (fileId: string, expires: number) => encoder.encode(`attachments:${fileId}:${expires}`)
  const sign = async (fileId: string, expires: number) =>
    base64url(new Uint8Array(await crypto.subtle.sign("HMAC", await key, message(fileId, expires))))
  return {
    sign,
    async verify(fileId, expires, signature, now) {
      if (!Number.isSafeInteger(expires) || expires * 1000 <= now) {
        return false
      }
      const bytes = fromBase64url(signature)
      // `verify` compares in constant time.
      return bytes !== null && crypto.subtle.verify("HMAC", await key, bytes, message(fileId, expires))
    }
  }
}
