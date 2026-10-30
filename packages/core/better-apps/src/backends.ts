/**
 * The adapters capability packages use, such as `@better-apps/storage`'s. Each package adds its own key to this
 * interface, so core imports none of them. A capability without an entry uses its default adapter, which is
 * Cloudflare's.
 */
// oxlint-disable-next-line typescript/no-empty-interface -- capability packages extend it
export interface Backends {}

// Kept on globalThis, so a second copy of this module, such as one a dev server loads twice, sees the same choice.
const key = Symbol.for("better-apps.backends")
const scope = globalThis as typeof globalThis & { [key]?: Partial<Record<keyof Backends, unknown>> }

/**
 * Chooses the adapters for capability packages, once, in a server module the server entry imports. Each call merges
 * into the current choice: a key left out keeps what it had, and a key set to `undefined` goes back to its default.
 * Handles look their adapter up on first use, so declarations can live in any module.
 */
export function configureBackends(backends: Backends): void {
  scope[key] = { ...scope[key], ...backends }
}

/** The configured entry for one capability, or `undefined` for its default. For capability packages. */
export function getBackend<Capability extends keyof Backends>(
  capability: Capability
): Backends[Capability] | undefined {
  return scope[key]?.[capability] as Backends[Capability] | undefined
}
