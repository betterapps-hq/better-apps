import { describe, expect, it, vi } from "vite-plus/test"
import { memoryDatabase } from "../test/memory-database.js"
import {
  BetterAppsError,
  createBetterApps,
  defineAction,
  defineFeature,
  defineSubject,
  type Actor,
  type BetterAppsFeature,
  type Identity,
  type SubjectArgs,
  type SubjectDefinition
} from "./index.js"

const ada: Actor = { userId: "ada", orgId: "acme", roles: [] }
const gus: Actor = { userId: "gus", orgId: "globex", roles: [] }
const solo: Actor = { userId: "solo", orgId: null, roles: [] }

const identity: Identity = { getActor: async () => null, getActorsFor: async () => [] }

const orgs: Record<string, string> = { "inv-1": "acme", "inv-2": "globex" }

// Invoices are seen within their organization; pages are public when their id says so.
const invoice = defineSubject({
  getOrgId: ({ subjectId }) => orgs[subjectId] ?? null,
  canView: ({ actor, subjectId }) => actor.orgId === orgs[subjectId]
})
const page: SubjectDefinition = {
  canView: () => true,
  publicRead: ({ subjectId }) => subjectId.startsWith("public-")
}

function setup(subjects: Record<string, SubjectDefinition> = { invoice, page }, features: BetterAppsFeature[] = []) {
  return createBetterApps({ database: memoryDatabase().database, identity, subjects, features })
}

describe("subjects", () => {
  it("answers canView from the subject type, and lets signed-out visitors see only public subjects", async () => {
    const { subjects } = setup()
    expect(await subjects.canView(ada, { subjectType: "invoice", subjectId: "inv-1" })).toBe(true)
    expect(await subjects.canView(gus, { subjectType: "invoice", subjectId: "inv-1" })).toBe(false)
    expect(await subjects.canView(null, { subjectType: "invoice", subjectId: "inv-1" })).toBe(false)
    expect(await subjects.canView(null, { subjectType: "page", subjectId: "public-home" })).toBe(true)
    expect(await subjects.canView(null, { subjectType: "page", subjectId: "draft" })).toBe(false)
    expect(await subjects.isPublic({ subjectType: "page", subjectId: "public-home" })).toBe(true)
    expect(subjects.has("invoice")).toBe(true)
    expect(subjects.has("order")).toBe(false)
  })

  it("checks many pairs with one canViewMany call per subject type, in order", async () => {
    const canViewMany = vi.fn<(pairs: readonly SubjectArgs[]) => boolean[]>((pairs) =>
      pairs.map(({ actor, subjectId }) => actor.orgId === orgs[subjectId])
    )
    const { subjects } = setup({ invoice: { ...invoice, canViewMany }, page })
    const allowed = await subjects.canViewMany([
      { actor: ada, subjectType: "invoice", subjectId: "inv-1" },
      { actor: null, subjectType: "page", subjectId: "public-home" },
      { actor: gus, subjectType: "invoice", subjectId: "inv-1" },
      { actor: null, subjectType: "invoice", subjectId: "inv-1" },
      { actor: gus, subjectType: "invoice", subjectId: "inv-2" },
      { actor: ada, subjectType: "page", subjectId: "draft" }
    ])
    expect(allowed).toEqual([true, true, false, false, true, true])
    expect(canViewMany).toHaveBeenCalledTimes(1)
    expect(canViewMany.mock.calls[0]?.[0]).toHaveLength(3)
  })

  it("reads the organization, and needs getOrgId when the actor has one", async () => {
    const { subjects } = setup()
    expect(await subjects.getOrgId({ subjectType: "invoice", subjectId: "inv-2" }, ada)).toBe("globex")
    expect(await subjects.getOrgId({ subjectType: "invoice", subjectId: "inv-9" })).toBeNull()
    expect(await subjects.getOrgId({ subjectType: "page", subjectId: "draft" }, solo)).toBeNull()
    await expect(subjects.getOrgId({ subjectType: "page", subjectId: "draft" }, ada)).rejects.toThrow(
      'The "page" subject type needs getOrgId, because the identity adapter reports organizations.'
    )
  })

  it("refuses a subject type nobody declares as invalid input", async () => {
    const { subjects } = setup()
    const error = await subjects.canView(ada, { subjectType: "order", subjectId: "1" }).catch((caught) => caught)
    expect(error).toBeInstanceOf(BetterAppsError)
    expect(error).toMatchObject({ code: "INVALID_INPUT", message: 'There\'s no "order" subject type.' })
  })

  it("adds features' subject types, whose checks can read the database and other subjects", async () => {
    const notes = defineFeature({
      id: "notes",
      schema: { note: { fields: { invoiceId: { type: "string" } } } },
      subjects: {
        note: {
          getOrgId: async ({ subjectId }, { db }) => {
            const note = await db.findOne<{ id: string; invoiceId: string }>({
              model: "note",
              where: [{ field: "id", value: subjectId }]
            })
            return note ? (orgs[note.invoiceId] ?? null) : null
          },
          canView: async ({ actor, subjectId }, { db, subjects }) => {
            const note = await db.findOne<{ id: string; invoiceId: string }>({
              model: "note",
              where: [{ field: "id", value: subjectId }]
            })
            return note !== null && subjects.canView(actor, { subjectType: "invoice", subjectId: note.invoiceId })
          }
        }
      },
      usesSubjects: ["invoice"],
      actions: {
        canSee: defineAction({
          handler: async ({ input, actor, subjects }) =>
            subjects.canView(actor, { subjectType: "note", subjectId: String(input) })
        })
      }
    })
    const app = createBetterApps({
      database: memoryDatabase().database,
      identity,
      subjects: { invoice },
      features: [notes]
    })
    await app.db.create({ model: "note", data: { id: "n-1", invoiceId: "inv-1" } })
    expect(await app.api.notes.canSee("n-1", { actor: ada })).toBe(true)
    expect(await app.api.notes.canSee("n-1", { actor: gus })).toBe(false)
    expect(await app.api.notes.canSee("n-2", { actor: ada })).toBe(false)
    expect(await app.subjects.getOrgId({ subjectType: "note", subjectId: "n-1" })).toBe("acme")
  })

  it("refuses to create an app whose subject types are missing or declared twice", () => {
    const uses = defineFeature({ id: "uses", usesSubjects: ["invoice", "order"] })
    expect(() => setup({ invoice }, [uses])).toThrow(
      'The "uses" feature uses the "order" subject type, but nothing declares it. Add it to the app\'s subjects.'
    )
    const declares = defineFeature({ id: "declares", subjects: { invoice } })
    expect(() => setup({ invoice }, [declares])).toThrow(
      'The "declares" feature declares the "invoice" subject type, which is already declared.'
    )
  })
})
