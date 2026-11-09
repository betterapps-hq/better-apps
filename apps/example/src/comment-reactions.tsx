import { useReactors, useSubjectReactions } from "@better-apps/reactions/react"
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@buildkitgg/shadcn-baseui-kit"
import { SmilePlusIcon } from "lucide-react"
import { useState } from "react"
import type { ReactionTypes } from "./app-types"

type Emoji = ReactionTypes["emoji"]

/** The reactions the app allows, in the order they show, with names for screen readers. */
const emojis = [
  { emoji: "👍", name: "Thumbs up" },
  { emoji: "🎉", name: "Celebrate" },
  { emoji: "❤️", name: "Heart" },
  { emoji: "👀", name: "Looking" }
] as const satisfies readonly { emoji: Emoji; name: string }[]

const nameOf = (emoji: Emoji) => emojis.find((item) => item.emoji === emoji)?.name ?? emoji

/**
 * A comment's reactions: a chip for each emoji someone used, pressed when the viewer used it, and a picker for the
 * rest. Each person reacts with one emoji, so picking another replaces theirs.
 */
export function CommentReactions({ commentId }: { commentId: string }) {
  const subject = { subjectType: "comments.comment", subjectId: commentId } as const
  const { reactions, state, toggle, writeError, isPending } = useSubjectReactions<ReactionTypes>(subject)
  const [picking, setPicking] = useState(false)
  if (state !== "ready") {
    return null
  }
  const used = emojis.flatMap(({ emoji, name }) => {
    const reaction = reactions.find((item) => item.emoji === emoji)
    return reaction && reaction.count > 0 ? [{ emoji, name, count: reaction.count, reacted: reaction.reacted }] : []
  })
  const mine = emojis.find(({ emoji }) => reactions.some((item) => item.emoji === emoji && item.reacted))?.emoji

  return (
    <fieldset className="reactions" aria-label="Reactions">
      {used.map((reaction) => (
        <Tooltip key={reaction.emoji}>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="reaction"
                aria-pressed={reaction.reacted}
                aria-label={`${reaction.name}, ${reaction.count} ${reaction.count === 1 ? "reaction" : "reactions"}`}
                aria-disabled={isPending(reaction.emoji)}
                onClick={() => !isPending(reaction.emoji) && void toggle(reaction.emoji)}
              />
            }
          >
            <span aria-hidden="true">{reaction.emoji}</span>
            <span aria-hidden="true">{reaction.count}</span>
          </TooltipTrigger>
          <TooltipContent>
            <Reactors commentId={commentId} emoji={reaction.emoji} />
          </TooltipContent>
        </Tooltip>
      ))}
      <Popover open={picking} onOpenChange={setPicking}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={mine ? `Change your reaction, now ${nameOf(mine)}` : "Add a reaction"}
            />
          }
        >
          <SmilePlusIcon />
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="reaction-picker" style={{ width: "auto", padding: 4 }}>
          {emojis.map(({ emoji, name }) => (
            <button
              key={emoji}
              type="button"
              aria-pressed={mine === emoji}
              aria-label={name}
              title={name}
              onClick={() => {
                setPicking(false)
                if (!isPending(emoji)) {
                  void toggle(emoji)
                }
              }}
            >
              {emoji}
            </button>
          ))}
        </PopoverContent>
      </Popover>
      {writeError && (
        <p className="form-error" role="alert">
          {writeError.message}
        </p>
      )}
    </fieldset>
  )
}

/** Who reacted with one emoji, loaded when its tooltip opens. */
function Reactors({ commentId, emoji }: { commentId: string; emoji: Emoji }) {
  const { userIds, users, state } = useReactors<ReactionTypes>(
    { subjectType: "comments.comment", subjectId: commentId },
    emoji
  )
  if (state !== "ready") {
    return <span>Loading</span>
  }
  const names = userIds.map((id) => users[id]?.name ?? "Former user")
  return (
    <span>
      {nameOf(emoji)} from {names.join(", ")}
    </span>
  )
}
