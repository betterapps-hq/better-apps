import { elementAnchor } from "@better-apps/anchors"
import { comments, commentSubjectTypes } from "@better-apps/comments"
import { reactions } from "@better-apps/reactions"
import { shortLinks } from "@better-apps/short-links"
import { BetterAppsError, defineAction, defineFeature, type SubjectDefinition } from "better-apps"
import { z } from "zod"

/** A note as the home page shows it. */
export interface Note {
  id: string
  text: string
  authorName: string | null
  createdAt: Date
}

type NoteRow = {
  id: string
  text: string
  authorId: string | null
  createdAt: Date
}

/** A tiny feature that proves the plumbing: the home page lists notes through a loader and adds them over HTTP. */
const notes = defineFeature({
  id: "notes",
  schema: {
    note: {
      fields: {
        text: { type: "string" },
        authorId: { type: "string", required: false },
        createdAt: { type: "date", index: true }
      }
    }
  },
  actions: {
    list: defineAction({
      handler: async ({ db, identity, actor }): Promise<Note[]> => {
        if (!actor) {
          throw new BetterAppsError("UNAUTHENTICATED", "Sign in to read notes.")
        }
        const rows = await db.findMany<NoteRow>({
          model: "note",
          sortBy: [
            { field: "createdAt", direction: "desc" },
            { field: "id", direction: "desc" }
          ],
          limit: 20
        })
        const authorIds = [...new Set(rows.flatMap((row) => (row.authorId ? [row.authorId] : [])))]
        const authors = new Map((await identity.getUsers?.(authorIds))?.map((user) => [user.id, user.name]))
        return rows.map((row) => ({
          id: row.id,
          text: row.text,
          authorName: (row.authorId && authors.get(row.authorId)) ?? null,
          createdAt: row.createdAt
        }))
      }
    }),
    add: defineAction({
      input: z.object({ text: z.string().trim().min(1, "Write a note first.").max(500) }),
      handler: async ({ input, db, actor, author, now }): Promise<{ id: string }> => {
        if (!actor) {
          throw new BetterAppsError("UNAUTHENTICATED", "Sign in to add notes.")
        }
        const authorId = author?.type === "user" ? author.userId : null
        const note = await db.create({ model: "note", data: { text: input.text, authorId, createdAt: now } })
        return { id: note.id as string }
      }
    })
  }
})

// Loaded when a check runs rather than with this file, so generating the schema never opens the database.
const invoiceExists = async (id: string) => (await import("./invoices.server")).invoiceExists(id)
const isOwner = async (userId: string) => (await import("./people.server")).isOwner(userId)

/**
 * The records features attach to. Anyone signed in can see any invoice that exists; a real app would check the
 * invoice's owner or organization here.
 */
export const subjects = {
  invoice: { canView: ({ subjectId }) => invoiceExists(subjectId) }
} satisfies Record<string, SubjectDefinition>

/**
 * Comment threads on invoices, optionally pinned to one of an invoice's details. Anyone who can see one can discuss it,
 * and the workspace owner moderates.
 */
const invoiceComments = comments({
  subjects: {
    invoice: {
      canComment: ({ subjectId }) => invoiceExists(subjectId),
      canModerate: ({ actor }) => isOwner(actor.userId)
    }
  },
  anchors: [elementAnchor()]
})

/**
 * Emoji reactions on comments, from a short list. Whoever can see a comment can react to it, and the workspace owner
 * can remove its reactions.
 */
const commentReactions = reactions({
  subjects: { [commentSubjectTypes.comment]: { canModerate: ({ actor }) => isOwner(actor.userId) } },
  emojis: ["👍", "🎉", "❤️", "👀"],
  maxPerUser: 1
})

/**
 * Short links to invoices, at `/s/{code}`. Whoever can see an invoice can share it, and a link can let anyone who has it
 * see the invoice without signing in.
 */
const invoiceLinks = shortLinks({
  subjects: { invoice: { url: ({ subjectId }) => `/invoices/${subjectId}`, grantView: true } }
})

/** The features the app enables. `better-apps.config.ts` reads them to generate their tables. */
export const features = [notes, invoiceComments, commentReactions, invoiceLinks] as const
