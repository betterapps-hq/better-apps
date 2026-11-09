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
  type ErrorContext,
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

function setup(
  subjects: Record<string, SubjectDefinition> = { invoice, page },
  features: BetterAppsFeature[] = [],
  onError?: (error: unknown, context: ErrorContext) => void
) {
  return createBetterApps({ database: memoryDatabase().database, identity, subjects, features, onError })
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

  it("reads many organizations and public checks with one call per subject type, in order", async () => {
    const getOrgIds = vi.fn<(refs: readonly { subjectId: string }[]) => (string | null)[]>(
      (refs: readonly { subjectId: string }[]) => refs.map(({ subjectId }) => orgs[subjectId] ?? null)
    )
    const publicReadMany = vi.fn<(refs: readonly { subjectId: string }[]) => boolean[]>(
      (refs: readonly { subjectId: string }[]) => refs.map(({ subjectId }) => subjectId.startsWith("public-"))
    )
    const { subjects } = setup({ invoice: { ...invoice, getOrgIds }, page: { ...page, publicReadMany } })
    const refs = [
      { subjectType: "invoice", subjectId: "inv-2" },
      { subjectType: "invoice", subjectId: "inv-9" },
      { subjectType: "invoice", subjectId: "inv-1" }
    ]
    expect(await subjects.getOrgIds(refs, ada)).toEqual(["globex", null, "acme"])
    expect(getOrgIds).toHaveBeenCalledTimes(1)
    expect(await subjects.getOrgIds([{ subjectType: "page", subjectId: "draft" }], solo)).toEqual([null])
    const pages = ["public-home", "draft", "public-about"].map((subjectId) => ({ subjectType: "page", subjectId }))
    expect(await subjects.isPublicMany(pages)).toEqual([true, false, true])
    expect(await subjects.canViewMany(pages.map((ref) => ({ ...ref, actor: null })))).toEqual([true, false, true])
    expect(publicReadMany).toHaveBeenCalledTimes(2)
    const { subjects: plain } = setup()
    expect(await plain.getOrgIds(refs.slice(0, 2))).toEqual(["globex", null])
    expect(await plain.isPublicMany(pages)).toEqual([true, false, true])
  })

  it("answers a single public check with publicReadMany too", async () => {
    const publicReadMany = (refs: readonly { subjectId: string }[]) =>
      refs.map(({ subjectId }) => subjectId.startsWith("public-"))
    const { subjects } = setup({ page: { ...page, publicRead: undefined, publicReadMany } })
    expect(await subjects.isPublic({ subjectType: "page", subjectId: "public-home" })).toBe(true)
    expect(await subjects.isPublic({ subjectType: "page", subjectId: "draft" })).toBe(false)
    expect(await subjects.canView(null, { subjectType: "page", subjectId: "public-home" })).toBe(true)
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

  it("counts grants a request carries, only for checks that pass it, asking each feature once per request", async () => {
    const asked: string[][] = []
    // Grants invoices whose id is in the request's x-share header.
    const shares = defineFeature({
      id: "shares",
      grants: {
        canViewMany: (refs, { request }) => {
          asked.push(refs.map((ref) => ref.subjectId))
          const shared = (request.headers.get("x-share") ?? "").split(",")
          return refs.map((ref) => ref.subjectType === "invoice" && shared.includes(ref.subjectId))
        }
      }
    })
    const { subjects } = setup({ invoice, page }, [shares])
    const request = new Request("https://app.test/", { headers: { "x-share": "inv-2" } })
    const inv2 = { subjectType: "invoice", subjectId: "inv-2" }
    expect(await subjects.canView(null, inv2)).toBe(false)
    expect(await subjects.canView(ada, inv2)).toBe(false)
    expect(asked).toEqual([])
    expect(await subjects.canView(null, inv2, { request })).toBe(true)
    expect(await subjects.canView(ada, inv2, { request })).toBe(true)
    expect(await subjects.canView(ada, { subjectType: "invoice", subjectId: "inv-3" }, { request })).toBe(false)
    expect(await subjects.isPublic(inv2)).toBe(false)

    asked.length = 0
    const allowed = await subjects.canViewMany([
      { actor: ada, subjectType: "invoice", subjectId: "inv-1", request },
      { actor: ada, ...inv2, request },
      { actor: solo, ...inv2 },
      { actor: null, subjectType: "page", subjectId: "draft", request }
    ])
    expect(allowed).toEqual([true, true, false, false])
    // inv-1 passed the app's rules, so only the refused checks that carry the request were asked about.
    expect(asked).toEqual([["inv-2", "draft"]])
  })

  it("lets grants report an error they recovered from to the app's onError, as their feature's", async () => {
    const failure = new Error("The share service is down.")
    const shares = defineFeature({
      id: "shares",
      grants: {
        canViewMany: (refs, { reportError }) => {
          reportError(failure)
          return refs.map(() => false)
        }
      }
    })
    const onError = vi.fn<(error: unknown, context: ErrorContext) => void>()
    const { subjects } = setup({ invoice, page }, [shares], onError)
    const request = new Request("https://app.test/")
    expect(await subjects.canView(ada, { subjectType: "invoice", subjectId: "inv-2" }, { request })).toBe(false)
    expect(onError).toHaveBeenCalledWith(failure, { feature: "shares" })
  })

  it("fails a throwing grant closed and reports it, while other grants and the check go on", async () => {
    const failure = new Error("The share service is down.")
    const broken = defineFeature({
      id: "broken",
      grants: {
        canViewMany: () => {
          throw failure
        }
      }
    })
    const shares = defineFeature({
      id: "shares",
      grants: { canViewMany: (refs) => refs.map((ref) => ref.subjectId === "inv-2") }
    })
    const onError = vi.fn<(error: unknown, context: ErrorContext) => void>()
    const { subjects } = setup({ invoice, page }, [broken, shares], onError)
    const request = new Request("https://app.test/")
    expect(await subjects.canView(ada, { subjectType: "invoice", subjectId: "inv-2" }, { request })).toBe(true)
    expect(await subjects.canView(ada, { subjectType: "invoice", subjectId: "inv-3" }, { request })).toBe(false)
    expect(onError).toHaveBeenCalledWith(failure, { feature: "broken" })

    // An onError that throws doesn't fail the check either.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
    try {
      const { subjects: strict } = setup({ invoice, page }, [broken, shares], () => {
        throw new Error("The reporter is down.")
      })
      expect(await strict.canView(ada, { subjectType: "invoice", subjectId: "inv-2" }, { request })).toBe(true)
    } finally {
      logged.mockRestore()
    }
  })

  it("hands a grant's report to the waitUntil of the request it was checking", async () => {
    const shares = defineFeature({
      id: "shares",
      grants: {
        canViewMany: (refs, { reportError }) => {
          reportError(new Error("A link's maker couldn't be checked."))
          return refs.map(() => false)
        }
      },
      actions: {
        peek: defineAction({
          handler: async ({ actor, subjects, request }) =>
            subjects.canView(actor, { subjectType: "invoice", subjectId: "inv-2" }, { request })
        })
      }
    })
    const app = createBetterApps({
      database: memoryDatabase().database,
      identity,
      subjects: { invoice, page },
      features: [shares],
      onError: async () => undefined
    })
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>()
    const request = new Request("https://app.test/")
    expect(await app.api.shares.peek(undefined, { actor: ada, request, waitUntil })).toBe(false)
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise))
  })
})
