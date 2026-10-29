import { createTestApp } from "@better-apps/testing"
import { getFeatureTables } from "better-apps"
import { describe, expect, expectTypeOf, it } from "vitest"
import {
  comments,
  defineAnchor,
  defineFormat,
  elementAnchor,
  textFormat,
  type Comment,
  type CommentThread
} from "./index.js"

const invoice = { canView: () => true, canComment: () => true }

describe("comments", () => {
  it("declares its two tables, with the app's additional fields and portable indexes", () => {
    const tables = getFeatureTables([
      comments({
        subjects: { invoice },
        additionalFields: { thread: { priority: { type: "number", required: false } } }
      })
    ])
    expect(Object.keys(tables)).toEqual(["commentThread", "comment"])
    expect(tables.commentThread?.fields.priority).toEqual({ type: "number", required: false })
    expect(tables.comment?.fields.threadId?.references).toEqual({
      model: "commentThread",
      field: "id",
      onDelete: "cascade"
    })
    expect(tables.commentThread?.indexes?.map((index) => index.name)).toEqual([
      "comment_thread_by_activity",
      "comment_thread_by_creation"
    ])
  })

  it("refuses options that can't work", () => {
    expect(() => comments({ subjects: {} })).toThrow("Comments need at least one subject type.")
    expect(() => comments({ subjects: { invoice }, formats: [textFormat] })).toThrow(
      'The "text" body format is registered twice.'
    )
    expect(() => comments({ subjects: { invoice }, anchors: [elementAnchor(), elementAnchor()] })).toThrow(
      'The "element" anchor kind is registered twice.'
    )
    expect(() =>
      comments({ subjects: { invoice }, additionalFields: { comment: { body: { type: "string" } } } })
    ).toThrow('"body" is a comments field, so it can\'t be an additional field.')
  })

  it("accepts the app's own body formats and anchor kinds", async () => {
    const markdown = defineFormat({
      name: "markdown",
      schema: textFormat.schema,
      toText: (body) => body.replace(/[*_]/g, ""),
      mentions: () => []
    })
    const region = defineAnchor({
      kind: "region",
      schema: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (value) => ({ value: value as { x: number; y: number } })
        }
      }
    })
    const { app } = createTestApp({
      features: [comments({ subjects: { invoice }, formats: [markdown], anchors: [region] })],
      users: [{ id: "ada" }]
    })
    const { thread, comment } = await app.api.comments.createThread(
      {
        subjectType: "invoice",
        subjectId: "1",
        format: "markdown",
        body: "**Bold** claim",
        anchor: { kind: "region", value: { x: 1, y: 2 } }
      },
      { author: { type: "user", userId: "ada" } }
    )
    expect(comment).toMatchObject({ format: "markdown", body: "**Bold** claim", bodyText: "Bold claim" })
    expect(thread).toMatchObject({ anchorKind: "region", anchor: { x: 1, y: 2 } })
  })

  it("types inputs and records from the options", () => {
    const feature = comments({
      subjects: { invoice: { ...invoice, visibility: { staff: () => true } }, page: invoice },
      anchors: [elementAnchor()],
      additionalFields: { thread: { priority: { type: ["low", "high"], required: false } } }
    })
    type Actions = typeof feature.actions
    type CreateInput = Parameters<Actions["createThread"]["handler"]>[0]["input"]
    expectTypeOf<CreateInput["subjectType"]>().toEqualTypeOf<"invoice" | "page">()
    expectTypeOf<NonNullable<CreateInput["visibility"]>>().toEqualTypeOf<"default" | "staff">()
    expectTypeOf<NonNullable<CreateInput["anchor"]>["kind"]>().toEqualTypeOf<"element">()
    type Created = Awaited<ReturnType<Actions["createThread"]["handler"]>>
    expectTypeOf<Created["thread"]>().toEqualTypeOf<CommentThread & { priority: "low" | "high" | null }>()
    expectTypeOf<Created["comment"]["authorType"]>().toEqualTypeOf<Comment["authorType"]>()
  })
})
