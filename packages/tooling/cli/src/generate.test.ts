import type { DBAdapterInstance } from "@better-auth/core/db/adapter"
import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { defineFeature } from "better-apps"
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
const database = drizzleAdapter({}, { provider: "pg" })

describe("generateSchema", () => {
  it("generates a Drizzle schema with only feature tables", async () => {
    const { code, fileName } = await generateSchema({ database, features: [comments, reactions] })
    expect(fileName).toBe("./better-apps-schema.ts")
    expect(code).toContain("export const comment = pgTable(")
    expect(code).toContain("reaction_count")
    expect(code).not.toMatch(/export const (user|session|account|verification) =/)
  })

  it("names unsupported adapters", async () => {
    const custom = (() => ({ id: "custom" })) as unknown as DBAdapterInstance
    await expect(generateSchema({ database: custom, features: [comments] })).rejects.toThrow(
      'can\'t generate a schema for the "custom" adapter'
    )
  })
})
