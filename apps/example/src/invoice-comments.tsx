import { elementAnchorFor } from "@better-apps/anchors/dom"
import { useAnchorPosition } from "@better-apps/anchors/react"
import {
  useCreateThread,
  useDeleteComment,
  useDeleteThread,
  useEditComment,
  useReopenThread,
  useReply,
  useResolveThread,
  useThread,
  useThreads,
  useUpdateAnchor,
  type Subject
} from "@better-apps/comments/react"
import { AlertRegion } from "@buildkitgg/shadcn-alerts-manager"
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Spinner,
  toast,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@buildkitgg/shadcn-baseui-kit"
import {
  CheckIcon,
  EllipsisIcon,
  MapPinIcon,
  MessageSquarePlusIcon,
  MessagesSquareIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon
} from "lucide-react"
import { createContext, use, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react"
import { initials, SignInPrompt } from "./app-shell"
import type { CommentTypes } from "./app-types"
import { CommentReactions, RemoveReactionsMenu } from "./comment-reactions"
import { formatTime, plural } from "./format"
import { CommentText, emptyDraft, MentionTextarea, pickedName, toBody, toDraft, type Draft } from "./mention-textarea"
import { alerts, modals } from "./ui"
import { useViewer } from "./viewer"

/** One of the invoice's details, which a thread can be pinned to. */
export interface Detail {
  field: string
  label: string
}

type Thread = ReturnType<typeof useThreads<CommentTypes>>["threads"][number]

/** The detail a thread is pinned to. Every pin this page makes selects a detail by its `data-field`. */
function pinnedField(thread: Thread): string | null {
  const selector = (thread.anchor as { selector?: unknown } | null)?.selector
  const match = typeof selector === "string" ? /^\[data-field="([\w-]+)"\]$/.exec(selector) : null
  return match?.[1] ?? null
}

/** An anchor on a detail's top right corner, or `null` when the detail isn't on the page. */
function anchorOn(field: string, root: HTMLElement) {
  const element = root.querySelector(`[data-field="${field}"]`)
  if (!element) {
    return null
  }
  const box = element.getBoundingClientRect()
  return { kind: "element", value: elementAnchorFor(element, root, { clientX: box.right, clientY: box.top }) }
}

/** The id of the textarea that starts a thread. */
const composerId = "new-comment"

/** Where alerts about comments show, above the threads. */
const alertRegion = "comments"

/** Shows why a write failed until it's dismissed or the next write succeeds. */
function reportError(title: string, error: unknown) {
  alerts.error(
    { id: "comment-write", title, body: error instanceof Error ? error.message : "Try again in a moment." },
    alertRegion
  )
}

function done(title: string) {
  alerts.dismiss("comment-write", alertRegion)
  toast.add({ title, timeout: 4000 })
}

type Filter = "open" | "resolved"

interface InvoiceComments {
  subject: Subject<CommentTypes["subjectType"]>
  /** The element that holds the invoice's details, which pins are placed in. */
  root: RefObject<HTMLElement | null>
  details: readonly Detail[]
  labelOf(field: string | null): string
  /** The detail the next thread is pinned to, or `null` for the whole invoice. */
  target: Detail | null
  setTarget(target: Detail | null): void
  /** Starts a thread on a detail: pins the composer to it and moves focus there. */
  commentOn(detail: Detail): void
  filter: Filter
  setFilter(filter: Filter): void
  /** The detail and thread to point out, such as while one of them is hovered. */
  highlight: { field: string | null; threadId: string | null }
  setHighlight(highlight: { field: string | null; threadId: string | null }): void
  /** Shows a thread in the panel and moves focus to it. */
  showThread(thread: Thread): void
}

const Context = createContext<InvoiceComments | null>(null)

function useInvoiceComments() {
  const context = use(Context)
  if (!context) {
    throw new Error("Invoice comments need an InvoiceCommentsProvider.")
  }
  return context
}

interface ProviderProps {
  subject: Subject<CommentTypes["subjectType"]>
  root: RefObject<HTMLElement | null>
  details: readonly Detail[]
  children: ReactNode
}

/** What the invoice sheet and the comments panel share: the composer's target and what's pointed out. */
export function InvoiceCommentsProvider({ subject, root, details, children }: ProviderProps) {
  const [target, setTarget] = useState<Detail | null>(null)
  const [filter, setFilter] = useState<Filter>("open")
  const [highlight, setHighlight] = useState<InvoiceComments["highlight"]>({ field: null, threadId: null })
  const labels = new Map(details.map((detail) => [detail.field, detail.label]))

  // Points out the highlighted detail on the sheet, which the page renders without knowing about comments.
  useEffect(() => {
    const element = highlight.field ? root.current?.querySelector(`[data-field="${highlight.field}"]`) : null
    element?.setAttribute("data-highlighted", "")
    return () => element?.removeAttribute("data-highlighted")
  }, [highlight.field, root])

  const value: InvoiceComments = {
    subject,
    root,
    details,
    labelOf: (field) => (field ? (labels.get(field) ?? "a detail") : "the invoice"),
    target,
    setTarget,
    commentOn(detail) {
      setTarget(detail)
      document.getElementById(composerId)?.focus()
    },
    filter,
    setFilter,
    highlight,
    setHighlight,
    showThread(thread) {
      setFilter(thread.status)
      setHighlight({ field: pinnedField(thread), threadId: thread.id })
      requestAnimationFrame(() => {
        const element = document.getElementById(`thread-${thread.id}`)
        element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
        element?.focus({ preventScroll: true })
      })
    }
  }
  return <Context value={value}>{children}</Context>
}

/** A button on a detail that starts a thread pinned to it. It shows while the detail is hovered or focused. */
export function CommentHere({ field, label }: Detail) {
  const { commentOn } = useInvoiceComments()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="secondary"
            size="icon-xs"
            className="comment-here"
            aria-label={`Comment on ${label}`}
            onClick={() => commentOn({ field, label })}
          />
        }
      >
        <MessageSquarePlusIcon />
      </TooltipTrigger>
      <TooltipContent>Comment on {label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The invoice's threads, newest activity first, with a form to start one. Someone signed out sees them only through a
 * share link, so for them it's read-only.
 */
export function CommentsPanel() {
  const readOnly = useViewer() === null
  const context = useInvoiceComments()
  const { subject, filter, setFilter } = context
  const { threads, state, error, hasMore, loadMore, refresh } = useThreads<CommentTypes>(subject)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const open = threads.filter((thread) => thread.status === "open")
  const resolved = threads.filter((thread) => thread.status === "resolved")
  const shown = filter === "open" ? open : resolved

  return (
    <section className="comments-panel" aria-labelledby="comments-title">
      <div className="comments-panel-head">
        <h2 id="comments-title" ref={headingRef} tabIndex={-1}>
          Comments
        </h2>
        <ToggleGroup
          aria-label="Show threads"
          variant="outline"
          size="sm"
          spacing={0}
          value={[filter]}
          onValueChange={(value: string[]) => {
            const [picked] = value
            if (picked) {
              setFilter(picked as Filter)
            }
          }}
        >
          <ToggleGroupItem value="open">Open {open.length}</ToggleGroupItem>
          <ToggleGroupItem value="resolved">Resolved {resolved.length}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {readOnly ? <SignInPrompt>to comment on this invoice.</SignInPrompt> : <Composer />}
      <AlertRegion manager={alerts} region={alertRegion} label="Comment alerts" />
      {state === "error" && (
        <Empty role="alert">
          <EmptyHeader>
            <EmptyTitle>Comments couldn’t load</EmptyTitle>
            <EmptyDescription>{error?.message ?? "Try again in a moment."}</EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" onClick={() => void refresh().catch(() => undefined)}>
            Try again
          </Button>
        </Empty>
      )}
      {state === "loading" && threads.length === 0 && (
        <p className="muted">
          <Spinner /> Loading comments
        </p>
      )}
      {state === "ready" && shown.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessagesSquareIcon />
            </EmptyMedia>
            <EmptyTitle>{filter === "open" ? "No open threads" : "No resolved threads"}</EmptyTitle>
            {!readOnly && (
              <EmptyDescription>
                {filter === "open"
                  ? "Start a thread above, or hover a detail on the invoice to comment on it."
                  : "Threads you resolve move here."}
              </EmptyDescription>
            )}
          </EmptyHeader>
        </Empty>
      )}
      <ol className="threads" aria-label={filter === "open" ? "Open threads" : "Resolved threads"}>
        {shown.map((thread) => (
          <li key={thread.id}>
            <ThreadCard thread={thread} onGone={() => headingRef.current?.focus()} />
          </li>
        ))}
      </ol>
      {hasMore && (
        <Button variant="outline" onClick={() => void loadMore().catch(() => undefined)}>
          Show more threads
        </Button>
      )}
    </section>
  )
}

/** Starts a thread on the whole invoice, or on the detail picked on the sheet. */
function Composer() {
  const { subject, root, target, setTarget } = useInvoiceComments()
  const create = useCreateThread()
  const [draft, setDraft] = useState<Draft>(emptyDraft)

  async function submit() {
    const body = toBody(draft)
    if (!body || create.status === "pending") {
      return
    }
    const anchor = target && root.current ? anchorOn(target.field, root.current) : null
    // The thread shows at once. If the server refuses it, it's removed again and the text comes back.
    const sent = draft
    setDraft(emptyDraft)
    try {
      await create.mutate({ ...subject, body, anchor })
      setTarget(null)
    } catch {
      setDraft(sent)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit()
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <label htmlFor={composerId} className="visually-hidden">
        {target ? `Comment on ${target.label}` : "Comment on the invoice"}
      </label>
      {target && (
        <p className="composer-target">
          <span>
            <MapPinIcon size={14} aria-hidden="true" style={{ display: "inline", verticalAlign: "-2px" }} /> Pinned to{" "}
            {target.label}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setTarget(null)}
            aria-label={`Don’t pin to ${target.label}`}
          >
            <XIcon />
          </Button>
        </p>
      )}
      <MentionTextarea
        id={composerId}
        target={subject}
        rows={3}
        maxLength={10_000}
        required
        placeholder={target ? `Comment on ${target.label}` : "Comment on this invoice. Type @ to mention someone."}
        draft={draft}
        onDraftChange={setDraft}
        onSubmitShortcut={() => void submit()}
        aria-invalid={create.error ? true : undefined}
        aria-describedby={create.error ? "new-comment-error" : "new-comment-hint"}
      />
      {create.error && (
        <p id="new-comment-error" className="form-error" role="alert">
          {create.error.message}
        </p>
      )}
      <div className="composer-actions">
        <span id="new-comment-hint" className="composer-hint">
          Ctrl+Enter to send
        </span>
        <Button type="submit" size="sm" aria-disabled={create.status === "pending"}>
          Comment
        </Button>
      </div>
    </form>
  )
}

interface ThreadCardProps {
  thread: Thread
  /** Moves focus somewhere that stays, once this thread leaves the list. */
  onGone(): void
}

/** A thread with its comments, a reply form, and what can be done with it. Signed out, it only shows the comments. */
function ThreadCard({ thread, onGone }: ThreadCardProps) {
  const viewer = useViewer()
  const { root, details, labelOf, highlight, setHighlight } = useInvoiceComments()
  const { comments, users, state, isPending } = useThread<CommentTypes>(thread.id)
  const reply = useReply()
  const resolve = useResolveThread()
  const reopen = useReopenThread()
  const remove = useDeleteComment()
  const removeThread = useDeleteThread()
  const move = useUpdateAnchor()
  const position = useAnchorPosition(thread, root)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const field = pinnedField(thread)
  const place = labelOf(field)
  const titleId = `thread-${thread.id}-title`
  const replyId = `thread-${thread.id}-reply`
  const canMove = viewer !== null && (viewer.isOwner || thread.createdBy === viewer.id)
  const nameOf = (userId: string) =>
    (userId === viewer?.id ? viewer.name : users[userId]?.name) ?? pickedName(userId) ?? undefined

  async function submitReply() {
    const body = toBody(draft)
    if (!body || reply.status === "pending") {
      return
    }
    const sent = draft
    setDraft(emptyDraft)
    try {
      await reply.mutate({ threadId: thread.id, body })
    } catch {
      setDraft(sent)
    }
  }

  async function changeStatus() {
    const resolving = thread.status === "open"
    // The thread leaves this list at once, taking its focused button, so focus moves to what stays.
    const changing = (resolving ? resolve : reopen).mutate({ threadId: thread.id })
    requestAnimationFrame(onGone)
    try {
      await changing
      done(resolving ? `Thread on ${place} resolved` : `Thread on ${place} reopened`)
    } catch (error) {
      reportError(resolving ? "The thread couldn’t be resolved" : "The thread couldn’t be reopened", error)
    }
  }

  async function moveTo(to: Detail | null) {
    const anchor = to && root.current ? anchorOn(to.field, root.current) : null
    if (to && !anchor) {
      return
    }
    try {
      await move.mutate({ threadId: thread.id, anchor })
      done(to ? `Pin moved to ${to.label}` : "Thread moved to the whole invoice")
      setHighlight({ field: to?.field ?? null, threadId: thread.id })
    } catch (error) {
      reportError("The pin couldn’t be moved", error)
    }
  }

  async function deleteThread() {
    const confirmed = await modals.confirm({
      title: "Delete this thread?",
      description: `${plural(thread.commentCount, "comment", "comments")} on ${place} will be deleted for everyone. This can’t be undone.`,
      confirmLabel: "Delete thread"
    })
    if (!confirmed) {
      return
    }
    const deleting = removeThread.mutate({ threadId: thread.id })
    requestAnimationFrame(onGone)
    try {
      await deleting
      done("Thread deleted")
    } catch (error) {
      reportError("The thread couldn’t be deleted", error)
    }
  }

  async function deleteComment(commentId: string) {
    const last = thread.commentCount <= 1
    const confirmed = await modals.confirm({
      title: last ? "Delete this comment and its thread?" : "Delete this comment?",
      description: last
        ? "It’s the thread’s only comment, so the thread goes too. This can’t be undone."
        : "Its text is removed for everyone. This can’t be undone.",
      confirmLabel: "Delete"
    })
    if (!confirmed) {
      return
    }
    const deleting = remove.mutate({ commentId })
    // The comment's menu leaves with its text, and the thread with its last comment, so focus moves to what stays.
    requestAnimationFrame(() => (last ? onGone() : document.getElementById(`thread-${thread.id}`)?.focus()))
    try {
      await deleting
      done(last ? "Comment and its thread deleted" : "Comment deleted")
    } catch (error) {
      reportError("The comment couldn’t be deleted", error)
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
    // A visitor with a share link gets the author's name on the comment, without their user id.
    return users[comment.authorId]?.name ?? comment.authorName ?? "Former user"
  }

  // Points out the thread's detail on the invoice while the thread is hovered or has focus.
  const card = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = card.current
    if (!element) {
      return
    }
    const point = () => setHighlight({ field, threadId: thread.id })
    const unpoint = (event: Event) => {
      const next = (event as FocusEvent).relatedTarget as Node | null
      if (event.type === "pointerleave" || !element.contains(next)) {
        setHighlight({ field: null, threadId: null })
      }
    }
    const listeners = [
      ["pointerenter", point],
      ["focusin", point],
      ["pointerleave", unpoint],
      ["focusout", unpoint]
    ] as const
    for (const [type, listener] of listeners) {
      element.addEventListener(type, listener)
    }
    return () => {
      for (const [type, listener] of listeners) {
        element.removeEventListener(type, listener)
      }
    }
  }, [field, thread.id, setHighlight])

  return (
    <article
      ref={card}
      id={`thread-${thread.id}`}
      className={`thread thread-${thread.status}`}
      aria-labelledby={titleId}
      tabIndex={-1}
      data-highlighted={highlight.threadId === thread.id ? "" : undefined}
    >
      <div className="thread-head">
        {field && <MapPinIcon size={14} aria-hidden="true" style={{ color: "var(--pin)" }} />}
        <h3 id={titleId}>On {place}</h3>
        {thread.status === "resolved" && <Badge variant="secondary">Resolved</Badge>}
        {viewer && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={
                    thread.status === "open" ? `Resolve the thread on ${place}` : `Reopen the thread on ${place}`
                  }
                  onClick={() => void changeStatus()}
                />
              }
            >
              {thread.status === "open" ? <CheckIcon /> : <RotateCcwIcon />}
            </TooltipTrigger>
            <TooltipContent>{thread.status === "open" ? "Resolve" : "Reopen"}</TooltipContent>
          </Tooltip>
        )}
        {(canMove || viewer?.isOwner) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-xs" aria-label={`More for the thread on ${place}`} />}
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canMove && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <MapPinIcon />
                    Move pin
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={field ?? ""}
                      onValueChange={(value: string) =>
                        void moveTo(details.find((detail) => detail.field === value) ?? null)
                      }
                    >
                      <DropdownMenuRadioItem value="" closeOnClick>
                        The whole invoice
                      </DropdownMenuRadioItem>
                      {details.map((detail) => (
                        <DropdownMenuRadioItem key={detail.field} value={detail.field} closeOnClick>
                          {detail.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {viewer?.isOwner && (
                <>
                  {canMove && <DropdownMenuSeparator />}
                  <DropdownMenuItem variant="destructive" onClick={() => void deleteThread()}>
                    <Trash2Icon />
                    Delete thread
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {position?.status === "detached" && <p className="muted">This detail is no longer on the invoice.</p>}
      {state === "loading" && comments.length === 0 && <p className="muted">Loading comments</p>}
      <ol className="thread-comments">
        {comments.map((comment) => (
          <li key={comment.id}>
            <CommentItem
              comment={comment}
              author={authorName(comment)}
              pending={isPending(comment.id)}
              own={comment.authorType === "user" && viewer !== null && comment.authorId === viewer.id}
              threadId={thread.id}
              nameOf={nameOf}
              onDelete={() => void deleteComment(comment.id)}
            />
          </li>
        ))}
      </ol>
      {reply.error && (
        <p className="form-error" role="alert">
          {reply.error.message}
        </p>
      )}
      {viewer && (
        <form
          className="reply"
          onSubmit={(event) => {
            event.preventDefault()
            void submitReply()
          }}
        >
          <label htmlFor={replyId} className="visually-hidden">
            Reply to the thread on {place}
          </label>
          <MentionTextarea
            id={replyId}
            target={{ threadId: thread.id }}
            rows={1}
            maxLength={10_000}
            required
            placeholder={thread.status === "resolved" ? "Reply to reopen" : "Reply"}
            draft={draft}
            onDraftChange={setDraft}
            onSubmitShortcut={() => void submitReply()}
          />
          {draft.text.trim() !== "" && (
            <div className="reply-actions">
              <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(emptyDraft)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" aria-disabled={reply.status === "pending"}>
                Reply
              </Button>
            </div>
          )}
        </form>
      )}
    </article>
  )
}

type CommentRecord = ReturnType<typeof useThread<CommentTypes>>["comments"][number]

interface CommentItemProps {
  comment: CommentRecord
  author: string
  pending: boolean
  own: boolean
  threadId: string
  nameOf(userId: string): string | undefined
  onDelete(): void
}

/** One comment, which its author can edit or delete, and anyone can react to. */
function CommentItem({ comment, author, pending, own, threadId, nameOf, onDelete }: CommentItemProps) {
  const viewer = useViewer()
  const edit = useEditComment()
  const [editing, setEditing] = useState<Draft | null>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  // A visitor with a share link gets each comment as text, with no body to edit.
  const deleted = comment.deletedAt !== null || (comment.body === null && !comment.bodyText)
  const canDelete = !deleted && !pending && (own || viewer?.isOwner === true)
  const editId = `comment-${comment.id}-edit`
  const when = formatTime(comment.createdAt)

  function cancelEdit() {
    setEditing(null)
    requestAnimationFrame(() => menuRef.current?.focus())
  }

  async function save() {
    if (!editing) {
      return
    }
    const body = toBody(editing)
    if (!body) {
      return
    }
    const previous = editing
    setEditing(null)
    requestAnimationFrame(() => menuRef.current?.focus())
    try {
      await edit.mutate({ commentId: comment.id, body })
    } catch (error) {
      setEditing(previous)
      reportError("The comment couldn’t be saved", error)
    }
  }

  return (
    <div className="comment">
      <Avatar size="sm">
        <AvatarFallback>{initials(author)}</AvatarFallback>
      </Avatar>
      <p className="comment-meta">
        <span className="author">{author}</span>
        <time dateTime={comment.createdAt.toISOString()}>{when}</time>
        {comment.editedAt && !deleted && <span>Edited</span>}
        {pending && <span>Sending</span>}
        {(own || canDelete) && !deleted && !pending && (
          <span className="comment-menu">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    ref={menuRef}
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`More for ${own ? "your" : `${author}’s`} comment from ${when}`}
                  />
                }
              >
                <EllipsisIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" style={{ width: "auto" }}>
                {own && (
                  <DropdownMenuItem
                    onClick={() => {
                      setEditing(toDraft(comment.body as string, nameOf))
                      requestAnimationFrame(() => document.getElementById(editId)?.focus())
                    }}
                  >
                    <PencilIcon />
                    Edit
                  </DropdownMenuItem>
                )}
                {viewer?.isOwner && (
                  <RemoveReactionsMenu commentId={comment.id} onRemoved={done} onError={reportError} />
                )}
                {canDelete && (
                  <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )}
      </p>
      {deleted && <p className="comment-body deleted">This comment was deleted.</p>}
      {!deleted && editing && (
        <form
          className="reply"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <label htmlFor={editId} className="visually-hidden">
            Edit your comment
          </label>
          <MentionTextarea
            id={editId}
            target={{ threadId }}
            rows={2}
            maxLength={10_000}
            required
            draft={editing}
            onDraftChange={setEditing}
            onSubmitShortcut={() => void save()}
            onCancel={cancelEdit}
          />
          <div className="reply-actions">
            <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
              Cancel
            </Button>
            <Button type="submit" size="sm" aria-disabled={edit.status === "pending"}>
              Save
            </Button>
          </div>
        </form>
      )}
      {!deleted && !editing && (
        <p className="comment-body">
          {comment.body === null ? comment.bodyText : <CommentText body={comment.body as string} nameOf={nameOf} />}
        </p>
      )}
      {!deleted && !pending && !editing && <CommentReactions commentId={comment.id} readOnly={viewer === null} />}
    </div>
  )
}

/** Pins on the details that have open threads, each with how many. Each shows its first thread in the panel. */
export function AnchorPins() {
  const { subject } = useInvoiceComments()
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
        <Pin key={field} field={field} threads={pinned} />
      ))}
    </>
  )
}

function Pin({ field, threads }: { field: string; threads: Thread[] }) {
  const { root, labelOf, highlight, setHighlight, showThread } = useInvoiceComments()
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
      data-highlighted={highlight.field === field ? "" : undefined}
      onClick={() => showThread(first)}
      onMouseEnter={() => setHighlight({ field, threadId: first.id })}
      onMouseLeave={() => setHighlight({ field: null, threadId: null })}
      aria-label={`${plural(threads.length, "open thread", "open threads")} on ${labelOf(field)}`}
    >
      {threads.length}
    </button>
  )
}
