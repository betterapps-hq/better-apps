import { globSync, readFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { Extractor, ExtractorConfig, ExtractorLogLevel } from "@microsoft/api-extractor"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const isUpdate = process.argv.includes("--update")
const reportFolder = resolve(root, "api-reports")
const modelFolder = resolve(root, "dist/api-models")
mkdirSync(reportFolder, { recursive: true })
mkdirSync(modelFolder, { recursive: true })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function typeEntry(value: unknown): string | undefined {
  if (typeof value === "string") {
    return /\.d\.[cm]?ts$/.test(value) ? value : undefined
  }
  if (!isRecord(value)) {
    return undefined
  }
  if (typeof value.types === "string") {
    return value.types
  }
  for (const condition of Object.values(value)) {
    const result = typeEntry(condition)
    if (result) {
      return result
    }
  }
  return undefined
}

// Report names: `better-apps` keeps its name, and `@better-apps/x` becomes `better-apps-x`.
function reportName(name: string): string | undefined {
  if (name === "better-apps") {
    return name
  }
  return name.startsWith("@better-apps/") ? "better-apps-" + name.slice("@better-apps/".length) : undefined
}

const expectedReports = new Set<string>()
const models: { package: string; entryPoint: string; model: string; report: string }[] = []
let hasErrors = false
for (const manifest of globSync("packages/*/*/package.json", { cwd: root }).sort()) {
  const manifestPath = resolve(root, manifest)
  const pkg: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
  if (!isRecord(pkg) || typeof pkg.name !== "string") {
    continue
  }
  const name = reportName(pkg.name)
  if (!name) {
    continue
  }
  if (!isRecord(pkg.exports)) {
    throw new Error(`${pkg.name} needs explicit exports for API discovery`)
  }
  const folder = dirname(manifestPath)
  const exports = Object.entries(pkg.exports)
  // Conditional root exports and subpath export maps are both valid package shapes.
  const entries = exports.some(([name]) => name.startsWith(".")) ? exports : [[".", pkg.exports]]
  for (const [entryPoint, conditions] of entries) {
    if (typeof entryPoint !== "string") {
      throw new Error(`Invalid entry point in ${manifest}`)
    }
    if (entryPoint.endsWith(".css")) {
      continue // Asset imports may have an empty declaration shim, but do not expose a programmatic API.
    }
    const types = typeEntry(conditions)
    if (!types) {
      continue // Stylesheets and other untyped assets have no TypeScript API.
    }
    if (entryPoint.includes("*")) {
      throw new Error(`Expand typed wildcard exports before extraction: ${pkg.name}/${entryPoint}`)
    }
    const slug = name + (entryPoint === "." ? "" : "--" + entryPoint.slice(2).replaceAll("/", "--"))
    if (expectedReports.has(slug + ".api.md")) {
      throw new Error(`API report name collision: ${slug}`)
    }
    expectedReports.add(slug + ".api.md")
    const mainEntryPointFilePath = resolve(folder, types)
    const config = ExtractorConfig.prepare({
      configObjectFullPath: undefined,
      packageJsonFullPath: manifestPath,
      configObject: {
        projectFolder: folder,
        mainEntryPointFilePath,
        compiler: {
          overrideTsconfig: {
            compilerOptions: {
              target: "ES2022",
              module: "ESNext",
              moduleResolution: "Bundler",
              jsx: "react-jsx",
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
              types: []
            },
            files: [mainEntryPointFilePath]
          },
          skipLibCheck: true
        },
        apiReport: {
          enabled: true,
          reportFileName: slug,
          reportFolder,
          reportTempFolder: resolve(root, "dist/api-report-temp")
        },
        docModel: { enabled: true, apiJsonFilePath: resolve(modelFolder, slug + ".api.json") },
        dtsRollup: { enabled: false },
        tsdocMetadata: { enabled: false },
        messages: {
          extractorMessageReporting: {
            default: { logLevel: ExtractorLogLevel.Warning },
            "ae-missing-release-tag": { logLevel: ExtractorLogLevel.None },
            "ae-undocumented": { logLevel: ExtractorLogLevel.None },
            "ae-forgotten-export": { logLevel: ExtractorLogLevel.Warning, addToApiReportFile: true }
          }
        }
      }
    })
    process.stdout.write(`API ${pkg.name}${entryPoint === "." ? "" : entryPoint.slice(1)}\n`)
    const result = Extractor.invoke(config, {
      localBuild: isUpdate,
      showVerboseMessages: false,
      messageCallback(message) {
        // RTK deliberately ships this helper as TS behind a declaration import. Analyze it normally;
        // downgrade only this upstream packaging notice, never our source files or signature checks.
        if (
          message.messageId === "ae-wrong-input-file-type" &&
          message.sourceFilePath
            ?.replaceAll("\\", "/")
            .endsWith("/node_modules/@reduxjs/toolkit/dist/uncheckedindexed.ts")
        ) {
          message.logLevel = ExtractorLogLevel.Info
        }
      }
    })
    hasErrors ||= !result.succeeded
    models.push({
      package: pkg.name,
      entryPoint,
      model: slug + ".api.json",
      report: relative(root, resolve(reportFolder, slug + ".api.md")).replaceAll("\\", "/")
    })
  }
}
// Removed or renamed entry points must be reviewed too; stale baselines never disappear silently.
for (const file of readdirSync(reportFolder).filter((file) => file.endsWith(".api.md"))) {
  if (!expectedReports.has(file)) {
    process.stderr.write(`Remove the obsolete API baseline after reviewing its deletion: api-reports/${file}\n`)
    hasErrors = true
  }
}
writeFileSync(resolve(modelFolder, "index.json"), JSON.stringify(models, null, 2) + "\n")
if (models.length === 0) {
  throw new Error("No public typed entry points discovered")
}
if (hasErrors) {
  process.stderr.write(
    "API verification failed. Review changes, run pnpm api:update, and commit the updated baselines.\n"
  )
  process.exitCode = 1
} else {
  process.stdout.write(`${models.length} typed entry points ${isUpdate ? "updated" : "verified"}.\n`)
}
