import {
  useAttachments,
  useAttachmentsClient,
  useAttachmentSettings,
  type AttachedFile,
  type AttachmentSettings
} from "@better-apps/attachments/react"
import { isUnderWay, type FileInfo } from "@better-apps/uploadcn"
import { useAttachmentsUploader, useDraftUploader } from "@better-apps/uploadcn/react"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Progress,
  Spinner
} from "@buildkitgg/shadcn-baseui-kit"
import type { UploadItem, UploaderState, UploadStatus } from "@uploadcn/core"
import { Upload, useUploadContext, useUploadItem, useUploadSelector, type UploadMessages } from "@uploadcn/react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  EllipsisIcon,
  FileIcon,
  FileTextIcon,
  PaperclipIcon,
  RotateCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
  type RefObject
} from "react"
import type { AttachmentTypes } from "./app-types"
import { formatSize } from "./format"
import { modals } from "./ui"
import { useViewer } from "./viewer"

/** Comments name their subject type in `commentSubjectTypes`, on the server. */
const commentType = "comments.comment"

/** Types the browser shows as a thumbnail. */
const thumbnailTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"])

/** What kind of file it is, in a word. */
function kindOf(contentType: string) {
  if (contentType === "application/pdf") {
    return "PDF"
  }
  if (contentType === "text/csv") {
    return "CSV"
  }
  if (contentType.startsWith("image/")) {
    return "Image"
  }
  return contentType.startsWith("text/") ? "Text" : "File"
}

/** The kinds a picker takes, in words, such as "PDFs and images". */
const kindNames: Record<string, string> = {
  "application/pdf": "PDFs",
  "image/*": "images",
  "text/plain": "text files",
  "text/csv": "CSV files"
}

/** What a subject type takes, for the hint under its picker, such as "PDFs and images up to 10 MB each". */
function limitsOf(settings: AttachmentSettings | null) {
  if (!settings) {
    return ""
  }
  // British English lists without a comma before "and", as the app's copy does.
  const list = new Intl.ListFormat("en-GB")
  const kinds = settings.contentTypes
    ? list.format(settings.contentTypes.map((type) => kindNames[type] ?? type))
    : "Any file"
  const sentence = `${kinds.charAt(0).toUpperCase()}${kinds.slice(1)} up to ${formatSize(settings.maxSize)} each`
  return settings.maxFiles === null ? `${sentence}.` : `${sentence}, ${settings.maxFiles} at most.`
}

/** A file's download address, asking for a download rather than a page. */
function downloadUrl(url: string) {
  const address = new URL(url, window.location.href)
  address.searchParams.set("download", "1")
  return address.href
}

/** A polite live region's text, and a function that says something in it. The same words twice are said twice. */
function useAnnouncer() {
  const [message, setMessage] = useState("")
  const announce = useCallback((text: string) => {
    // Emptied first, so screen readers notice the same words said again.
    setMessage("")
    setTimeout(() => setMessage(text), 50)
  }, [])
  return [message, announce] as const
}

/** Ends a message with a full stop, as UploadCN's own messages don't. */
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

/**
 * What UploadCN says about uploads, in the app's voice. Its own checks, such as a file that's too large, keep UploadCN's
 * wording, and the server's refusals keep attachments'.
 */
const uploadMessages: Partial<UploadMessages> = {
  added: (count) => (count === 1 ? "Uploading 1 file" : `Uploading ${count} files`),
  uploaded: (name) => `${name} uploaded`,
  failed: (name, reason) => `${name} couldn’t upload. ${sentence(reason)}`,
  rejected: (name, reason) => `${name} couldn’t upload. ${sentence(reason)}`,
  cancelled: (name) => `Stopped uploading ${name}`,
  remove: (name) => `Remove ${name}`,
  cancel: (name) => `Stop uploading ${name}`,
  retry: (name) => `Try uploading ${name} again`,
  progress: (name) => `Uploading ${name}`
}

