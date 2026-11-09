import { useStore } from "@better-apps/react"
import { useReactions, useReactors, useSubjectReactions, type ReactionSummary } from "@better-apps/reactions/react"
import {
  Button,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@buildkitgg/shadcn-baseui-kit"
import { createStore } from "better-apps/client"
import { SmileIcon, SmilePlusIcon } from "lucide-react"
import { useState } from "react"
import type { App, ReactionTypes } from "./app-types"
import { plural } from "./format"
import { modals } from "./ui"

type Emoji = ReactionTypes["emoji"]

/** The reactions the app allows, in the order they show, with names for screen readers. */
const emojis = [
  { emoji: "👍", name: "Thumbs up" },
  { emoji: "🎉", name: "Celebrate" },
  { emoji: "❤️", name: "Heart" },
  { emoji: "👀", name: "Looking" }
] as const satisfies readonly { emoji: Emoji; name: string }[]

const nameOf = (emoji: Emoji) => emojis.find((item) => item.emoji === emoji)?.name ?? emoji

/** A comment as reactions know it. Comments name the subject type in `commentSubjectTypes`, on the server. */
const commentSubject = (commentId: string) => ({ subjectType: "comments.comment", subjectId: commentId }) as const

/** The emoji someone used on a comment, in the app's order, with their names and counts. */
const usedEmojis = (reactions: readonly ReactionSummary[]) =>
  emojis.flatMap(({ emoji, name }) => {
    const reaction = reactions.find((item) => item.emoji === emoji)
    return reaction && reaction.count > 0 ? [{ emoji, name, count: reaction.count, reacted: reaction.reacted }] : []
  })

/**
 * A comment's reactions: a chip for each emoji someone used, pressed when the viewer used it, and a picker for the
 * rest. Each person reacts with one emoji, so picking another replaces theirs. Read-only, such as for a visitor with a
 * share link, it shows the chips alone.
 */
export function CommentReactions({ commentId, readOnly = false }: { commentId: string; readOnly?: boolean }) {
  const { reactions, state, toggle, writeError, isPending } = useSubjectReactions<ReactionTypes>(
    commentSubject(commentId)
  )
  const [picking, setPicking] = useState(false)
  if (state === "error") {
    return <p className="form-error">Reactions couldn’t load.</p>
  }
  if (state !== "ready") {
    return null
  }
  const used = usedEmojis(reactions)
  const mine = used.find((reaction) => reaction.reacted)?.emoji

  if (readOnly) {
    return used.length === 0 ? null : (
      <ul className="reactions" aria-label="Reactions">
        {used.map((reaction) => (
          <li key={reaction.emoji} className="reaction">
            <span aria-hidden="true">{reaction.emoji}</span>
            <span aria-hidden="true">{reaction.count}</span>
            <span className="visually-hidden">
              {reaction.name}, {plural(reaction.count, "reaction", "reactions")}
            </span>
          </li>
        ))}
      </ul>
    )
  }

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
                aria-label={`${reaction.name}, ${plural(reaction.count, "reaction", "reactions")}`}
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

/** The comments whose reactions are being removed, so their menus wait until it's done, even after closing. */
const removing = createStore<ReadonlySet<string>>(new Set())
const setRemoving = (commentId: string, busy: boolean) =>
  removing.setState((ids) => {
    const next = new Set(ids)
    if (busy) {
      next.add(commentId)
    } else {
      next.delete(commentId)
    }
    return next
  })

interface RemoveReactionsProps {
  commentId: string
  onRemoved(title: string): void
  onError(title: string, error: unknown): void
}

/**
 * A moderator's menu for clearing a comment's reactions, all of them or one emoji's, after a confirmation. Nothing shows
 * while the comment has none.
 */
export function RemoveReactionsMenu({ commentId, onRemoved, onError }: RemoveReactionsProps) {
  const subject = commentSubject(commentId)
  const client = useReactions<App>()
  const { reactions, state } = useSubjectReactions<ReactionTypes>(subject)
  const busy = useStore(removing, (ids) => ids.has(commentId))
  const used = usedEmojis(reactions)
  if (state !== "ready" || used.length === 0) {
    return null
  }
  const total = used.reduce((sum, { count }) => sum + count, 0)

  async function remove(emoji?: Emoji) {
    const confirmed = await modals.confirm({
      title: emoji ? `Remove all ${nameOf(emoji).toLowerCase()} reactions?` : "Remove all reactions?",
      description: "They’re removed for everyone. People can react again afterward.",
      confirmLabel: "Remove reactions"
    })
    if (!confirmed) {
      return
    }
    setRemoving(commentId, true)
    try {
      // The client calls the server until every page is removed.
      const { removed } = await client.removeReactions({ ...subject, ...(emoji ? { emoji } : {}) })
      onRemoved(
        removed > 0 ? `${plural(removed, "reaction", "reactions")} removed` : "There were no reactions to remove"
      )
    } catch (error) {
      onError("The reactions couldn’t be removed", error)
    } finally {
      setRemoving(commentId, false)
    }
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={busy}>
        <SmileIcon />
        {busy ? "Removing reactions" : "Remove reactions"}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onClick={() => void remove()}>All reactions ({total})</DropdownMenuItem>
        {used.map(({ emoji, name, count }) => (
          <DropdownMenuItem key={emoji} onClick={() => void remove(emoji)}>
            <span aria-hidden="true">{emoji}</span>
            {name} ({count})
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** Who reacted with one emoji, loaded when its tooltip opens. */
function Reactors({ commentId, emoji }: { commentId: string; emoji: Emoji }) {
  const { userIds, users, state, hasMore } = useReactors<ReactionTypes>(commentSubject(commentId), emoji)
  if (state === "error") {
    return <span>Couldn’t load who reacted</span>
  }
  // A list that's loading again keeps showing, so an open tooltip doesn't flicker when someone reacts.
  if (userIds.length === 0 && state !== "ready") {
    return <span>Loading</span>
  }
  const names = userIds.map((id) => users[id]?.name ?? "Former user")
  // Tooltips show the first page; a list that goes on says so rather than looking complete.
  return (
    <span>
      {nameOf(emoji)} from {names.join(", ")}
      {hasMore && " and others"}
    </span>
  )
}
