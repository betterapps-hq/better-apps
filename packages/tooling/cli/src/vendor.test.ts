import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vite-plus/test"

const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const vendorRoot = resolve(packageRoot, "src/vendor/better-auth")
const snapshot = JSON.parse(readFileSync(resolve(vendorRoot, "snapshot.json"), "utf8")) as {
  files: Record<string, { vendored: string }>
}
const hash = (path: string) =>
  createHash("sha256")
    .update(readFileSync(resolve(vendorRoot, path), "utf8").replaceAll("\r\n", "\n"))
    .digest("hex")

describe("vendored Better Auth source", () => {
  it.each(Object.entries(snapshot.files))("%s matches the last sync", (path, { vendored }) => {
    expect(hash(path), "Vendored files are generated. Rerun pnpm sync:better-auth instead of editing them.").toBe(
      vendored
    )
  })

  it("contains only synced files", () => {
    const present = readdirSync(vendorRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(vendorRoot, resolve(entry.parentPath, entry.name)).replaceAll("\\", "/"))
      .filter((path) => path !== "snapshot.json")
    expect(present.sort()).toEqual(Object.keys(snapshot.files).sort())
  })
})