/**
 * What every upload root here takes. A root says it's busy while files upload, and screen readers may hold back what a
 * live region inside a busy element says, so these never do. Each upload in a list says it's busy itself. A root with
 * one place left would take a single file and replace what's queued, so these always take several, and UploadCN
 * refuses those past the limit.
 */
const rootProps = { messages: uploadMessages, "aria-busy": false, multiple: true } as const

/** Uploads that take one of a record's places: all but those refused or stopped. */
const placesTaken = (state: UploaderState<FileInfo>) =>
  state.items.filter((item) => item.status !== "rejected" && item.status !== "cancelled").length

const cardStates = {
  idle: "idle",
  validating: "processing",
  queued: "uploading",
  uploading: "uploading",
  paused: "idle",
  processing: "processing",
  scanning: "processing",
  success: "done",
  error: "error",
  rejected: "error",
  cancelled: "idle"
} as const satisfies Record<UploadStatus, string>

/** Whether all of an upload's bytes went, so the server is checking them. */
const checking = (item: UploadItem) => item.status === "uploading" && item.progress.loaded >= item.size

/** Where an upload stands, in words. */
function progressOf(item: UploadItem) {
  switch (item.status) {
    case "error":
    case "rejected":
      return "Couldn’t upload"
    case "success":
      return `${kindOf(item.type)}, ${formatSize(item.size)}`
    case "cancelled":
      return "Stopped"
    case "paused":
      return "Waiting for a connection"
    case "queued":
      return item.retryAt === null ? "Waiting to upload" : "Trying again soon"
    case "uploading":
      return checking(item) ? "Checking the file" : `${formatSize(item.progress.loaded)} of ${formatSize(item.size)}`
    default:
      return "Checking the file"
  }
}

/** An upload's icon: a warning when it failed, its kind once it stopped, and a spinner while it's under way. */
function UploadIcon({ item }: { item: UploadItem }) {
  if (item.status === "error" || item.status === "rejected") {
    return <TriangleAlertIcon />
  }
  if (!isUnderWay(item)) {
    return item.type.startsWith("image/") ? <FileIcon /> : <FileTextIcon />
  }
  return <Spinner />
}

const removeIdOf = (itemId: string) => `upload-${itemId}-remove`

interface UploadRowProps {
  /** What the remove button says it does, such as "Stop uploading notes.txt". */
  removeLabel(item: UploadItem): string
  onRemove(item: UploadItem): void
}

/** An upload in a list: its progress or why it failed, and buttons to try it again or let it go. */
function UploadRow({ removeLabel, onRemove }: UploadRowProps) {
  const item = useUploadItem<FileInfo>()
  return (
    <>
      <Attachment size="sm" className="file-card" state={cardStates[item.status]}>
        <AttachmentMedia>
          <UploadIcon item={item} />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>
            <Upload.Name />
          </AttachmentTitle>
          <AttachmentDescription>{progressOf(item)}</AttachmentDescription>
          {item.status === "uploading" && !checking(item) && (
            <Upload.Progress
              render={(props, { percent }) => (
                <Progress value={percent} aria-label={props["aria-label"] as string} className="upload-progress" />
              )}
            />
          )}
        </AttachmentContent>
        <AttachmentActions>
          <Upload.Retry
            render={<AttachmentAction />}
            // The button goes once the upload starts again, so focus moves first to the one that stays.
            onClick={() => document.getElementById(removeIdOf(item.id))?.focus()}
          >
            <RotateCwIcon />
          </Upload.Retry>
          <Upload.Remove
            render={<AttachmentAction id={removeIdOf(item.id)} />}
            aria-label={removeLabel(item)}
            onClick={() => onRemove(item)}
          >
            <XIcon />
          </Upload.Remove>
        </AttachmentActions>
      </Attachment>
      <Upload.Error
        render={(props) => (
          <p {...(props as ComponentProps<"p">)} className="form-error">
            {item.name} couldn’t upload. {sentence(String(props.children))}
          </p>
        )}
      />
    </>
  )
}

