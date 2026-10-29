import { drizzleAdapter } from "@better-apps/drizzle"
import { defineFeature, type DatabaseAdapterFactory } from "better-apps"
import { drizzle } from "drizzle-orm/pg-proxy"
import { drizzle as drizzleSqlite } from "drizzle-orm/sqlite-proxy"
import { describe, expect, it } from "vitest"
import { generateSchema } from "./index.js"

const comments = defineFeature({
  id: "comments",
  schema: {
    comment: {
      fields: {
        subjectType: { type: "string", required: true },
        subjectId: { type: "string", required: true },
        body: { type: "string", required: true },
        createdAt: { type: "date", required: true }
      },
      indexes: [{ fields: ["subjectType", "subjectId"] }]
    }
  }
})
const reactions = defineFeature({
  id: "reactions",
  schema: { comment: { fields: { reactionCount: { type: "number", required: false } } } }
})
const database = drizzleAdapter(
  drizzle(async () => ({ rows: [] })),
  { provider: "pg" }
)

describe("generateSchema", () => {
  it("generates a Drizzle schema with only feature tables", async () => {
    const { code, fileName } = await generateSchema({ database, features: [comments, reactions] })
    expect(fileName).toBe("./better-apps-schema.ts")
    expect(code).toContain("export const comment = pgTable(")
    expect(code).toContain("reaction_count")
    expect(code).not.toMatch(/export const (user|session|account|verification) =/)
  })

  it("follows the adapter's provider and table naming", async () => {
    const sqlite = drizzleAdapter(
      drizzleSqlite(async () => ({ rows: [] })),
      { provider: "sqlite", usePlural: true }
    )
    const { code } = await generateSchema({ database: sqlite, features: [comments] })
    expect(code).toContain('export const comments = sqliteTable(\n  "comments",')
  })

  it("names unsupported adapters", async () => {
    const custom = (() => ({ id: "custom" })) as unknown as DatabaseAdapterFactory
    await expect(generateSchema({ database: custom, features: [comments] })).rejects.toThrow(
      'can\'t generate a schema for the "custom" adapter'
    )
  })
})
