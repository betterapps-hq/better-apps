import { existsSync, statSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import type { BetterAppsOptions } from "better-apps"
import { generateSchema } from "./generate.js"

const usage = `Usage: better-apps generate [options]

Writes the database schema for the features in your Better Apps config.

Options:
  -c, --config <path>  The config file to load. The default is better-apps.config.ts.
  -o, --output <path>  The schema file to write. The default is better-apps-schema.ts.
  -h, --help           Show this help.
`

/** Where the command runs and how it reports back. */
export interface CliContext {
  cwd: string
  stdout: (text: string) => void
  stderr: (text: string) => void
}

function isOptions(value: unknown): value is BetterAppsOptions {
  return (
    typeof value === "object" &&
    value !== null &&
    "database" in value &&
    typeof value.database === "function" &&
    "features" in value &&
    Array.isArray(value.features)
  )
}

// Compares files rather than paths, so a different letter case or a link to the same file still matches. File ids are
// read as bigints, since 64-bit ids such as NTFS's lose precision as numbers.
function isSameFile(first: string, second: string): boolean {
  if (first === second) {
    return true
  }
  if (!existsSync(first) || !existsSync(second)) {
    return false
  }
  const [a, b] = [statSync(first, { bigint: true }), statSync(second, { bigint: true })]
  return a.dev === b.dev && a.ino === b.ino
}

async function loadConfig(path: string, cwd: string): Promise<BetterAppsOptions> {
  const name = relative(cwd, path)
  if (!existsSync(path)) {
    throw new Error(`Can't find ${name}. Create it, or pass its path with --config.`)
  }
  const config: unknown = ((await import(pathToFileURL(path).href)) as { default?: unknown }).default
  if (!isOptions(config)) {
    throw new Error(`${name} must have a default export with a database adapter and a list of features.`)
  }
  return config
}

/** Runs the `better-apps` command and returns its exit code. */
export async function run(args: readonly string[], context: CliContext): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      options: {
        config: { type: "string", short: "c", default: "better-apps.config.ts" },
        output: { type: "string", short: "o", default: "better-apps-schema.ts" },
        help: { type: "boolean", short: "h", default: false }
      }
    })
  } catch (error) {
    context.stderr(`${(error as Error).message}\n\n${usage}`)
    return 1
  }
  const { values, positionals } = parsed
  if (values.help) {
    context.stdout(usage)
    return 0
  }
  if (positionals.length !== 1 || positionals[0] !== "generate") {
    context.stderr(usage)
    return 1
  }
  try {
    const configPath = resolve(context.cwd, values.config)
    const file = resolve(context.cwd, values.output)
    if (isSameFile(file, configPath)) {
      throw new Error(
        `Can't write the schema to ${relative(context.cwd, file)}, which is the config file. Pass another path with --output.`
      )
    }
    const config = await loadConfig(configPath, context.cwd)
    const { code } = await generateSchema({ ...config, file })
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, code ?? "")
    context.stdout(`Wrote the schema to ${relative(context.cwd, file)}.\n`)
    return 0
  } catch (error) {
    context.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