/** The uploads in the nearest `Upload.Root`, once there are any. */
function UploadRows({ label, ...row }: UploadRowProps & { label: string }) {
  const { uploader } = useUploadContext()
  const any = useUploadSelector(uploader, (state) => state.items.length > 0)
  if (!any) {
    return null
  }
  return (
    <Upload.List className="file-list" aria-label={label}>
      <Upload.Item>
        <UploadRow {...row} />
      </Upload.Item>
    </Upload.List>
  )
}

/** A file's thumbnail when it's an image the browser shows, or an icon for its kind. */
function FileMedia({ file }: { file: AttachedFile }) {
  if (file.url && thumbnailTypes.has(file.contentType)) {
    return (
      <AttachmentMedia variant="image">
        <img src={file.url} alt="" loading="lazy" />
      </AttachmentMedia>
    )
  }
  return <AttachmentMedia>{file.contentType.startsWith("image/") ? <FileIcon /> : <FileTextIcon />}</AttachmentMedia>
}

/** A file's name, linking to it in a new tab. */
function FileLink({ file }: { file: AttachedFile }) {
  return (
    <a className="file-link" href={file.url ?? undefined} target="_blank" rel="noreferrer">
      {file.name}
      <span className="visually-hidden">, opens in a new tab</span>
    </a>
  )
}

const menuIdOf = (fileId: string) => `file-${fileId}-menu`

interface FileCardProps {
  file: AttachedFile
  index: number
  count: number
  canDelete: boolean
  onMove(file: AttachedFile, by: -1 | 1): void
  onDelete(file: AttachedFile): void
}

/** One of the invoice's files: its thumbnail, name and size, and a menu to download, move or delete it. */
function FileCard({ file, index, count, canDelete, onMove, onDelete }: FileCardProps) {
  return (
    <Attachment size="sm" className="file-card">
      <FileMedia file={file} />
      <AttachmentContent>
        <AttachmentTitle>
          <FileLink file={file} />
        </AttachmentTitle>
        <AttachmentDescription>
          {kindOf(file.contentType)}, {formatSize(file.size)}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<AttachmentAction id={menuIdOf(file.id)} aria-label={`More for ${file.name}`} />}
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" style={{ width: "auto" }}>
            <DropdownMenuItem onClick={() => file.url && window.location.assign(downloadUrl(file.url))}>
              <DownloadIcon />
              Download
            </DropdownMenuItem>
            {index > 0 && (
              <DropdownMenuItem onClick={() => onMove(file, -1)}>
                <ArrowUpIcon />
                Move up
              </DropdownMenuItem>
            )}
            {index < count - 1 && (
              <DropdownMenuItem onClick={() => onMove(file, 1)}>
                <ArrowDownIcon />
                Move down
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(file)}>
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </AttachmentActions>
    </Attachment>
  )
}

/** Refuses a drag of files, so a full invoice takes no more. */
function refuseDrop(event: DragEvent) {
  event.preventDefault()
  event.dataTransfer.dropEffect = "none"
}

/**
 * The invoice's files, in the invoice's order, with their uploads' progress. Anyone who can see the invoice adds and
 * reorders files, with the button or by dropping them on the panel. Whoever added a file can delete it, and so can the
 * workspace owner.
 */
