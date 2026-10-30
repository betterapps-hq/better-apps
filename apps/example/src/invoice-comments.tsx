import { elementAnchorFor } from "@better-apps/anchors/dom"
import { useAnchorPosition } from "@better-apps/anchors/react"
import {
  textFormat,
  useCreateThread,
  useDeleteComment,
  useReopenThread,
  useReply,
  useResolveThread,
  useThread,
  useThreads,
  type Subject
} from "@better-apps/comments/react"
import { useRef, useState, type FormEvent, type RefObject } from "react"
import type { CommentTypes } from "./app-types"
import { formatTime } from "./format"
import { useViewer } from "./viewer"

/** One of the invoice's details, which a thread can be pinned to. */
export interface PinTarget {
  field: string
  label: string
}

type Thread = ReturnType<typeof useThreads<CommentTypes>>["threads"][number]

interface CommentsProps {
  subject: Subject<CommentTypes["subjectType"]>
  /** The element that holds the invoice's details, which pins are placed in. */
  root: RefObject<HTMLElement | null>
  /** Detail labels by field, such as `amount: "Amount"`. */
  labels: Readonly<Record<string, string>>
}

/** The detail a thread is pinned to. Every pin this page makes selects a detail by its `data-field`. */
function pinnedField(thread: Thread): string | null {
  const selector = (thread.anchor as { selector?: unknown } | null)?.selector
  const match = typeof selector === "string" ? /^\[data-field="([\w-]+)"\]$/.exec(selector) : null
  return match?.[1] ?? null
}

/** Pins a thread to a detail's top right corner. */
function anchorOn(field: string, root: HTMLElement) {
  const element = root.querySelector(`[data-field="${field}"]`)
  if (!element) {
    return null
  }
  const box = element.getBoundingClientRect()
  return { kind: "element", value: elementAnchorFor(element, root, { clientX: box.right, clientY: box.top }) }
}

