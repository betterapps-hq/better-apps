import { linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { run, type CliContext } from "./cli.js"

const fixtures = fileURLToPath(new URL("../test/fixtures/", import.meta.url))
let output: string
let stdout: string
let stderr: string
let context: CliContext

beforeEach(() => {
  output = mkdtempSync(join(tmpdir(), "better-apps-cli-"))
  stdout = ""
  stderr = ""
  context = { cwd: fixtures, stdout: (text) => (stdout += text), stderr: (text) => (stderr += text) }
})

afterEach(() => {
  rmSync(output, { recursive: true, force: true })
})

describe("better-apps generate", () => {
  it("writes the schema for the default config", async () => {
    const file = join(output, "db", "schema.ts")
    expect(await run(["generate", "--output", file], context)).toBe(0)
    expect(readFileSync(file, "utf8")).toContain("export const comment = pgTable(")
    expect(stdout).toContain("Wrote the schema to")
  })

  it("loads the config named with --config", async () => {
    const file = join(output, "schema.ts")
    const config = join(fixtures, "better-apps.config.ts")
    expect(await run(["generate", "-c", config, "-o", file], { ...context, cwd: output })).toBe(0)
    expect(readFileSync(file, "utf8")).toContain("body: text(")
  })

  it("explains a missing config", async () => {
    expect(await run(["generate", "--config", "missing.config.ts"], context)).toBe(1)
    expect(stderr).toContain("Can't find missing.config.ts")
  })

  it("won't replace the config file", async () => {
    expect(await run(["generate", "--output", "better-apps.config.ts"], context)).toBe(1)
    expect(stderr).toContain(
      "Can't write the schema to better-apps.config.ts, which is the config file. Pass another path with --output."
    )
  })

  it("recognizes the config file through another path to it", async () => {
    writeFileSync(join(output, "better-apps.config.ts"), "export default {}\n")
    linkSync(join(output, "better-apps.config.ts"), join(output, "schema.ts"))
    expect(await run(["generate", "-o", "schema.ts"], { ...context, cwd: output })).toBe(1)
    expect(stderr).toContain("Can't write the schema to schema.ts, which is the config file.")
    expect(readFileSync(join(output, "better-apps.config.ts"), "utf8")).toBe("export default {}\n")
  })

  it("explains a config without a database adapter", async () => {
    expect(await run(["generate", "--config", "invalid.config.ts"], context)).toBe(1)
    expect(stderr).toContain("invalid.config.ts must have a default export")
  })

  it("shows help", async () => {
    expect(await run(["--help"], context)).toBe(0)
    expect(stdout).toContain("Usage: better-apps generate")
  })

  it.each([[[]], [["migrate"]], [["generate", "--unknown"]]])("shows usage for %j", async (args) => {
    expect(await run(args, context)).toBe(1)
    expect(stderr).toContain("Usage: better-apps generate")
  })
})
