import { describe, expect, it } from "vitest"
import { createDatabaseAdapter, defineFeature, eventModel, getFeatureTables, type DatabaseAdapter } from "./index.js"

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

describe("getFeatureTables", () => {
  it("merges tables that several features extend", () => {
    const { comment } = getFeatureTables([comments, reactions])
    expect(comment?.modelName).toBe("comment")
    expect(Object.keys(comment?.fields ?? {})).toEqual([
      "subjectType",
      "subjectId",
      "body",
      "createdAt",
      "reactionCount"
    ])
    expect(comment?.indexes).toEqual([{ fields: ["subjectType", "subjectId"] }])
  })

  it("keeps one copy of an index several features declare", () => {
    const threads = defineFeature({
      id: "threads",
      schema: { comment: { fields: {}, indexes: [{ fields: ["subjectType", "subjectId"] }] } }
    })
    expect(getFeatureTables([comments, threads]).comment?.indexes).toEqual([{ fields: ["subjectType", "subjectId"] }])
  })

  it("adds no tables of its own while no feature subscribes to events", () => {
    expect(getFeatureTables([defineFeature({ id: "presence" })])).toEqual({})
  })

  it("adds the event outbox when a feature subscribes to events", () => {
    const audit = defineFeature({ id: "audit", on: { comments: { "comment.created": () => undefined } } })
    const { [eventModel]: outbox } = getFeatureTables([comments, audit])
    expect(outbox?.modelName).toBe(eventModel)
    expect(Object.keys(outbox?.fields ?? {})).toEqual([
      "feature",
      "type",
      "data",
      "actor",
      "author",
      "silent",
      "createdAt",
      "availableAt",
      "attempts",
      "lastError"
    ])
  })

  it.each(["betterAppsEvent", "better_apps_event"])("rejects %s, which the outbox reserves", (modelName) => {
    const feature = defineFeature({ id: "events", schema: { log: { modelName, fields: {} } } })
    expect(() => getFeatureTables([feature])).toThrow(
      `can't declare a "${modelName}" table. Better Apps reserves that name.`
    )
  })

  it("keeps a custom model name", () => {
    const renamed = defineFeature({ id: "notes", schema: { note: { modelName: "app_note", fields: {} } } })
    expect(getFeatureTables([renamed]).note?.modelName).toBe("app_note")
  })

  it("rejects duplicate feature ids", () => {
    expect(() => getFeatureTables([comments, comments])).toThrow('"comments" feature is registered more than once')
  })

  it("rejects tables Better Auth reserves", () => {
    const user = defineFeature({ id: "profiles", schema: { user: { fields: {} } } })
    expect(() => getFeatureTables([user])).toThrow('can\'t declare a "user" table')
  })

  it("rejects model names Better Auth reserves", () => {
    const profiles = defineFeature({ id: "profiles", schema: { profile: { modelName: "session", fields: {} } } })
    expect(() => getFeatureTables([profiles])).toThrow('can\'t declare a "session" table')
  })

  it.each(["User", "RateLimit", "rate_limit"])("rejects %s, which generates a reserved table name", (modelName) => {
    const feature = defineFeature({ id: "profiles", schema: { profile: { modelName, fields: {} } } })
    expect(() => getFeatureTables([feature])).toThrow(`can't declare a "${modelName}" table`)
  })
})

describe("createDatabaseAdapter", () => {
  it("creates the adapter with the features' tables", () => {
    const adapter = { id: "test" } as DatabaseAdapter
    let tables: string[] = []
    const database = ({ schema }: { schema: Record<string, unknown> }) => {
      tables = Object.keys(schema)
      return adapter
    }
    expect(createDatabaseAdapter({ database, features: [comments] })).toBe(adapter)
    expect(tables).toEqual(["comment"])
  })
})