function focusThread(threadId: string) {
  document.getElementById(`thread-${threadId}`)?.focus()
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

interface PanelProps extends CommentsProps {
  /** The detail the next thread is pinned to, or `null` for the whole invoice. */
  target: PinTarget | null
  onTargetChange(target: PinTarget | null): void
  composerRef: RefObject<HTMLTextAreaElement | null>
}

/** The invoice's threads, newest activity first, with a form to start one. */
export function InvoiceComments({ subject, root, labels, target, onTargetChange, composerRef }: PanelProps) {
  const { threads, state, error, hasMore, loadMore, refresh } = useThreads<CommentTypes>(subject)
  const create = useCreateThread()
  const resolve = useResolveThread()
  const reopen = useReopenThread()
  const remove = useDeleteComment()
  const [text, setText] = useState("")
  const [showResolved, setShowResolved] = useState(false)
  const [notice, setNotice] = useState("")
  const showResolvedRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const open = threads.filter((thread) => thread.status === "open")
  const resolved = threads.length - open.length
  const shown = showResolved ? threads : open

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = text.trim()
    if (!body || create.status === "pending") {
      return
    }
    const anchor = target && root.current ? anchorOn(target.field, root.current) : null
    // The thread shows at once. If the server refuses it, it's removed again and the text comes back.
    setText("")
    try {
      await create.mutate({ ...subject, body, anchor })
      onTargetChange(null)
    } catch {
      setText(body)
    }
  }

  async function changeStatus(thread: Thread) {
    const resolving = thread.status === "open"
    setNotice("")
    const changing = (resolving ? resolve : reopen).mutate({ threadId: thread.id })
    if (resolving && !showResolved) {
      // The thread leaves the list at once, taking its focused button, so focus moves to where it can be found again.
      requestAnimationFrame(() => showResolvedRef.current?.focus())
    }
    try {
      await changing
      setNotice(resolving ? "Thread resolved." : "Thread reopened.")
    } catch {
      // The thread is back as it was, and the error shows below.
    }
  }

  async function deleteComment(thread: Thread, commentId: string) {
    const last = thread.commentCount <= 1
    setNotice("")
    const deleting = remove.mutate({ commentId })
    // The button leaves with its comment, and the thread with its last comment, so focus moves to what stays.
    requestAnimationFrame(() => (last ? headingRef.current : document.getElementById(`thread-${thread.id}`))?.focus())
    try {
      await deleting
      setNotice(last ? "Comment and its thread deleted." : "Comment deleted.")
    } catch {
      // The comment is back, and the error shows below.
    }
  }

  const actionError = resolve.error ?? reopen.error ?? remove.error

  return (
    <section className="comments" aria-labelledby="comments-title">
      <output className="visually-hidden">{notice}</output>
      <div className="comments-head">
        <h2 id="comments-title" ref={headingRef} tabIndex={-1}>
          Comments
        </h2>
        <p className="meta">{plural(open.length, "open thread", "open threads")}</p>
      </div>
      <form className="composer" onSubmit={handleSubmit}>
        <label htmlFor="new-comment">{target ? `Comment on ${target.label}` : "New comment"}</label>
        {target && (
          <p className="pin-target">
            <span>Pinned to {target.label}</span>
            <button
              type="button"
              className="text-button"
              onClick={() => onTargetChange(null)}
              aria-label={`Don’t pin to ${target.label}`}
            >
              Unpin
            </button>
          </p>
        )}
        <textarea
          id="new-comment"
          ref={composerRef}
          rows={3}
          maxLength={10_000}
          required
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-invalid={create.error ? true : undefined}
          aria-describedby={create.error ? "new-comment-error" : undefined}
        />
        {create.error && (
          <p id="new-comment-error" className="form-error" role="alert">
            {create.error.message}
          </p>
        )}
        <button type="submit" aria-disabled={create.status === "pending"}>
          Comment
        </button>
      </form>
      {resolved > 0 && (
        <label className="checkbox" htmlFor="show-resolved">
          <input
            id="show-resolved"
            ref={showResolvedRef}
            type="checkbox"
            checked={showResolved}
            onChange={(event) => setShowResolved(event.target.checked)}
          />
          Show resolved ({resolved})
        </label>
      )}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError.message}
        </p>
      )}
      {state === "error" && (
        <div className="form-error" role="alert">
          <p>{error?.message ?? "Comments couldn’t load."}</p>
          <button type="button" onClick={() => void refresh().catch(() => undefined)}>
            Try again
          </button>
        </div>
      )}
      {state === "loading" && threads.length === 0 && <p className="meta">Loading comments</p>}
      {state === "ready" && shown.length === 0 && (
        <p className="meta">
          {threads.length === 0
            ? "No comments yet. Start a thread, or comment on one of the details."
            : "No open threads."}
        </p>
      )}
      <ol className="threads">
        {shown.map((thread) => (
          <li key={thread.id}>
            <ThreadCard
              thread={thread}
              root={root}
              labels={labels}
              onStatusChange={changeStatus}
              onDelete={deleteComment}
            />
          </li>
        ))}
      </ol>
      {hasMore && (
        <button type="button" className="secondary" onClick={() => void loadMore().catch(() => undefined)}>
          Show more threads
        </button>
      )}
    </section>
  )
}

interface ThreadCardProps extends Omit<CommentsProps, "subject"> {
  thread: Thread
  /** Resolves an open thread or reopens a resolved one. */
  onStatusChange(thread: Thread): Promise<void>
  /** Deletes one of the viewer's comments. */
  onDelete(thread: Thread, commentId: string): Promise<void>
}