export function FilesPanel({ invoiceId }: { invoiceId: string }) {
  const viewer = useViewer()
  const subject = { subjectType: "invoice", subjectId: invoiceId } as const
  const attachments = useAttachmentsClient()
  const { files, state, error, reorder, detach, writeError } = useAttachments<AttachmentTypes>(subject)
  const uploader = useAttachmentsUploader<AttachmentTypes>(subject)
  const { settings } = useAttachmentSettings<AttachmentTypes>("invoice")
  const [message, announce] = useAnnouncer()
  const addRef = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  // A finished upload leaves the queue once it's in the list, so the two never count a file twice.
  const uploading = useUploadSelector(uploader, placesTaken)
  const empty = useUploadSelector(uploader, (queue) => queue.items.length === 0)
  const maxFiles = settings?.maxFiles ?? null
  const full = maxFiles !== null && files.length + uploading >= maxFiles

  // A finished upload leaves for the invoice's files, so focus on its row moves to the button that stays.
  useEffect(
    () =>
      uploader.on("success", ({ item }) => {
        if (document.getElementById(removeIdOf(item.id))?.closest("li")?.contains(document.activeElement)) {
          addRef.current?.focus()
        }
      }),
    [uploader]
  )

  function letGo(item: UploadItem) {
    if (isUnderWay(item)) {
      announce(`Stopped uploading ${item.name}`)
    }
    // The upload's buttons go with it, so focus moves to what stays.
    addRef.current?.focus()
  }

  async function move(file: AttachedFile, by: -1 | 1) {
    const ids = files.map((item) => item.id)
    const to = ids.indexOf(file.id) + by
    ids.splice(ids.indexOf(file.id), 1)
    ids.splice(to, 0, file.id)
    const moving = reorder(ids)
    announce(`Moved ${file.name} to position ${to + 1} of ${ids.length}`)
    // The menu's button moves with its file, so focus stays on it.
    requestAnimationFrame(() => document.getElementById(menuIdOf(file.id))?.focus())
    await moving
  }

  async function remove(file: AttachedFile) {
    const confirmed = await modals.confirm({
      title: `Delete ${file.name}?`,
      description: "It’s deleted for everyone who can see this invoice. This can’t be undone.",
      confirmLabel: "Delete file"
    })
    if (!confirmed) {
      return
    }
    const deleting = detach(file.id)
    announce(`Deleted ${file.name}`)
    // The file's menu goes with it, so focus moves to what stays.
    requestAnimationFrame(() => addRef.current?.focus())
    await deleting
  }

  return (
    <Upload.Root
      uploader={uploader}
      {...rootProps}
      render={<section className="files-panel" aria-labelledby="files-title" />}
    >
      <Upload.Dropzone
        clickable={false}
        className="files-drop"
        onDragEnter={full ? refuseDrop : undefined}
        onDragOver={full ? refuseDrop : undefined}
        onDrop={full ? refuseDrop : undefined}
      >
        <div className="panel-head">
          <h2 id="files-title">Files</h2>
          <Upload.Trigger
            render={<Button ref={addRef} variant="outline" size="sm" />}
            aria-describedby={hintId}
            // A full invoice keeps the button focusable, with the hint saying why it does nothing.
            aria-disabled={full || undefined}
            onClick={(event) => {
              if (full) {
                event.preventDefault()
              }
            }}
          >
            <PaperclipIcon />
            Add files
          </Upload.Trigger>
        </div>
        <p id={hintId} className="panel-hint">
          {full ? `This invoice has ${maxFiles} files, the most it can hold.` : limitsOf(settings)}
        </p>
        <output className="visually-hidden">{message}</output>
        {writeError && (
          <p className="form-error" role="alert">
            {writeError.message}
          </p>
        )}
        <UploadRows
          label="Uploads"
          removeLabel={(item) => (isUnderWay(item) ? `Stop uploading ${item.name}` : `Dismiss ${item.name}`)}
          onRemove={letGo}
        />
        {state === "loading" && files.length === 0 && (
          <p className="muted">
            <Spinner /> Loading files
          </p>
        )}
        {state === "error" && (
          <div className="stack" role="alert">
            <p className="form-error">Files couldn’t load. {error?.message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void attachments.load("invoice", [invoiceId]).catch(() => undefined)}
            >
              Try again
            </Button>
          </div>
        )}
        {state === "ready" && files.length === 0 && empty && (
          <p className="muted">No files yet. Add the signed contract, receipts or photos.</p>
        )}
        {files.length > 0 && (
          <ul className="file-list" aria-label="Files on this invoice">
            {files.map((file, index) => (
              <li key={file.id}>
                <FileCard
                  file={file}
                  index={index}
                  count={files.length}
                  canDelete={viewer !== null && (viewer.isOwner || file.attachedBy === viewer.id)}
                  onMove={(moved, by) => void move(moved, by)}
                  onDelete={(deleted) => void remove(deleted)}
                />
              </li>
            ))}
          </ul>
        )}
      </Upload.Dropzone>
    </Upload.Root>
  )
}

