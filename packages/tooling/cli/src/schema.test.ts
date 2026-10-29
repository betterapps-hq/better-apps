// Checks the schema `better-apps generate` writes, past the generator's own output: it type-checks for every dialect,
// drizzle-kit turns it into SQL, and on SQLite the tables drizzle-kit creates take the adapter's reads and writes.
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { pathToFileURL } from "node:url"
import { drizzleAdapter } from "@better-apps/drizzle"
import { createDatabaseAdapter, defineFeature } from "better-apps"
import {
  generateDrizzleJson,
  generateMigration,
  generateMySQLDrizzleJson,
  generateMySQLMigration,
  generateSQLiteDrizzleJson,
  generateSQLiteMigration
} from "drizzle-kit/api"
import { drizzle as drizzleMysql } from "drizzle-orm/mysql-proxy"
import { drizzle as drizzlePg } from "drizzle-orm/pg-proxy"
import { drizzle as drizzleSqlite } from "drizzle-orm/sqlite-proxy"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { generateSchema } from "./index.js"

const projects = defineFeature({
  id: "projects",
  schema: {
    project: {
      fields: {
        name: { type: "string", required: true, unique: true },
        ownerId: { type: "string", required: true, index: true },
        status: { type: ["active", "archived"], required: true, defaultValue: "active" },
        budget: { type: "number", required: false, bigint: true },
        priority: { type: "number", required: true, defaultValue: 0 },
        public: { type: "boolean", required: true, defaultValue: false },
        tags: { type: "string[]", required: false },
        scores: { type: "number[]", required: false },
        settings: { type: "json", required: false },
        createdAt: { type: "date", required: true, defaultValue: () => new Date() },
        updatedAt: { type: "date", required: false, onUpdate: () => new Date() }
      },
      indexes: [{ fields: ["ownerId", "status"] }]
    },
    task: {
      fields: {
        projectId: { type: "string", required: true, references: { model: "project", field: "id" } },
        title: { type: "string", required: true, sortable: true }
      }
    }
  }
})
const features = [projects]

// Drizzle resolves from the generated files, so they're written inside the package, in a folder git ignores.
const root = join(import.meta.dirname, "../.generated")
let output: string

const generate = async (provider: "sqlite" | "pg" | "mysql") => {
  const drivers = {
    sqlite: () => drizzleSqlite(async () => ({ rows: [] })),
    pg: () => drizzlePg(async () => ({ rows: [] })),
    mysql: () => drizzleMysql(async () => ({ rows: [] }))
  }
  const { code = "" } = await generateSchema({ database: drizzleAdapter(drivers[provider](), { provider }), features })
  const file = join(output, `${provider}.ts`)
  writeFileSync(file, code)
  return file
}

beforeAll(() => {
  mkdirSync(root, { recursive: true })
  output = mkdtempSync(join(root, "schema-"))
})
afterAll(() => rmSync(output, { recursive: true, force: true }))

describe("the generated schema", () => {
  it("type-checks for every dialect", { timeout: 60_000 }, async () => {
    const files = await Promise.all((["sqlite", "pg", "mysql"] as const).map(async (provider) => generate(provider)))
    const compilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      types: []
    }
    writeFileSync(join(output, "tsconfig.json"), JSON.stringify({ compilerOptions, files }))
    // TypeScript 7 has no compiler API in JavaScript, so this runs tsc itself.
    const tsc = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin/tsc")
    const result = spawnSync(process.execPath, [tsc, "-p", join(output, "tsconfig.json")], { encoding: "utf8" })
    expect({ status: result.status, output: result.stdout + result.stderr }).toEqual({ status: 0, output: "" })
  })

  it("gives drizzle-kit what it needs to create PostgreSQL and MySQL tables", async () => {
    const pg = (await import(pathToFileURL(await generate("pg")).href)) as Record<string, unknown>
    const pgStatements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(pg))
    expect(pgStatements.join("\n")).toMatch(/CREATE TABLE "project"[\s\S]*CREATE TABLE "task"/)

    const mysql = (await import(pathToFileURL(await generate("mysql")).href)) as Record<string, unknown>
    const mysqlStatements = await generateMySQLMigration(
      await generateMySQLDrizzleJson({}),
      await generateMySQLDrizzleJson(mysql)
    )
    expect(mysqlStatements.join("\n")).toMatch(/CREATE TABLE `project`[\s\S]*CREATE TABLE `task`/)
    expect(mysqlStatements.join("\n")).toMatch(/`tags` text,[\s\S]*`settings` json/)
  })

  it("creates SQLite tables, through drizzle-kit, that the adapter reads and writes", async () => {
    const schema = (await import(pathToFileURL(await generate("sqlite")).href)) as Record<string, unknown>
    const statements = await generateSQLiteMigration(
      await generateSQLiteDrizzleJson({}),
      await generateSQLiteDrizzleJson(schema)
    )
    const sqlite = new DatabaseSync(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON")
    for (const statement of statements) {
      sqlite.exec(statement)
    }

    const db = drizzleSqlite(
      async (sql, params, method) => {
        const statement = sqlite.prepare(sql)
        const values = params as SQLInputValue[]
        if (method === "run") {
          statement.run(...values)
          return { rows: [] }
        }
        statement.setReturnArrays(true)
        // setReturnArrays makes rows arrays of values, which node:sqlite's types don't follow.
        const rows: unknown = method === "get" ? statement.get(...values) : statement.all(...values)
        return { rows: rows as unknown[] }
      },
      { schema }
    )
    const adapter = createDatabaseAdapter({
      database: drizzleAdapter(db, { provider: "sqlite", batch: false }),
      features
    })
    const project = await adapter.create({
      model: "project",
      data: { name: "Atlas", ownerId: "ada", tags: ["a", "b"], scores: [1, 2], settings: { theme: "dark" } }
    })
    expect(project).toMatchObject({
      name: "Atlas",
      status: "active",
      budget: null,
      priority: 0,
      public: false,
      tags: ["a", "b"],
      scores: [1, 2],
      settings: { theme: "dark" },
      updatedAt: null
    })
    expect(project.createdAt).toBeInstanceOf(Date)
    await adapter.create({ model: "task", data: { projectId: project.id, title: "Plan" } })

    // Drizzle wraps the database's error and names the query, so the constraint is in the cause.
    const failure = async (write: Promise<unknown>) =>
      write.then(
        () => "no error",
        (error: Error) => (error.cause instanceof Error ? error.cause.message : error.message)
      )
    expect(await failure(adapter.create({ model: "project", data: { name: "Atlas", ownerId: "grace" } }))).toBe(
      "UNIQUE constraint failed: project.name"
    )
    expect(await failure(adapter.create({ model: "task", data: { projectId: "missing", title: "Lost" } }))).toBe(
      "FOREIGN KEY constraint failed"
    )
    await adapter.deleteMany({ model: "project", where: [{ field: "id", value: project.id as string }] })
    expect(await adapter.count({ model: "task" })).toBe(0)

    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
    expect(indexes.map(({ name }) => name)).toEqual([
      "project_name_unique",
      "project_ownerId_idx",
      "project_ownerId_status_idx"
    ])
    sqlite.close()
  })
})
