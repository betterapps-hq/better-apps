// Copies Better Auth source into src/vendor/better-auth. Files stay verbatim apart from the import rewrites below and a
// banner, so a new upstream release can be taken by rerunning this script. Usage: pnpm sync:better-auth [version]
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, posix, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Project, SyntaxKind, type StringLiteral } from "ts-morph"

const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const vendorRoot = resolve(packageRoot, "src/vendor/better-auth")
const repository = "better-auth/better-auth"

// Upstream paths to copy. They keep their upstream location under the vendor folder.
const files = ["packages/cli/src/generators/drizzle.ts", "packages/cli/src/generators/types.ts"]

// Every other import must be vendored, a published @better-auth/core subpath, a Node built-in, or an external below.
// Targets under src/ are Buildkit replacements; the rest are package specifiers.
const rewrites: Record<string, string> = {
  "better-auth/db": "src/replacements/db.ts",
  "better-auth/types": "@better-auth/core",
  "better-auth/adapters": "@better-auth/core/db/adapter"
}

// Packages vendored files import directly, with the upstream manifest that declares their version range.
const externals: Record<string, string> = { prettier: "packages/cli/package.json" }

async function get(url: string, accept?: string) {
  const headers: Record<string, string> = { "User-Agent": "buildkit-better-auth-sync" }
  if (accept) {
    headers.Accept = accept
  }
  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`${response.status}: ${url}`)
  }
  return response
}

const hash = (text: string) => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex")

const version =
  process.argv[2] ??
  ((await (await get("https://registry.npmjs.org/@better-auth/core/latest")).json()) as { version: string }).version
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
const raw = async (path: string) =>
  (await get(`https://raw.githubusercontent.com/${repository}/${revision}/${path}`)).text()

const usedRewrites = new Set<string>()
const toImport = (fromFile: string, target: string) => {
  const path = relative(dirname(fromFile), target).replaceAll("\\", "/").replace(/\.ts$/, ".js")
  return path.startsWith(".") ? path : `./${path}`
}

function resolveSpecifier(specifier: string, upstreamPath: string): string {
  const rewrite = rewrites[specifier]
  if (rewrite) {
    usedRewrites.add(specifier)
    return rewrite.startsWith("src/")
      ? toImport(resolve(vendorRoot, upstreamPath), resolve(packageRoot, rewrite))
      : rewrite
  }
  if (specifier.startsWith(".")) {
    const target = posix.join(posix.dirname(upstreamPath), specifier)
    if (files.includes(`${target}.ts`)) {
      return `${specifier}.js`
    }
    if (files.includes(`${target}/index.ts`)) {
      return `${specifier}/index.js`
    }
    throw new Error(`${upstreamPath} imports ${specifier}, which is not vendored. Add it to the vendored files.`)
  }
  if (
    specifier.startsWith("node:") ||
    specifier === "@better-auth/core" ||
    specifier.startsWith("@better-auth/core/") ||
    specifier in externals
  ) {
    return specifier
  }
  throw new Error(`${upstreamPath} imports ${specifier}. Vendor it, add a rewrite, or declare it as an external.`)
}

const project = new Project({ useInMemoryFileSystem: true })
function rewriteImports(upstreamPath: string, text: string) {
  const source = project.createSourceFile(upstreamPath, text, { overwrite: true })
  const literals: StringLiteral[] = []
  for (const declaration of [...source.getImportDeclarations(), ...source.getExportDeclarations()]) {
    const specifier = declaration.getModuleSpecifier()
    if (specifier) {
      literals.push(specifier)
    }
  }
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const argument = call.getArguments()[0]
    if (call.getExpression().getKind() === SyntaxKind.ImportKeyword && argument?.isKind(SyntaxKind.StringLiteral)) {
      literals.push(argument)
    }
  }
  for (const type of source.getDescendantsOfKind(SyntaxKind.ImportType)) {
    const literal = type.getArgument().getFirstDescendantByKind(SyntaxKind.StringLiteral)
    if (literal) {
      literals.push(literal)
    }
  }
  let result = text
  // Replace from the end so earlier positions stay valid. Quotes are kept as written upstream.
  for (const literal of literals.sort((a, b) => b.getStart() - a.getStart())) {
    const replacement = resolveSpecifier(literal.getLiteralValue(), upstreamPath)
    result = result.slice(0, literal.getStart() + 1) + replacement + result.slice(literal.getEnd() - 1)
  }
  return result
}

// Generated files such as README.md have no upstream hash.
const snapshotFiles: Record<string, { upstream?: string; vendored: string }> = {}
const outputs: Record<string, string> = {}
for (const path of files) {
  const upstream = await raw(path)
  const banner = `// Vendored from Better Auth ${version} (${path}). Do not edit. Run pnpm sync:better-auth instead.\n`
  outputs[path] = banner + rewriteImports(path, upstream)
  snapshotFiles[path] = { upstream: hash(upstream), vendored: hash(outputs[path]) }
}
const unused = Object.keys(rewrites).filter((specifier) => !usedRewrites.has(specifier))
if (unused.length) {
  throw new Error(`Upstream no longer imports ${unused.join(", ")}. Remove those rewrites.`)
}
const license = await raw("LICENSE.md")
outputs["LICENSE.md"] = license
snapshotFiles["LICENSE.md"] = { upstream: hash(license), vendored: hash(license) }
outputs["README.md"] = `# Vendored Better Auth source

Generated by \`pnpm sync:better-auth\` from Better Auth ${version}. Do not edit these files. Change
\`src/replacements/\` or the sync script, then rerun it. See [the vendoring guide](../../../docs/vendoring.md).
`
snapshotFiles["README.md"] = { vendored: hash(outputs["README.md"]) }

// Published Better Auth packages and the externals' ranges move with the vendored source. The better-apps package
// shares @better-auth/core types with this one, so its pins move too. Everything is fetched and checked before any file
// is written, so a failed sync leaves the previous one in place.
const manifestPath = resolve(packageRoot, "package.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const corePath = resolve(packageRoot, "../better-apps/package.json")
const core = JSON.parse(readFileSync(corePath, "utf8"))
for (const pkg of [manifest, core]) {
  pkg.dependencies["@better-auth/core"] = version
  pkg.devDependencies["@better-auth/drizzle-adapter"] = version
}
for (const [name, upstreamManifest] of Object.entries(externals)) {
  const range = JSON.parse(await raw(upstreamManifest)).dependencies?.[name]
  if (!range) {
    throw new Error(`${upstreamManifest} no longer declares ${name}`)
  }
  manifest.dependencies[name] = range
}

rmSync(vendorRoot, { recursive: true, force: true })
for (const [path, text] of Object.entries(outputs)) {
  mkdirSync(dirname(resolve(vendorRoot, path)), { recursive: true })
  writeFileSync(resolve(vendorRoot, path), text)
}
writeFileSync(
  resolve(vendorRoot, "snapshot.json"),
  JSON.stringify({ repository: `https://github.com/${repository}`, version, revision, files: snapshotFiles }, null, 2) +
    "\n"
)
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
writeFileSync(corePath, JSON.stringify(core, null, 2) + "\n")

process.stdout.write(`Vendored Better Auth ${version} (${revision}): ${files.length} files. Run pnpm install next.\n`)
