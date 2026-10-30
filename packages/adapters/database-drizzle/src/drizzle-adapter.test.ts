import { createDatabaseAdapter, type DatabaseAdapter, type Row } from "better-apps"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { comments, databases, type TestDatabase } from "../test/databases.js"
import { drizzleAdapter, type DrizzleAdapterConfig } from "./index.js"

// Batches report the database's error as is. Drizzle wraps the error of a single query and names the query.
const duplicateId =
  /UNIQUE constraint failed: comment\.id|duplicate key value violates unique constraint "comment_pkey"|Duplicate entry '.+' for key 'comment\.PRIMARY'|Failed query: insert into/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe.each(databases)("drizzleAdapter on $name", ({ connect, dispose, unavailable }) => {
  let database: TestDatabase
  let adapter: DatabaseAdapter

  const createAdapter = (config: Partial<DrizzleAdapterConfig> = {}) =>
    createDatabaseAdapter({
      database: drizzleAdapter(database.db, { provider: database.provider, ...database.config, ...config }),
      features: [comments]
    })
  const addComment = (data: Row) =>
    adapter.create({ model: "comment", data: { subjectId: "post", body: "Hi", ...data } })
  const ids = (rows: Row[]) => rows.map((row) => row.id)

  beforeEach(async ({ skip }) => {
    skip(unavailable !== undefined, unavailable)
    database = await connect()
    adapter = createAdapter()
  })
  afterEach(async () => {
    if (unavailable === undefined) {
      await database.close?.()
    }
  })
  afterAll(async () => dispose?.())

  describe("create", () => {
    it("generates an id, applies defaults and reads values back as their field types", async () => {
      const created = await addComment({ tags: ["a", "b"], metadata: { edited: false }, authorName: "Ada" })
      expect(created).toMatchObject({
        subjectId: "post",
        body: "Hi",
        authorName: "Ada",
        score: 0,
        pinned: false,
        tags: ["a", "b"],
        metadata: { edited: false },
        updatedAt: null
      })
      expect(created.id).toMatch(uuid)
      expect(created.createdAt).toBeInstanceOf(Date)
      expect(
        await adapter.findOne({ model: "comment", where: [{ field: "id", value: created.id as string }] })
      ).toEqual(created)
    })

    it("stores JSON and lists as JSON, not as a JSON string of it", async () => {
      await addComment({ tags: ["a", "b"], metadata: { edited: false } })
      // Drizzle's own reads return the value for a column that parses JSON, and the JSON text for one that doesn't.
      const { comment } = database.schema as Record<string, { tags: unknown; metadata: unknown }>
      const select = database.db.select as (fields: object) => { from(table: unknown): Promise<Row[]> }
      const [row] = await select.call(database.db, { tags: comment!.tags, metadata: comment!.metadata }).from(comment)
      const decode = (value: unknown) => (typeof value === "string" ? (JSON.parse(value) as unknown) : value)
      expect(decode(row!.tags)).toEqual(["a", "b"])
      expect(decode(row!.metadata)).toEqual({ edited: false })
    })

    it("reads back a JSON string that looks like another JSON value", async () => {
      const created = await addComment({ metadata: "123", tags: ["true"] })
      const found = await adapter.findOne({ model: "comment", where: [{ field: "id", value: created.id as string }] })
      // Drizzle's json and jsonb columns parse a string the Postgres driver already decoded, so "123" becomes 123.
      expect(found).toMatchObject({ metadata: database.provider === "pg" ? 123 : "123", tags: ["true"] })
    })

    it("keeps a given id and accepts dates sent as strings", async () => {
      const created = await addComment({ id: "c1", createdAt: "2026-01-02T03:04:05.678Z" })
      expect(created.id).toBe("c1")
      expect(created.createdAt).toEqual(new Date("2026-01-02T03:04:05.678Z"))
    })

    it("uses a custom id generator", async () => {
      adapter = createAdapter({ generateId: () => "custom" })
      expect((await addComment({})).id).toBe("custom")
    })

    it("rejects unknown models and fields", async () => {
      await expect(adapter.create({ model: "post", data: {} })).rejects.toThrow('The "post" model isn\'t in the schema')
      await expect(addComment({ title: "Hi" })).rejects.toThrow('The "comment" model has no "title" field')
    })

    it("names a table missing from the Drizzle schema", async () => {
      adapter = createAdapter({ schema: {} })
      await expect(addComment({})).rejects.toThrow('The Drizzle schema has no "comment" table')
    })

    it("finds plural table exports", async () => {
      const { comment, reaction } = database.schema
      adapter = createAdapter({ usePlural: true, schema: { comments: comment, reactions: reaction } })
      await addComment({ id: "c1" })
      expect(await adapter.count({ model: "comment" })).toBe(1)
    })
  })

  describe("createMany", () => {
    it("creates rows in order across several statements", async () => {
      const data = Array.from({ length: 25 }, (_, index) => ({ id: `c${index}`, subjectId: "post", body: `${index}` }))
      const created = await adapter.createMany({ model: "comment", data })
      expect(ids(created)).toEqual(data.map((row) => row.id))
      expect(await adapter.count({ model: "comment" })).toBe(25)
    })

    it("creates none when one row fails", async () => {
      await addComment({ id: "c24" })
      const data = Array.from({ length: 25 }, (_, index) => ({ id: `c${index}`, subjectId: "post", body: `${index}` }))
      await expect(adapter.createMany({ model: "comment", data })).rejects.toThrow(duplicateId)
      expect(await adapter.count({ model: "comment" })).toBe(1)
    })

    it("returns nothing for no rows", async () => {
      expect(await adapter.createMany({ model: "comment", data: [] })).toEqual([])
    })
  })

  describe("findOne and findMany", () => {
    beforeEach(async () => {
      await addComment({ id: "a", subjectId: "x", score: 1, body: "100% sure", authorName: "Ada" })
      await addComment({ id: "b", subjectId: "x", score: 1, body: "1000 sure" })
      await addComment({ id: "c", subjectId: "y", score: 2, body: "a_b", pinned: true })
      await addComment({ id: "d", subjectId: "y", score: 2, body: "axb" })
      await addComment({ id: "e", subjectId: "z", score: 2, body: "Hello" })
    })

    it("selects only the requested fields", async () => {
      expect(
        await adapter.findOne({
          model: "comment",
          where: [{ field: "id", value: "a" }],
          select: ["body", "authorName"]
        })
      ).toEqual({ body: "100% sure", authorName: "Ada" })
    })

    it("returns null when no row matches", async () => {
      expect(await adapter.findOne({ model: "comment", where: [{ field: "id", value: "nope" }] })).toBeNull()
    })

    it.each([
      [[{ field: "score", operator: "gt", value: 1 }], ["c", "d", "e"]],
      [[{ field: "score", operator: "gte", value: "2" }], ["c", "d", "e"]],
      [[{ field: "score", operator: "lt", value: 2 }], ["a", "b"]],
      [[{ field: "score", operator: "lte", value: 1 }], ["a", "b"]],
      [[{ field: "subjectId", operator: "ne", value: "y" }], ["a", "b", "e"]],
      [[{ field: "subjectId", operator: "in", value: ["x", "z"] }], ["a", "b", "e"]],
      [[{ field: "subjectId", operator: "not_in", value: ["x", "z"] }], ["c", "d"]],
      [[{ field: "authorName", value: null }], ["b", "c", "d", "e"]],
      [[{ field: "author", operator: "ne", value: null }], ["a"]],
      [[{ field: "pinned", value: "true" }], ["c"]],
      [[{ field: "body", operator: "contains", value: "0%" }], ["a"]],
      [[{ field: "body", operator: "contains", value: "a_b" }], ["c"]],
      [[{ field: "body", operator: "starts_with", value: "a_" }], ["c"]],
      [[{ field: "body", operator: "ends_with", value: "% sure" }], ["a"]],
      [[{ field: "body", value: "HELLO", mode: "insensitive" }], ["e"]],
      [[{ field: "body", operator: "ne", value: "HELLO", mode: "insensitive" }], ["a", "b", "c", "d"]],
      [[{ field: "body", operator: "in", value: ["HELLO", "AXB"], mode: "insensitive" }], ["d", "e"]],
      [[{ field: "body", operator: "not_in", value: ["HELLO", "AXB"], mode: "insensitive" }], ["a", "b", "c"]],
      [[{ field: "body", operator: "in", value: [], mode: "insensitive" }], []],
      [[{ field: "body", operator: "not_in", value: [], mode: "insensitive" }], ["a", "b", "c", "d", "e"]],
      [[{ field: "body", operator: "starts_with", value: "HE", mode: "insensitive" }], ["e"]],
      [
        [
          { field: "score", value: 2 },
          { field: "subjectId", value: "x", connector: "OR" },
          { field: "subjectId", value: "z", connector: "OR" }
        ],
        ["e"]
      ]
    ] as const)("filters with %j", async (where, expected) => {
      const rows = await adapter.findMany({ model: "comment", where, sortBy: { field: "id", direction: "asc" } })
      expect(ids(rows)).toEqual(expected)
    })

    it("needs a list for in and not_in", async () => {
      await expect(
        adapter.findMany({ model: "comment", where: [{ field: "subjectId", operator: "in", value: "x" }] })
      ).rejects.toThrow('The "in" operator on "subjectId" needs a list of values')
    })

    it("pages through ties with a cursor on several fields", async () => {
      const sortBy = [
        { field: "score", direction: "desc" },
        { field: "id", direction: "asc" }
      ] as const
      const pages: unknown[][] = []
      let after: Row | undefined
      for (;;) {
        const page = await adapter.findMany({ model: "comment", sortBy, after, limit: 2 })
        if (!page.length) {
          break
        }
        pages.push(ids(page))
        after = page.at(-1)
      }
      expect(pages).toEqual([["c", "d"], ["e", "a"], ["b"]])
    })

    it("pages with a cursor on a date", async () => {
      const base = new Date("2026-01-01T00:00:00.000Z").getTime()
      await adapter.deleteMany({ model: "comment", where: [] })
      for (const [index, id] of ["p", "q", "r"].entries()) {
        await addComment({ id, createdAt: new Date(base + index * 1000) })
      }
      const [first] = await adapter.findMany({
        model: "comment",
        sortBy: { field: "createdAt", direction: "desc" },
        limit: 1
      })
      const rest = await adapter.findMany({
        model: "comment",
        sortBy: { field: "createdAt", direction: "desc" },
        after: first
      })
      expect([first?.id, ...ids(rest)]).toEqual(["r", "q", "p"])
    })

    it("applies limit and offset", async () => {
      const rows = await adapter.findMany({
        model: "comment",
        sortBy: { field: "id", direction: "asc" },
        limit: 2,
        offset: 1
      })
      expect(ids(rows)).toEqual(["b", "c"])
    })

    it("applies an offset without a limit", async () => {
      const rows = await adapter.findMany({ model: "comment", sortBy: { field: "id", direction: "asc" }, offset: 1 })
      expect(ids(rows)[0]).toBe("b")
      expect(rows).toHaveLength((await adapter.count({ model: "comment" })) - 1)
    })

    it("needs a sort order and every sort key's value for a cursor", async () => {
      await expect(adapter.findMany({ model: "comment", after: { id: "a" } })).rejects.toThrow(
        "A cursor needs a sort order"
      )
      await expect(
        adapter.findMany({ model: "comment", sortBy: { field: "score", direction: "asc" }, after: { id: "a" } })
      ).rejects.toThrow('The cursor needs a value for "score"')
    })

    it("counts rows", async () => {
      expect(await adapter.count({ model: "comment" })).toBe(5)
      expect(await adapter.count({ model: "comment", where: [{ field: "subjectId", value: "y" }] })).toBe(2)
    })

    it("counts rows per group", async () => {
      const groups = await adapter.countGroups({
        model: "comment",
        where: [{ field: "score", operator: "gte", value: 1 }],
        groupBy: ["subjectId", "pinned"]
      })
      const key = ({ group }: { group: Row }) => `${String(group.subjectId)}:${String(group.pinned)}`
      expect(groups.sort((a, b) => key(a).localeCompare(key(b)))).toEqual([
        { group: { subjectId: "x", pinned: false }, count: 2 },
        { group: { subjectId: "y", pinned: false }, count: 1 },
        { group: { subjectId: "y", pinned: true }, count: 1 },
        { group: { subjectId: "z", pinned: false }, count: 1 }
      ])
    })
  })

  describe("update, updateMany and deleteMany", () => {
    beforeEach(async () => {
      await addComment({ id: "a", subjectId: "x" })
      await addComment({ id: "b", subjectId: "x" })
      await addComment({ id: "c", subjectId: "y" })
    })

    it("updates the first matching row and sets onUpdate fields", async () => {
      const updated = await adapter.update({
        model: "comment",
        where: [{ field: "subjectId", value: "x" }],
        update: { body: "Edited" }
      })
      expect(updated).toMatchObject({ body: "Edited", subjectId: "x" })
      expect(updated?.updatedAt).toBeInstanceOf(Date)
      expect(await adapter.count({ model: "comment", where: [{ field: "body", value: "Edited" }] })).toBe(1)
    })

    it("returns null when no row matches", async () => {
      expect(
        await adapter.update({ model: "comment", where: [{ field: "id", value: "nope" }], update: { body: "Edited" } })
      ).toBeNull()
    })

    it("needs a condition", async () => {
      await expect(adapter.update({ model: "comment", where: [], update: { body: "Edited" } })).rejects.toThrow(
        "update changes a single row, so it needs at least one condition"
      )
    })

    it("counts the rows it changes", async () => {
      expect(
        await adapter.updateMany({
          model: "comment",
          where: [{ field: "subjectId", value: "x" }],
          update: { pinned: true }
        })
      ).toBe(2)
      expect(await adapter.count({ model: "comment", where: [{ field: "pinned", value: true }] })).toBe(2)
      expect(await adapter.deleteMany({ model: "comment", where: [{ field: "subjectId", value: "x" }] })).toBe(2)
      expect(await adapter.deleteMany({ model: "comment", where: [{ field: "subjectId", value: "x" }] })).toBe(0)
    })
  })

  describe("incrementOne", () => {
    it("increments a row while its guard holds", async () => {
      await addComment({ id: "a" })
      const increment = () =>
        adapter.incrementOne({
          model: "comment",
          where: [
            { field: "id", value: "a" },
            { field: "score", operator: "lt", value: 1 }
          ],
          increment: { score: 1 },
          set: { pinned: true }
        })
      expect(await increment()).toMatchObject({ id: "a", score: 1, pinned: true })
      expect(await increment()).toBeNull()
      expect(await adapter.findOne({ model: "comment", where: [{ field: "id", value: "a" }] })).toMatchObject({
        score: 1
      })
    })

    it("only increments number fields and needs a condition", async () => {
      await expect(
        adapter.incrementOne({ model: "comment", where: [{ field: "id", value: "a" }], increment: { body: 1 } })
      ).rejects.toThrow('Only number fields can be incremented, and "body" is a string field')
      await expect(adapter.incrementOne({ model: "comment", where: [], increment: { score: 1 } })).rejects.toThrow(
        "incrementOne changes a single row"
      )
    })
  })

  describe("batch", () => {
    it("runs writes in order and returns each result", async () => {
      await addComment({ id: "old" })
      const results = await adapter.batch([
        { type: "create", model: "comment", data: { id: "a", subjectId: "post", body: "Hi" } },
        { type: "create", model: "reaction", data: { id: "r", commentId: "a", emoji: "+1" } },
        { type: "incrementOne", model: "comment", where: [{ field: "id", value: "a" }], increment: { score: 2 } },
        { type: "update", model: "comment", where: [{ field: "id", value: "a" }], update: { body: "Edited" } },
        { type: "update", model: "comment", where: [{ field: "id", value: "nope" }], update: { body: "Edited" } },
        { type: "updateMany", model: "comment", where: [], update: { pinned: true } },
        { type: "deleteMany", model: "comment", where: [{ field: "id", value: "old" }] }
      ])
      expect(results).toEqual([
        expect.objectContaining({ id: "a", score: 0 }),
        { id: "r", commentId: "a", emoji: "+1" },
        expect.objectContaining({ id: "a", score: 2 }),
        expect.objectContaining({ id: "a", body: "Edited", score: 2 }),
        null,
        2,
        1
      ])
    })

    it("applies none of its writes when one fails", async () => {
      await addComment({ id: "a" })
      await expect(
        adapter.batch([
          { type: "create", model: "comment", data: { id: "b", subjectId: "post", body: "Hi" } },
          { type: "updateMany", model: "comment", where: [], update: { body: "Edited" } },
          { type: "create", model: "comment", data: { id: "a", subjectId: "post", body: "Duplicate" } }
        ])
      ).rejects.toThrow(duplicateId)
      expect(ids(await adapter.findMany({ model: "comment" }))).toEqual(["a"])
      expect(await adapter.findOne({ model: "comment", where: [{ field: "id", value: "a" }] })).toMatchObject({
        body: "Hi"
      })
    })

    it("runs a single write and no writes", async () => {
      expect(await adapter.batch([])).toEqual([])
      expect(
        await adapter.batch([{ type: "create", model: "comment", data: { id: "a", subjectId: "post", body: "Hi" } }])
      ).toEqual([expect.objectContaining({ id: "a" })])
    })

    it("checks writes to a single row before running any", async () => {
      await expect(
        adapter.batch([{ type: "update", model: "comment", where: [], update: { body: "Edited" } }])
      ).rejects.toThrow("update changes a single row")
    })
  })

  it("describes its configuration for schema generators", () => {
    expect(adapter.id).toBe("drizzle")
    expect(adapter.options).toMatchObject({ provider: database.provider, adapterConfig: { usePlural: false } })
  })
})

describe("drizzleAdapter", () => {
  it("needs generated ids on MySQL", () => {
    expect(() =>
      drizzleAdapter({ select: {}, insert: {}, update: {}, delete: {} }, { provider: "mysql", generateId: false })
    ).toThrow("MySQL can't return a created row without its id")
  })

  it("leaves ids to the schema when generateId is false", async () => {
    const comment = sqliteTable("comment", {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => "from-schema"),
      subjectId: text("subject_id").notNull(),
      body: text("body").notNull(),
      score: integer("score").notNull(),
      pinned: integer("pinned", { mode: "boolean" }).notNull(),
      createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull()
    })
    const database = await databases[0]!.connect()
    const adapter = createDatabaseAdapter({
      database: drizzleAdapter(database.db, { provider: "sqlite", generateId: false, schema: { comment } }),
      features: [comments]
    })
    expect(await adapter.create({ model: "comment", data: { subjectId: "post", body: "Hi" } })).toMatchObject({
      id: "from-schema"
    })
    await database.close?.()
  })
})
