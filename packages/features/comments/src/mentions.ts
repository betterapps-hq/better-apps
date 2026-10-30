import { defineMentionSource, parseMentions } from "@better-apps/mentions"
import type { CommentsEventData } from "./events.js"
import { commentSubjectTypes } from "./subjects.js"

const subjectType = commentSubjectTypes.comment

/**
 * Records comments' mentions for the mentions feature, so each user can list where they were mentioned:
 * `mentions({ sources: [commentMentions] })`. A mention's record is the comment, and its group the thread.
 */
export const commentMentions = defineMentionSource({
  feature: "comments",
  subjectTypes: [subjectType],
  events: {
    "comment.mentioned": (event) => {
      const { userId, orgId, thread, comment } = event.data as CommentsEventData["comment.mentioned"]
      return {
        add: [
          {
            userId,
            orgId: orgId === "" ? null : orgId,
            authorId: comment.authorType === "user" ? comment.authorId : null,
            subjectType,
            subjectId: comment.id,
            groupId: thread.id,
            excerpt: comment.bodyText
          }
        ]
      }
    },
    // Body text keeps mentions as tokens in every format, so it says who an edited comment still mentions.
    "comment.edited": (event) => {
      const { comment } = event.data as CommentsEventData["comment.edited"]
      return {
        edit: [{ subjectType, subjectId: comment.id, keep: parseMentions(comment.bodyText), excerpt: comment.bodyText }]
      }
    },
    "comment.deleted": (event) => {
      const { comment } = event.data as CommentsEventData["comment.deleted"]
      return { remove: [{ subjectType, subjectId: comment.id }] }
    },
    "thread.deleted": (event) => {
      const { thread } = event.data as CommentsEventData["thread.deleted"]
      return { removeGroups: [thread.id] }
    },
    "user.removed": (event) => {
      const { userId } = event.data as CommentsEventData["user.removed"]
      return { removeUsers: [userId] }
    }
  }
})
