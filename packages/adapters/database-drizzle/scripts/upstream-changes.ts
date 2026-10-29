// Reports which Better Auth files this package is forked from changed since the base release in upstream.json, so their
// fixes can be ported. Usage: pnpm upstream:changes [version] [--update]
// --update records the release as the new base. Run it once its changes are ported.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

interface Upstream {
  repository: string
  package: string
  version: string
  revision: string
  files: Record<string, { forks: string[]; sha256: string }>
}

const manifestPath = fileURLToPath(new URL("../upstream.json", import.meta.url))
const upstream = JSON.parse(readFileSync(manifestPath, "utf8")) as Upstream
const repository = new URL(upstream.repository).pathname.slice(1)
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { update: { type: "boolean", default: false } }
})

async function get(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "buildkit-better-apps-upstream" } })
  if (!response.ok) {
    throw new Error(`${response.status}: ${url}`)
  }
  return response
}

const hash = (text: string) => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex")

const version =
  positionals[0] ??
  ((await (await get(`https://registry.npmjs.org/${upstream.package}/latest`)).json()) as { version: string }).version
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Expected a stable release version such as 1.7.14, not ${version}`)
}
let ref = (await (await get(`https://api.github.com/repos/${repository}/git/ref/tags/v${version}`)).json()) as {
  object: { sha: string; type: string; url: string }
}
while (ref.object.type === "tag") {
  ref = (await (await get(ref.object.url)).json()) as typeof ref
}
const revision = ref.object.sha

const changed: string[] = []
const missing: string[] = []
const files: Upstream["files"] = {}
for (const [path, file] of Object.entries(upstream.files)) {
  const response = await fetch(`https://raw.githubusercontent.com/${repository}/${revision}/${path}`)
  if (response.status === 404) {
    missing.push(`  ${path} (forked into ${file.forks.join(", ")})`)
    continue
  }
  if (!response.ok) {
    throw new Error(`${response.status}: ${path}`)
  }
  const sha256 = hash(await response.text())
  files[path] = { ...file, sha256 }
  if (sha256 !== file.sha256) {
    changed.push(`  ${path} (forked into ${file.forks.join(", ")})`)
  }
}

const range = `Better Auth ${upstream.version} and ${version}`
if (!changed.length && !missing.length) {
  process.stdout.write(`The forked files are the same in ${range}.\n`)
} else {
  if (changed.length) {
    process.stdout.write(`Changed between ${range}:\n${changed.join("\n")}\n`)
  }
  if (missing.length) {
    process.stdout.write(`Moved or removed in ${version}:\n${missing.join("\n")}\n`)
  }
  process.stdout.write(`Compare: ${upstream.repository}/compare/${upstream.revision}...${revision}\n`)
}

if (values.update) {
  if (missing.length) {
    throw new Error("Point upstream.json at the files' new paths before recording a new base.")
  }
  writeFileSync(manifestPath, JSON.stringify({ ...upstream, version, revision, files }, null, 2) + "\n")
  process.stdout.write(`Recorded Better Auth ${version} (${revision}) as the base.\n`)
}
