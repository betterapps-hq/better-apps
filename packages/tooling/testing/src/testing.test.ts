import {
  BetterAppsError,
  defineAction,
  defineEvent,
  defineFeature,
  eventModel,
  getFeatureTables,
  type BetterAppsEvent,
  type Row,
  type StandardSchemaV1
} from "better-apps"
import { describe, expect, it } from "vitest"
import { createStatements, createTestApp, testDatabase, testIdentity, testUserHeader } from "./index.js"

const tasks = defineFeature({
  id: "tasks",
  schema: {
    project: { fields: { name: { type: "string", unique: true } } },
    task: {
      fields: {
        projectId: { type: "string", references: { model: "project", field: "id" }, index: true },
        title: { type: "string" },
        status: { type: ["open", "done"] },
        estimate: { type: "number", required: false },
        done: { type: "boolean", defaultValue: false },
        dueAt: { type: "date", required: false },
        details: { type: "json", required: false },
        labels: { type: "string[]", required: false },
        points: { type: "number[]", required: false, fieldName: "story_points" }
      },
      indexes: [{ fields: ["projectId", "status"], name: "task_by_status", unique: false }]
    }
  },
  events: { "task.created": defineEvent<{ taskId: string; title: string }>() },
  actions: {
    create: defineAction({
      input: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (value) => ({ value: value as { id: string; title: string } })
        }
      } as StandardSchemaV1<{ id: string; title: string }>,
      handler: async ({ input, db, actor, emit }) => {
        if (!actor) {
          throw new BetterAppsError("UNAUTHENTICATED", "Sign in to create tasks.")
        }
        emit("task.created", { taskId: input.id, title: input.title })
        const [task] = await db.batch([
          { type: "create", model: "task", data: { id: input.id, projectId: "p1", title: input.title, status: "open" } }
        ])
        return task as Row
      }
    })
  }
})

describe("testDatabase", () => {
  it("creates every table and stores every field type", async () => {
    const { app } = createTestApp({ features: [tasks] })
    await app.db.create({ model: "project", data: { id: "p1", name: "Launch" } })
    const dueAt = new Date("2026-03-04T05:06:07.890Z")
    const created = await app.db.create({
      model: "task",
      data: {
        projectId: "p1",
        title: "Write docs",
        status: "open",
        estimate: 2.5,
        dueAt,
        details: { owner: "ada" },
        labels: ["docs"],
        points: [1, 2]
      }
    })
    expect(await app.db.findOne({ model: "task", where: [{ field: "id", value: created.id as string }] })).toEqual({
      ...created,
      projectId: "p1",
      title: "Write docs",
      status: "open",
      estimate: 2.5,
      done: false,
      dueAt,
      details: { owner: "ada" },
      labels: ["docs"],
      points: [1, 2]
    })
  })

  it("enforces required fields, unique fields and references", async () => {
    const { app, database } = createTestApp({ features: [tasks] })
    await app.db.create({ model: "project", data: { id: "p1", name: "Launch" } })
    // Drizzle wraps the error of a single query and keeps SQLite's as the cause.
    const failsWith = (message: string) => ({
      cause: expect.objectContaining({ message: expect.stringContaining(message) })
    })
    await expect(app.db.create({ model: "project", data: { name: "Launch" } })).rejects.toMatchObject(
      failsWith("UNIQUE constraint failed: project.name")
    )
    await expect(app.db.create({ model: "task", data: { projectId: "p1", status: "open" } })).rejects.toMatchObject(
      failsWith("NOT NULL constraint failed: task.title")
    )
    await expect(
      app.db.create({ model: "task", data: { projectId: "missing", title: "Orphan", status: "open" } })
    ).rejects.toMatchObject(failsWith("FOREIGN KEY constraint failed"))

    await app.db.create({ model: "task", data: { projectId: "p1", title: "Ship", status: "open" } })
    await app.db.deleteMany({ model: "project", where: [{ field: "id", value: "p1" }] })
    expect(await app.db.count({ model: "task" })).toBe(0)
    expect(database.sqlite.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
  })

  it("creates the declared indexes", () => {
    const { database } = createTestApp({ features: [tasks] })
    const indexes = database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task'")
      .all()
    expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining(["task_projectId_idx", "task_by_status"]))
  })

  it("writes the statements for a schema", () => {
    const notes = defineFeature({
      id: "notes",
      schema: {
        note: {
          modelName: "app_note",
          fields: { slug: { type: "string", fieldName: "url_slug" }, rank: { type: "number", required: false } },
          indexes: [{ fields: ["slug"], unique: true }]
        }
      }
    })
    expect(createStatements(getFeatureTables([notes]))).toEqual([
      'CREATE TABLE "app_note" ("id" TEXT PRIMARY KEY NOT NULL, "url_slug" TEXT NOT NULL, "rank" INTEGER)',
      'CREATE UNIQUE INDEX "app_note_url_slug_idx" ON "app_note" ("url_slug")'
    ])
  })

  it("names a reference to a model no feature declares", () => {
    const broken = defineFeature({
      id: "broken",
      schema: { item: { fields: { ownerId: { type: "string", references: { model: "owner", field: "id" } } } } }
    })
    expect(() => createTestApp({ features: [broken] })).toThrow(
      'references the "owner" model, which no feature declares'
    )
  })

  it("is created by createBetterApps", () => {
    expect(() => testDatabase().sqlite).toThrow("created when createBetterApps runs")
  })
})

