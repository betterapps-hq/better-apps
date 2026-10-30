import { createTestApp, type TestUser } from "@better-apps/testing"
import { defineAction, defineEvent, defineFeature, getFeatureTables } from "better-apps"
import { describe, expect, it } from "vitest"
import { defineMentionSource, mentionModel, mentions, mentionToken, type Mention } from "./index.js"

const users = [
  { id: "ada", name: "Ada Lovelace", orgId: "acme" },
  { id: "bob", name: "Bob Babbage", orgId: "acme" },
  { id: "gus", name: "Gus Globex", orgId: "globex" }
] as const satisfies readonly TestUser[]

interface NoteEvent {
  noteId: string
  boardId: string
  orgId: string
  authorId: string
  text: string
  userIds?: string[]
}

// Notes on boards. Anyone in a note's organization can see it, unless the note is hidden.
const hidden = new Set<string>()
const notes = defineFeature({
  id: "notes",
  events: {
    "note.written": defineEvent<NoteEvent>(),
    "note.edited": defineEvent<NoteEvent>(),
    "note.deleted": defineEvent<NoteEvent>(),
    "board.deleted": defineEvent<{ boardId: string }>(),
    "board.archived": defineEvent<{ boardId: string }>(),
    "user.removed": defineEvent<{ userId: string }>()
  },
  subjects: {
    note: {
      getOrgId: ({ subjectId }) => subjectId.split("/")[0] ?? null,
      canView: ({ actor, subjectId }) => !hidden.has(subjectId) && actor.orgId === subjectId.split("/")[0]
    }
  },
  actions: {
    emit: defineAction({
      serverOnly: true,
      handler: ({ input, emit }) => {
        const { type, data } = input as { type: string; data: unknown }
        emit(type, data)
      }
    })
  }
})

const noteMentions = defineMentionSource({
  feature: "notes",
  subjectTypes: ["note"],
  events: {
    "note.written": (event) => {
      const data = event.data as NoteEvent
      return {
        add: (data.userIds ?? []).map((userId) => ({
          userId,
          orgId: data.orgId,
          authorId: data.authorId,
          subjectType: "note",
          subjectId: data.noteId,
          groupId: data.boardId,
          excerpt: data.text
        }))
      }
    },
    "note.edited": (event) => {
      const data = event.data as NoteEvent
      return { edit: [{ subjectType: "note", subjectId: data.noteId, keep: data.userIds ?? [], excerpt: data.text }] }
    },
    "note.deleted": (event) => ({
      remove: [{ subjectType: "note", subjectId: (event.data as NoteEvent).noteId }]
    }),
    "board.deleted": (event) => ({ removeGroups: [(event.data as { boardId: string }).boardId] }),
    "user.removed": (event) => ({ removeUsers: [(event.data as { userId: string }).userId] }),
    "board.archived": () => null
  }
})

function setup() {
  hidden.clear()
  const { app, identity, database } = createTestApp({
    features: [notes, mentions({ sources: [noteMentions] })],
    users
  })
  const emit = (type: string, data: unknown) => app.api.notes.emit({ type, data })
  const write = (noteId: string, text: string, userIds: string[], authorId = "bob") =>
    emit("note.written", { noteId, boardId: "acme/b1", orgId: "acme", authorId, text, userIds })
  const list = (userId: string, input?: { cursor?: string; limit?: number }) =>
    app.api.mentions.listMentions(input, { actor: identity.actor(userId) })
  const rows = () => app.db.findMany<Mention>({ model: mentionModel })
  return { app, identity, database, emit, write, list, rows }
}

