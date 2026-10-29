import { createCommentsClient } from "@better-apps/comments/client"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { client } from "./better-apps.server"

/**
 * Loads an invoice's threads and each thread's comments as the request's user, the way the browser would, and returns
 * the store's snapshot for the router to hydrate the browser's store with.
 */
export const loadInvoiceComments = createServerFn({ method: "GET" })
  .validator(z.object({ invoiceId: z.string() }))
  .handler(async ({ data }) => {
    const comments = createCommentsClient(client())
    await comments.loadThreads({ subjectType: "invoice", subjectId: data.invoiceId })
    const { lists, threads } = comments.store.getSnapshot()
    const listed = Object.values(lists).flatMap((list) => list.ids)
    await Promise.all(listed.filter((id) => threads[id]).map((id) => comments.loadThread(id)))
    return comments.dehydrate()
  })

/** Loads open and total thread counts for a list of invoices. */
export const loadCommentCounts = createServerFn({ method: "GET" })
  .validator(z.object({ invoiceIds: z.array(z.string()).max(200) }))
  .handler(async ({ data }) => {
    const comments = createCommentsClient(client())
    await comments.loadCounts("invoice", data.invoiceIds)
    return comments.dehydrate()
  })
