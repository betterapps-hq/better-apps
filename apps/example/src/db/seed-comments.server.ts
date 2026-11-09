import { mentionToken } from "@better-apps/mentions"
import { count, inArray } from "drizzle-orm"
import type { app as App } from "../better-apps.server"
import { user } from "./auth-schema"
import { commentThread } from "./better-apps-schema"
import { db } from "./database.server"

type Person = "ada" | "grace" | "alan"

interface SeedComment {
  by: Person
  at: string
  /** The body, with `@ada`, `@grace` and `@alan` for mentions. */
  text: string
  reactions?: [Person, "👍" | "🎉" | "❤️" | "👀"][]
}

interface SeedThread {
  invoiceId: string
  /** The `data-field` of the detail the thread is pinned to, or nothing for the whole invoice. */
  field?: string
  comments: SeedComment[]
  resolvedBy?: Person
}

const threads: SeedThread[] = [
  {
    invoiceId: "inv-1002",
    field: "due",
    comments: [
      {
        by: "grace",
        at: "2026-10-27T15:12:00Z",
        text: "This is five weeks late now. @ada should I send a final notice, or do you want to call them first?"
      },
      {
        by: "ada",
        at: "2026-10-27T16:40:00Z",
        text: "Call first. They mentioned a budget freeze when we last spoke.",
        reactions: [["grace", "👍"]]
      },
      {
        by: "alan",
        at: "2026-10-28T09:05:00Z",
        text: "I'm seeing their team on Thursday and can raise it then.",
        reactions: [
          ["ada", "🎉"],
          ["grace", "🎉"]
        ]
      }
    ]
  },
  {
    invoiceId: "inv-1002",
    field: "line-inv-1002-3",
    comments: [
      {
        by: "alan",
        at: "2026-08-22T11:30:00Z",
        text: "They asked whether the second revision round can be waived as a goodwill gesture."
      }
    ]
  },
  {
    invoiceId: "inv-1004",
    field: "totals",
    resolvedBy: "grace",
    comments: [
      {
        by: "alan",
        at: "2026-10-16T08:45:00Z",
        text: "19% VAT looks right, but can we confirm they don't expect a reverse charge? @grace"
      },
      {
        by: "grace",
        at: "2026-10-16T13:10:00Z",
        text: "Confirmed with their AP team. Standard rate is correct.",
        reactions: [["alan", "❤️"]]
      }
    ]
  },
  {
    invoiceId: "inv-1009",
    field: "line-inv-1009-1",
    comments: [
      { by: "ada", at: "2026-10-21T10:00:00Z", text: "Six posters? The brief said eight." },
      {
        by: "alan",
        at: "2026-10-21T10:24:00Z",
        text: "@ada two were cut in the last round, so six is right.",
        reactions: [["ada", "👍"]]
      }
    ]
  },
  {
    invoiceId: "inv-1012",
    comments: [
      {
        by: "grace",
        at: "2026-11-02T17:20:00Z",
        text: "Sent along with the design system handoff.",
        reactions: [
          ["ada", "🎉"],
          ["alan", "🎉"]
        ]
      }
    ]
  },
  {
    invoiceId: "inv-1008",
    field: "notes",
    comments: [
      {
        by: "grace",
        at: "2026-11-05T09:15:00Z",
        text: "No answer to the second reminder. I'll hand it to collections next week unless @alan hears back."
      },
      { by: "alan", at: "2026-11-05T11:02:00Z", text: "Their project lead is back on Monday. I'll call then." }
    ]
  }
]

const emails: Record<Person, string> = {
  ada: "ada@example.com",
  grace: "grace@example.com",
  alan: "alan@example.com"
}

/**
 * Adds a few conversations on the sample invoices on the first start, written through the features as the demo
 * people would write them, so the invoices have comments, mentions and reactions to look at.
 */
export async function seedComments(app: typeof App) {
  const [existing] = await db.select({ threads: count() }).from(commentThread)
  if (existing?.threads) {
    return
  }
  const rows = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inArray(user.email, Object.values(emails)))
  const ids = Object.fromEntries(rows.map((row) => [row.email, row.id]))
  const idOf = (person: Person) => ids[emails[person]] as string
  if (Object.values(emails).some((email) => !ids[email])) {
    return
  }
  const as = (person: Person) => ({ actor: { userId: idOf(person), orgId: null, roles: [] } })
  const body = (text: string) => text.replace(/@(ada|grace|alan)\b/g, (_, person: Person) => mentionToken(idOf(person)))

  for (const thread of threads) {
    const [first, ...replies] = thread.comments as [SeedComment, ...SeedComment[]]
    const anchor = thread.field
      ? { kind: "element" as const, value: { selector: `[data-field="${thread.field}"]`, offset: { x: 1, y: 0 } } }
      : null
    const created = await app.api.comments.createThread(
      { subjectType: "invoice", subjectId: thread.invoiceId, body: body(first.text), anchor },
      { ...as(first.by), createdAt: new Date(first.at) }
    )
    const commentIds = [created.comment.id]
    for (const reply of replies) {
      const written = await app.api.comments.reply(
        { threadId: created.thread.id, body: body(reply.text) },
        { ...as(reply.by), createdAt: new Date(reply.at) }
      )
      commentIds.push(written.comment.id)
    }
    for (const [index, comment] of thread.comments.entries()) {
      for (const [person, emoji] of comment.reactions ?? []) {
        await app.api.reactions.react(
          { subjectType: "comments.comment", subjectId: commentIds[index]!, emoji },
          as(person)
        )
      }
    }
    if (thread.resolvedBy) {
      await app.api.comments.resolveThread({ threadId: created.thread.id }, as(thread.resolvedBy))
    }
  }
}
