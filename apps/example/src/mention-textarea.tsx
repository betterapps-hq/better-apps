import { useSuggestMentions, type Subject } from "@better-apps/comments/react"
import { mentionToken } from "@better-apps/mentions"
import { Avatar, AvatarFallback, Textarea } from "@buildkitgg/shadcn-baseui-kit"
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode
} from "react"
import { initials } from "./app-shell"

/** What someone is writing: the text as they see it, with `@Name` for each person they picked from the suggestions. */
export interface Draft {
  text: string
  /** Names by user id, for the people picked. */
  people: Readonly<Record<string, string>>
}

export const emptyDraft: Draft = { text: "", people: {} }

// Names of the people picked from suggestions on this page. A new comment's mentions show before the server names them.
const pickedNames = new Map<string, string>()

/** The name of someone picked from suggestions on this page, if they were. */
export function pickedName(userId: string): string | undefined {
  return pickedNames.get(userId)
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Turns a draft into a comment body: each picked `@Name` becomes a mention token, and a literal `@[` is escaped. */
export function toBody(draft: Draft): string {
  let body = draft.text.trim().replace(/@\[/g, "\\@[")
  // Longest names first, so "@Ada Lovelace" wins over a shorter name it starts with.
  const people = Object.entries(draft.people).sort(([, a], [, b]) => b.length - a.length)
  for (const [userId, name] of people) {
    body = body.replace(new RegExp(`@${escapeRegExp(name)}(?![\\w])`, "g"), mentionToken(userId))
  }
  return body
}

const tokens = /\\@\[|@\[user:([^\]\s]{1,255})\]/g

/** Turns a comment body back into a draft to edit, naming each mention. */
export function toDraft(body: string, nameOf: (userId: string) => string | undefined): Draft {
  const people: Record<string, string> = {}
  const text = body.replace(tokens, (_, userId: string | undefined) => {
    if (userId === undefined) {
      return "@["
    }
    const name = nameOf(userId) ?? "Former user"
    people[userId] = name
    return `@${name}`
  })
  return { text, people }
}

/** A comment body's text, with mentions marked up. */
export function CommentText({ body, nameOf }: { body: string; nameOf: (userId: string) => string | undefined }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of body.matchAll(tokens)) {
    parts.push(body.slice(last, match.index))
    const [token, userId] = match
    parts.push(
      userId === undefined ? (
        "@["
      ) : (
        <span key={match.index} className="mention">
          @{nameOf(userId) ?? "Former user"}
        </span>
      )
    )
    last = match.index + token.length
  }
  parts.push(body.slice(last))
  return <>{parts}</>
}

/** The `@query` being typed just before the caret, if any. */
function queryAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(text.slice(0, caret))
  return match ? { start: caret - match[2]!.length - 1, query: match[2]! } : null
}

interface MentionTextareaProps extends Omit<ComponentProps<"textarea">, "value" | "onChange"> {
  draft: Draft
  onDraftChange(draft: Draft): void
  /** The thread being replied to, or the subject a new thread starts on, which decides who can be mentioned. */
  target: { threadId: string } | Subject
  /** Called on Ctrl+Enter or ⌘+Enter. */
  onSubmitShortcut?(): void
  /** Called on Escape while no suggestions are open, such as to stop editing. */
  onCancel?(): void
}

/**
 * A textarea that suggests people to mention after `@`. Arrow keys move through the suggestions, Enter or Tab picks
 * one, and Escape closes them. A live region reads out the suggestion that Enter would pick.
 */
export function MentionTextarea({
  draft,
  onDraftChange,
  target,
  onSubmitShortcut,
  onCancel,
  onKeyDown,
  ...props
}: MentionTextareaProps) {
  const { search } = useSuggestMentions(target)
  const hintId = useId()
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null)
  const [found, setFound] = useState<{ term: string; people: { id: string; name: string }[] } | null>(null)
  const [active, setActive] = useState(0)
  const latest = useRef(0)
  // Where the caret goes once a picked name is in the text, set as soon as that text renders.
  const pendingCaret = useRef<{ element: HTMLTextAreaElement; at: number } | null>(null)
  useLayoutEffect(() => {
    if (pendingCaret.current) {
      const { element, at } = pendingCaret.current
      element.setSelectionRange(at, at)
      pendingCaret.current = null
    }
  })
  const term = query?.query ?? null
  // Suggestions for an earlier query stay until the new ones arrive, so the list doesn't flicker while typing.
  const suggestions = term === null ? [] : (found?.people ?? [])
  const open = suggestions.length > 0
  const current = suggestions[Math.min(active, suggestions.length - 1)]

  useEffect(() => {
    // Only the newest search's answer shows, so a slow one never replaces a newer one.
    const run = ++latest.current
    if (term === null) {
      return
    }
    void search(term).then((people) => {
      if (run === latest.current) {
        setFound({ term, people: people.map((user) => ({ id: user.id, name: user.name ?? "Unnamed" })) })
        setActive(0)
      }
    })
  }, [term, search])

  function pick(element: HTMLTextAreaElement, person: { id: string; name: string }) {
    if (!query) {
      return
    }
    pickedNames.set(person.id, person.name)
    const inserted = `@${person.name} `
    const text = draft.text.slice(0, query.start) + inserted + draft.text.slice(element.selectionStart)
    onDraftChange({ text, people: { ...draft.people, [person.id]: person.name } })
    setQuery(null)
    pendingCaret.current = { element, at: query.start + inserted.length }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event)
    if (open && current) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setActive((index) => (index + step + suggestions.length) % suggestions.length)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        pick(event.currentTarget, current)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setQuery(null)
        return
      }
    }
    if (event.key === "Escape" && onCancel) {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      onSubmitShortcut?.()
    }
  }

  const describedBy = [props["aria-describedby"], hintId].filter(Boolean).join(" ")

  return (
    <div className="mention-field">
      <Textarea
        {...props}
        aria-describedby={describedBy}
        value={draft.text}
        onChange={(event) => {
          onDraftChange({ ...draft, text: event.target.value })
          setQuery(queryAt(event.target.value, event.target.selectionStart))
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => setQuery(null)}
      />
      <span id={hintId} className="visually-hidden">
        Type @ and a name to mention someone.
      </span>
      <output className="visually-hidden">
        {open && current
          ? `${current.name}, ${suggestions.indexOf(current) + 1} of ${suggestions.length}. Enter picks, arrow keys move.`
          : ""}
      </output>
      {open && (
        <ul className="mention-list" aria-label="People to mention">
          {suggestions.map((person, index) => (
            <li key={person.id}>
              <button
                type="button"
                tabIndex={-1}
                className="mention-option"
                aria-current={person === current ? "true" : undefined}
                // Picking happens before the textarea loses focus, so the suggestions are still there.
                onMouseDown={(event) => {
                  event.preventDefault()
                  const textarea = event.currentTarget.closest(".mention-field")?.querySelector("textarea")
                  if (textarea) {
                    pick(textarea, person)
                  }
                }}
                onMouseEnter={() => setActive(index)}
              >
                <Avatar size="sm">
                  <AvatarFallback>{initials(person.name)}</AvatarFallback>
                </Avatar>
                <span>{person.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