describe("mentions", () => {
  it("declares its table, with lookups by user, record and group", () => {
    const tables = getFeatureTables([mentions({ sources: [noteMentions] })])
    expect(tables.mention?.indexes?.map((index) => [index.name, index.unique ?? false])).toEqual([
      ["mention_by_user", false],
      ["mention_by_subject", true],
      ["mention_by_group", false]
    ])
  })

  it("records mentions from a source's events once, and lists them newest first with their users", async () => {
    const { write, list, rows } = setup()
    await write("acme/n1", `Hi ${mentionToken("ada")}`, ["ada"])
    await write("acme/n1", `Hi ${mentionToken("ada")}`, ["ada"])
    await write("acme/n2", `Also ${mentionToken("ada")} and ${mentionToken("gus")}`, ["ada"])
    expect(await rows()).toHaveLength(2)
    const page = await list("ada")
    expect(page.mentions.map((mention) => mention.subjectId)).toEqual(["acme/n2", "acme/n1"])
    expect(page.mentions[0]).toMatchObject({
      orgId: "acme",
      userId: "ada",
      authorId: "bob",
      feature: "notes",
      subjectType: "note",
      groupId: "acme/b1"
    })
    expect(Object.keys(page.users).sort()).toEqual(["ada", "bob", "gus"])
    expect((await list("bob")).mentions).toEqual([])
  })

  it("pages without skipping, and hides mentions the user can no longer see", async () => {
    const { write, list } = setup()
    for (const id of ["acme/n1", "acme/n2", "acme/n3"]) {
      await write(id, "x", ["ada"])
    }
    const first = await list("ada", { limit: 2 })
    expect(first.mentions).toHaveLength(2)
    const second = await list("ada", { limit: 2, cursor: first.cursor ?? undefined })
    expect(second).toMatchObject({ cursor: null })
    expect([...first.mentions, ...second.mentions].map((mention) => mention.subjectId).sort()).toEqual([
      "acme/n1",
      "acme/n2",
      "acme/n3"
    ])
    hidden.add("acme/n3")
    expect((await list("ada")).mentions.map((mention) => mention.subjectId).sort()).toEqual(["acme/n1", "acme/n2"])
  })

  it("lists only the organization the user is acting in", async () => {
    const { emit, list } = setup()
    await emit("note.written", {
      noteId: "globex/n1",
      boardId: "globex/b1",
      orgId: "globex",
      authorId: "gus",
      text: "x",
      userIds: ["ada"]
    })
    expect((await list("ada")).mentions).toEqual([])
  })

  it("drops users an edit no longer mentions, and refreshes the excerpt for the rest", async () => {
    const { write, emit, rows } = setup()
    await write("acme/n1", "Hi both", ["ada", "gus"])
    await emit("note.edited", { noteId: "acme/n1", text: "Hi Ada", userIds: ["ada"] })
    expect((await rows()).map((row) => [row.userId, row.excerpt])).toEqual([["ada", "Hi Ada"]])
    await emit("note.edited", { noteId: "acme/n1", text: "Hi nobody", userIds: [] })
    expect(await rows()).toEqual([])
  })

  it("removes mentions by record, group and user", async () => {
    const { write, emit, rows } = setup()
    await write("acme/n1", "x", ["ada", "gus"])
    await write("acme/n2", "x", ["ada"], "ada")
    await emit("note.deleted", { noteId: "acme/n1" })
    expect((await rows()).map((row) => row.subjectId)).toEqual(["acme/n2"])
    await emit("user.removed", { userId: "ada" })
    expect(await rows()).toEqual([])
    await write("acme/n3", "x", ["gus"])
    await emit("board.deleted", { boardId: "acme/b1" })
    await emit("board.archived", { boardId: "acme/b1" })
    expect(await rows()).toEqual([])
  })

  it("caps excerpts at 280 characters", async () => {
    const { write, rows } = setup()
    await write("acme/n1", "y".repeat(400), ["ada"])
    await write("acme/n2", `${"y".repeat(270)} ${mentionToken("ada")}`, ["ada"])
    await write("acme/n3", `${"y".repeat(270)} \\@[ and more text`, ["ada"])
    await write("acme/n4", `@[draft ${"y".repeat(300)} ${mentionToken("ada")}`, ["ada"])
    expect((await rows()).map((row) => row.excerpt)).toEqual([
      "y".repeat(280),
      "y".repeat(270),
      `${"y".repeat(270)} \\@[ and m`,
      `@[draft ${"y".repeat(272)}`
    ])
  })

  it("refuses signed-out callers and bad cursors, and removes a user's mentions from server code", async () => {
    const { app, write, list, rows } = setup()
    await expect(app.api.mentions.listMentions(undefined, { actor: null })).rejects.toMatchObject({
      code: "UNAUTHENTICATED"
    })
    await expect(list("ada", { cursor: "nope" })).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await write("acme/n1", "x", ["ada"])
    await app.api.mentions.removeUser({ userId: "bob" })
    expect(await rows()).toEqual([])
  })

  it("needs the app to declare its sources' subject types", () => {
    const orphan = defineMentionSource({ feature: "notes", subjectTypes: ["page"], events: {} })
    expect(() => createTestApp({ features: [notes, mentions({ sources: [orphan] })], users })).toThrow(
      'The "mentions" feature uses the "page" subject type, but nothing declares it.'
    )
  })
})
