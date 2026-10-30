import { mentions, mentionToken } from "@better-apps/mentions"
import { createTestApp } from "@better-apps/testing"
import { describe, expect, it } from "vite-plus/test"
import { options, subjects, users, type UserId } from "../test/app.js"
import { commentMentions, comments } from "./index.js"

const onInvoice = { subjectType: "invoice", subjectId: "inv-1" } as const

function setup() {
  const { app, identity } = createTestApp({
    subjects,
    features: [comments(options), mentions({ sources: [commentMentions] })],
    users
  })
  const as = (userId: UserId) => ({ actor: identity.actor(userId) })
  const mentionsOf = async (userId: UserId) =>
    (await app.api.mentions.listMentions(undefined, as(userId))).mentions.map((mention) => mention.subjectId)
  return { api: app.api.comments, as, mentionsOf, app }
}

describe("commentMentions", () => {
  it("lists the comments that mention a user, with the thread as the group", async () => {
    const { api, as, mentionsOf, app } = setup()
    const { thread, comment } = await api.createThread({ ...onInvoice, body: `Hi ${mentionToken("ada")}` }, as("bob"))
    const page = await app.api.mentions.listMentions(undefined, as("ada"))
    expect(page.mentions).toMatchObject([
      {
        userId: "ada",
        authorId: "bob",
        orgId: "acme",
        feature: "comments",
        subjectType: "comments.comment",
        subjectId: comment.id,
        groupId: thread.id,
        excerpt: `Hi ${mentionToken("ada")}`
      }
    ])
    expect(page.users).toMatchObject({ bob: { name: "Bob Babbage" }, ada: { name: "Ada Lovelace" } })
    expect(await mentionsOf("bob")).toEqual([])
  })

  it("follows edits, deleted comments and deleted threads", async () => {
    const { api, as, mentionsOf } = setup()
    const { thread, comment } = await api.createThread({ ...onInvoice, body: `Hi ${mentionToken("ada")}` }, as("bob"))
    const reply = await api.reply({ threadId: thread.id, body: `And ${mentionToken("sam")}` }, as("bob"))
    await api.editComment({ commentId: comment.id, body: `Hi ${mentionToken("sam")}` }, as("bob"))
    expect(await mentionsOf("ada")).toEqual([])
    expect((await mentionsOf("sam")).sort()).toEqual([comment.id, reply.comment.id].sort())
    await api.deleteComment({ commentId: reply.comment.id }, as("bob"))
    expect(await mentionsOf("sam")).toEqual([comment.id])
    await api.deleteThread({ threadId: thread.id }, as("ada"))
    expect(await mentionsOf("sam")).toEqual([])
  })

  it("hides a mention once its thread is out of the user's sight", async () => {
    const { api, as, mentionsOf } = setup()
    const { thread, comment } = await api.createThread(
      { ...onInvoice, body: `Hi ${mentionToken("bob")} and ${mentionToken("sam")}` },
      as("ada")
    )
    expect(await mentionsOf("bob")).toEqual([comment.id])
    await api.updateThread({ threadId: thread.id, visibility: "staff" }, as("ada"))
    expect(await mentionsOf("bob")).toEqual([])
    expect(await mentionsOf("sam")).toEqual([comment.id])
  })
})