/** A thread with its comments, a reply form, and a button to resolve or reopen it. */
function ThreadCard({ thread, root, labels, onStatusChange, onDelete }: ThreadCardProps) {
  const viewer = useViewer()
  const { comments, users, state, isPending } = useThread<CommentTypes>(thread.id)
  const reply = useReply()
  const position = useAnchorPosition(thread, root)
  const [text, setText] = useState("")
  const field = pinnedField(thread)
  const place = field ? (labels[field] ?? "a detail") : "the invoice"
  const titleId = `thread-${thread.id}-title`
  const replyId = `thread-${thread.id}-reply`

  async function handleReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = text.trim()
    if (!body || reply.status === "pending") {
      return
    }
    setText("")
    try {
      await reply.mutate({ threadId: thread.id, body })
    } catch {
      setText(body)
    }
  }

  // Writes don't return their author's name, so the viewer's own comments use the viewer's.
  const authorName = (comment: (typeof comments)[number]) => {
    if (isPending(comment.id) || (comment.authorType === "user" && comment.authorId === viewer?.id)) {
      return viewer?.name ?? "You"
    }
    if (comment.authorType !== "user") {
      return comment.authorName ?? "Unknown author"
    }
    return users[comment.authorId]?.name ?? "Former user"
  }

  return (
    <article
      id={`thread-${thread.id}`}
      className={`thread thread-${thread.status}`}
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <div className="thread-head">
        <h3 id={titleId}>On {place}</h3>
        {thread.status === "resolved" && <span className="chip">Resolved</span>}
      </div>
      {position?.status === "detached" && <p className="meta">This detail is no longer on the page.</p>}
      {state === "loading" && comments.length === 0 && <p className="meta">Loading comments</p>}
      <ol className="thread-comments">
        {comments.map((comment) => {
          const own = comment.authorType === "user" && viewer !== null && comment.authorId === viewer.id
          return (
            <li key={comment.id}>
              <p className="meta">
                <span className="author">{authorName(comment)}</span>
                <time dateTime={comment.createdAt.toISOString()}>{formatTime(comment.createdAt)}</time>
                {isPending(comment.id) && <span>Sending</span>}
              </p>
              {comment.deletedAt || comment.body === null ? (
                <p className="comment-body deleted">This comment was deleted.</p>
              ) : (
                <p className="comment-body">
                  {textFormat.toText(comment.body as string, (userId) => users[userId]?.name ?? undefined)}
                </p>
              )}
              {own && !comment.deletedAt && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void onDelete(thread, comment.id)}
                  aria-label={`Delete your comment from ${formatTime(comment.createdAt)}`}
                >
                  Delete
                </button>
              )}
            </li>
          )
        })}
      </ol>
      {reply.error && (
        <p className="form-error" role="alert">
          {reply.error.message}
        </p>
      )}
      <form className="reply" onSubmit={handleReply}>
        <label htmlFor={replyId} className="visually-hidden">
          Reply to the thread on {place}
        </label>
        <textarea
          id={replyId}
          rows={2}
          maxLength={10_000}
          required
          placeholder="Reply"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="thread-actions">
          <button type="submit" aria-disabled={reply.status === "pending"}>
            Reply
          </button>
          <button type="button" className="secondary" onClick={() => void onStatusChange(thread)}>
            {thread.status === "open" ? "Resolve" : "Reopen"}
          </button>
        </div>
      </form>
    </article>
  )
}

/** Numbered pins on the details that have open threads. Each moves focus to the first of its threads. */
export function AnchorPins({ subject, root, labels }: CommentsProps) {
  const { threads } = useThreads<CommentTypes>(subject)
  const byField = new Map<string, Thread[]>()
  for (const thread of threads) {
    const field = thread.status === "open" ? pinnedField(thread) : null
    if (field) {
      byField.set(field, [...(byField.get(field) ?? []), thread])
    }
  }
  return (
    <>
      {[...byField].map(([field, pinned]) => (
        <Pin key={field} threads={pinned} root={root} label={labels[field] ?? "a detail"} />
      ))}
    </>
  )
}

interface PinProps {
  threads: Thread[]
  root: RefObject<HTMLElement | null>
  label: string
}

function Pin({ threads, root, label }: PinProps) {
  const [first] = threads as [Thread]
  // Measured in the browser after layout, so the server render has no pins.
  const position = useAnchorPosition(first, root)
  if (!position || position.status === "detached") {
    return null
  }
  return (
    <button
      type="button"
      className="pin"
      style={{ left: position.x, top: position.y }}
      onClick={() => focusThread(first.id)}
      aria-label={`${plural(threads.length, "open thread", "open threads")} on ${label}`}
    >
      {threads.length}
    </button>
  )
}