describe("createTestApp", () => {
  const users = [
    { id: "ada", name: "Ada Lovelace", email: "ada@example.com", orgId: "acme", roles: ["admin"] },
    { id: "grace", name: "Grace Hopper", orgId: "acme" },
    { id: "linus", name: "Linus", orgId: "other" }
  ]

  function audited() {
    const received: BetterAppsEvent[] = []
    const audit = defineFeature({
      id: "audit",
      on: { tasks: { "task.created": (event) => void received.push(event) } }
    })
    const { app, database, identity } = createTestApp({ features: [tasks, audit], users })
    return { app, database, identity, received }
  }

  it("runs actions over HTTP as the user a request names", async () => {
    const { app, identity, received } = audited()
    await app.db.create({ model: "project", data: { id: "p1", name: "Launch" } })
    const response = await app.handler(
      new Request("https://app.test/api/apps/tasks/create", {
        method: "POST",
        headers: { "content-type": "application/json", ...identity.headers("ada") },
        body: JSON.stringify({ id: "t1", title: "Ship" })
      })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: "t1", title: "Ship", status: "open" })
    expect(received).toMatchObject([
      { type: "task.created", data: { taskId: "t1", title: "Ship" }, actor: { userId: "ada" } }
    ])
  })

  it("rolls back the change and its events together", async () => {
    const { app, database, identity, received } = audited()
    await app.db.create({ model: "project", data: { id: "p1", name: "Launch" } })
    await app.api.tasks.create({ id: "t1", title: "Ship" }, { actor: identity.actor("ada") })
    await expect(app.api.tasks.create({ id: "t1", title: "Again" }, { actor: identity.actor("ada") })).rejects.toThrow(
      "UNIQUE constraint failed: task.id"
    )
    expect(await app.db.count({ model: "task" })).toBe(1)
    expect(received).toHaveLength(1)
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM "${eventModel}"`).get()).toEqual({ count: 0 })
  })

  it("keeps events a subscriber fails on in the outbox", async () => {
    const flaky = defineFeature({
      id: "flaky",
      on: {
        tasks: {
          "task.created": () => {
            throw new Error("Subscriber down")
          }
        }
      }
    })
    const errors: unknown[] = []
    const { app, identity } = createTestApp({
      features: [tasks, flaky],
      users,
      onError: (error) => void errors.push(error)
    })
    await app.db.create({ model: "project", data: { id: "p1", name: "Launch" } })
    await app.api.tasks.create({ id: "t1", title: "Ship" }, { actor: identity.actor("ada") })
    expect(errors).toHaveLength(1)
    const [stored] = await app.db.findMany({ model: eventModel })
    expect(stored).toMatchObject({ feature: "tasks", type: "task.created", attempts: 1, lastError: "Subscriber down" })
    expect(((stored as Row).availableAt as Date).getTime()).toBeGreaterThan(Date.now())
  })

  it("rejects writes from signed-out requests", async () => {
    const { app } = audited()
    const response = await app.handler(
      new Request("https://app.test/api/apps/tasks/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "t1", title: "Ship" })
      })
    )
    expect(response.status).toBe(401)
  })
})

describe("testIdentity", () => {
  const identity = testIdentity(
    [
      { id: "ada", name: "Ada Lovelace", email: "ada@example.com", orgId: "acme", roles: ["admin"] },
      { id: "grace", name: "Grace Hopper", orgId: "acme" },
      { id: "solo", name: "Solo" }
    ],
    { userTable: "user" }
  )

  it("acts as the user a request's header names", async () => {
    const request = new Request("https://app.test/", { headers: identity.headers("ada") })
    expect(await identity.getActor(request)).toEqual({ userId: "ada", orgId: "acme", roles: ["admin"] })
    expect(await identity.getActor(new Request("https://app.test/"))).toBeNull()
    expect(
      await identity.getActor(new Request("https://app.test/", { headers: { [testUserHeader]: "nobody" } }))
    ).toBeNull()
  })

  it("rejects users it doesn't have", () => {
    expect(() => identity.actor("nobody")).toThrow('There is no test user "nobody".')
    expect(() => identity.headers("nobody")).toThrow('There is no test user "nobody".')
  })

  it("builds actors for an organization's members only", async () => {
    expect(await identity.getActorsFor(["ada", "solo", "nobody"], "acme")).toEqual([
      { userId: "ada", orgId: "acme", roles: ["admin"] }
    ])
    expect(await identity.getActorsFor(["solo"], null)).toEqual([{ userId: "solo", orgId: null, roles: [] }])
  })

  it("looks up and searches users", async () => {
    expect(await identity.getUsers?.(["grace", "nobody"])).toEqual([
      { id: "grace", name: "Grace Hopper", email: null, image: null }
    ])
    expect(await identity.searchUsers?.("example", { orgId: "acme" })).toMatchObject([{ id: "ada" }])
    expect(await identity.searchUsers?.("o", { orgId: "acme", limit: 1 })).toMatchObject([{ id: "ada" }])
    expect(await identity.searchUsers?.("solo", { orgId: "acme" })).toEqual([])
    expect(identity.userTable).toBe("user")
  })
})
