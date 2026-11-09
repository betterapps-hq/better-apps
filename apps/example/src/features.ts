import { elementAnchor } from "@better-apps/anchors"
import { comments, commentSubjectTypes } from "@better-apps/comments"
import {
  domainModel,
  domains,
  localHostnames,
  type DnsRecord,
  type DomainRow,
  type DomainsEventData
} from "@better-apps/domains"
import { reactions } from "@better-apps/reactions"
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
 * Custom domains on a provider kept in memory, with its own DNS, so the example never calls Cloudflare. The provider
 * forgets its hostnames on restart, which the next check registers again.
 */
const hostnames = localHostnames({ target: "customers.better-invoices.localhost" })

/** Adds records to the local DNS, as a customer would where they manage their domain. */
export function publishDemoRecords(records: readonly DnsRecord[]) {
  for (const record of records) {
    hostnames.dns.publish(record.name, record.type, record.value)
  }
}

/**
 * Plays the customer in the demo: a custom domain's records go into the local DNS as soon as it's added, so its next
 * check proves the workspace owns it, and the one after finds it ready.
 */
const demoCustomer = defineFeature({
  id: "demo-customer",
  on: {
    domains: {
      "domain.added": async (event, { db }) => {
        const { domain } = event.data as DomainsEventData["domain.added"]
        const row = await db.findOne<DomainRow>({ model: domainModel, where: [{ field: "id", value: domain.id }] })
        publishDemoRecords(row?.records ?? [])
      }
    }
  }
})

/**
 * The workspace's domains: a subdomain of `better-invoices.localhost` and custom domains. Better Auth here has no
 * organizations, so the whole workspace shares one set, and the owner manages them.
 */
const workspaceDomains = domains({
  subdomains: { zone: "better-invoices.localhost" },
  custom: { provider: hostnames },
  dns: hostnames.dns,
  canManage: ({ actor }) => isOwner(actor.userId)
})

/** The features the app enables. `better-apps.config.ts` reads them to generate their tables. */
export const features = [notes, invoiceComments, commentReactions, workspaceDomains, demoCustomer] as const