/**
 * Files picked for a comment before it's posted. They upload at once as drafts, so posting doesn't wait, and attach once
 * the comment is saved.
 */
export function useCommentFiles() {
  const drafts = useDraftUploader<AttachmentTypes>(commentType)
  const { settings } = useAttachmentSettings<AttachmentTypes>(commentType)
  const [message, announce] = useAnnouncer()
  const count = useUploadSelector(drafts.uploader, (state) => state.items.length)
  const taken = useUploadSelector(drafts.uploader, placesTaken)
  const maxFiles = settings?.maxFiles ?? null
  return { ...drafts, count, maxFiles, full: maxFiles !== null && taken >= maxFiles, message, announce }
}

/** What `useCommentFiles` returns. */
export type CommentFiles = ReturnType<typeof useCommentFiles>

interface CommentFormProps extends ComponentProps<"form"> {
  files: CommentFiles
}

/** A comment box that takes files: a form that holds the file picker and announces its uploads. */
export function CommentForm({ files, children, ...props }: CommentFormProps) {
  return (
    <Upload.Root uploader={files.uploader} {...rootProps} render={<form {...props} />}>
      {children}
    </Upload.Root>
  )
}

interface AttachButtonProps {
  files: CommentFiles
  buttonRef: RefObject<HTMLButtonElement | null>
}

/** The paperclip button in a comment box. */
export function AttachButton({ files, buttonRef }: AttachButtonProps) {
  return (
    <Upload.Trigger
      render={<Button ref={buttonRef} variant="ghost" size="icon-sm" />}
      aria-label={files.full ? `Attach files, ${files.maxFiles} at most` : "Attach files"}
      aria-disabled={files.full || undefined}
      onClick={(event) => {
        if (files.full) {
          event.preventDefault()
        }
      }}
    >
      <PaperclipIcon />
    </Upload.Trigger>
  )
}

interface DraftFilesProps {
  files: CommentFiles
  /** Where focus goes once a file's remove button is gone. */
  returnFocus: RefObject<HTMLButtonElement | null>
}

/** A comment's files before it's posted, with each one's progress and a button to remove it. */
export function DraftFiles({ files, returnFocus }: DraftFilesProps) {
  return (
    <>
      <output className="visually-hidden">{files.message}</output>
      <UploadRows
        label="Files to attach"
        removeLabel={(item) => `Remove ${item.name}`}
        onRemove={(item) => {
          files.announce(`Removed ${item.name}`)
          returnFocus.current?.focus()
        }}
      />
    </>
  )
}

/** A posted comment's files, linking to each. */
export function CommentFileList({ commentId }: { commentId: string }) {
  const { files } = useAttachments<AttachmentTypes>({ subjectType: commentType, subjectId: commentId })
  if (files.length === 0) {
    return null
  }
  return (
    <ul className="comment-files" aria-label="Attached files">
      {files.map((file) => (
        <li key={file.id}>
          <Attachment size="xs" className="file-card">
            <FileMedia file={file} />
            <AttachmentContent>
              <AttachmentTitle>
                <FileLink file={file} />
              </AttachmentTitle>
              <AttachmentDescription>
                {kindOf(file.contentType)}, {formatSize(file.size)}
              </AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        </li>
      ))}
    </ul>
  )
}
