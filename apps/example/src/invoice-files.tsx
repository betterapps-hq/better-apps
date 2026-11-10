import {
  useAttachments,
  useAttachmentsClient,
  useAttachmentSettings,
  useDraftAttachments,
  useUpload,
  type AttachedFile,
  type AttachmentSettings,
  type Upload
} from "@better-apps/attachments/react"
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
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  EllipsisIcon,
  FileIcon,
  FileTextIcon,
  PaperclipIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon
} from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react"
import type { AttachmentTypes } from "./app-types"
import { formatSize, plural } from "./format"
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

/** Says how many of the picked files uploaded. Failures say so themselves, in an alert beside the file. */
function uploadedMessage(picked: readonly File[], results: readonly PromiseSettledResult<unknown>[]) {
  const uploaded = results.filter((result) => result.status === "fulfilled").length
  if (uploaded === 0) {
    return null
  }
  return picked.length === 1 ? `${picked[0]?.name} uploaded` : `${plural(uploaded, "file", "files")} uploaded`
}

const uploadingMessage = (picked: readonly File[]) =>
  picked.length === 1 ? `Uploading ${picked[0]?.name}` : `Uploading ${picked.length} files`

interface FilePickerProps {
  label: string
  settings: AttachmentSettings | null
  buttonRef: RefObject<HTMLButtonElement | null>
  /** Shows only the icon, with the label as its accessible name. */
  iconOnly?: boolean
  /** Keeps the button from opening the picker, such as on a full invoice. It stays focusable. */
  disabled?: boolean
  describedBy?: string
  onPick(files: File[]): void
}

/** A button that opens the browser's file picker, limited to the types the subject type takes. */
function FilePicker({ label, settings, buttonRef, iconOnly, disabled, describedBy, onPick }: FilePickerProps) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={settings?.contentTypes?.join(",")}
        onChange={(event) => {
          const picked = [...(event.currentTarget.files ?? [])]
          // Picking the same file again still counts as a change.
          event.currentTarget.value = ""
          onPick(picked)
        }}
      />
      <Button
        ref={buttonRef}
        type="button"
        variant={iconOnly ? "ghost" : "outline"}
        size={iconOnly ? "icon-sm" : "sm"}
        aria-label={iconOnly ? label : undefined}
        aria-describedby={describedBy}
        aria-disabled={disabled}
        onClick={() => !disabled && input.current?.click()}
      >
        <PaperclipIcon />
        {!iconOnly && label}
      </Button>
    </>
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

const cardStates = {
  uploading: "uploading",
  finishing: "processing",
  done: "done",
  error: "error",
  cancelled: "idle"
} as const

/** Where an upload stands, in words. */
function progressOf(upload: Upload) {
  if (upload.state === "error") {
    return "Couldn’t upload"
  }
  if (upload.state === "finishing") {
    return "Checking the file"
  }
  if (upload.state === "done") {
    return `${kindOf(upload.contentType)}, ${formatSize(upload.size)}`
  }
  return `${formatSize(upload.loaded)} of ${formatSize(upload.size)}`
}

/** An upload's icon: a warning when it failed, its kind once it's done, and a spinner until then. */
function UploadIcon({ upload }: { upload: Upload }) {
  if (upload.state === "error") {
    return <TriangleAlertIcon />
  }
  if (upload.state === "done") {
    return upload.contentType.startsWith("image/") ? <FileIcon /> : <FileTextIcon />
  }
  return <Spinner />
}

interface UploadRowProps {
  upload: Upload
  /** What the button says it does, such as "Remove" for a draft. */
  stopLabel: string
  onStop(upload: Upload): void
}

/** An upload under way or one that failed: its progress or why, and a button to stop it or let it go. */
function UploadRow({ upload, stopLabel, onStop }: UploadRowProps) {
  const failed = upload.state === "error"
  const percent = upload.size === 0 ? 100 : Math.round((upload.loaded / upload.size) * 100)
  return (
    <>
      <Attachment size="sm" className="file-card" state={cardStates[upload.state]}>
        <AttachmentMedia>
          <UploadIcon upload={upload} />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>{upload.name}</AttachmentTitle>
          <AttachmentDescription>{progressOf(upload)}</AttachmentDescription>
          {upload.state === "uploading" && (
            <Progress value={percent} aria-label={`Uploading ${upload.name}`} className="upload-progress" />
          )}
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction aria-label={`${stopLabel} ${upload.name}`} onClick={() => onStop(upload)}>
            <XIcon />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>
      {failed && (
        <p className="form-error" role="alert">
          {upload.name} couldn’t upload. {upload.error?.message ?? "Try again in a moment."}
        </p>
      )}
    </>
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

/**
 * The invoice's files, in the invoice's order, with their uploads' progress. Anyone who can see the invoice adds and
 * reorders files. Whoever added a file can delete it, and so can the workspace owner.
 */
export function FilesPanel({ invoiceId }: { invoiceId: string }) {
  const viewer = useViewer()
  const subject = { subjectType: "invoice", subjectId: invoiceId } as const
  const attachments = useAttachmentsClient()
  const { files, state, error, reorder, detach, writeError } = useAttachments<AttachmentTypes>(subject)
  const { upload, uploads, cancel, dismiss } = useUpload<AttachmentTypes>(subject)
  const { settings } = useAttachmentSettings<AttachmentTypes>("invoice")
  const [message, announce] = useAnnouncer()
  const addRef = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  const sending = uploads.filter((item) => item.state === "uploading" || item.state === "finishing").length
  const maxFiles = settings?.maxFiles ?? null
  const full = maxFiles !== null && files.length + sending >= maxFiles

  // A finished upload shows in the list, so its progress goes.
  useEffect(() => {
    const finished = uploads.filter((item) => item.state === "done" || item.state === "cancelled")
    if (finished.length > 0) {
      dismiss(finished.map((item) => item.id))
    }
  }, [uploads, dismiss])

  async function add(picked: File[]) {
    if (picked.length === 0) {
      return
    }
    announce(uploadingMessage(picked))
    const done = uploadedMessage(picked, await upload(picked))
    if (done) {
      announce(done)
    }
  }

  function stop(item: Upload) {
    if (item.state === "uploading" || item.state === "finishing") {
      cancel(item.id)
      announce(`Stopped uploading ${item.name}`)
    }
    dismiss([item.id])
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
    <section className="files-panel" aria-labelledby="files-title">
      <div className="panel-head">
        <h2 id="files-title">Files</h2>
        <FilePicker
          label="Add files"
          settings={settings}
          buttonRef={addRef}
          disabled={full}
          describedBy={hintId}
          onPick={(picked) => void add(picked)}
        />
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
      {uploads.length > 0 && (
        <ul className="file-list" aria-label="Uploads">
          {uploads.map((item) => (
            <li key={item.id}>
              <UploadRow
                upload={item}
                stopLabel={item.state === "error" ? "Dismiss" : "Stop uploading"}
                onStop={stop}
              />
            </li>
          ))}
        </ul>
      )}
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
      {state === "ready" && files.length === 0 && uploads.length === 0 && (
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
    </section>
  )
}

/**
 * Files picked for a comment before it's posted. They upload at once, so posting doesn't wait, and attach once the
 * comment is saved.
 */
export function useCommentFiles() {
  const drafts = useDraftAttachments<AttachmentTypes>(commentType)
  const { settings } = useAttachmentSettings<AttachmentTypes>(commentType)
  const [message, announce] = useAnnouncer()
  const { add: start } = drafts
  const add = useCallback(
    async (picked: File[]) => {
      if (picked.length === 0) {
        return
      }
      announce(uploadingMessage(picked))
      const done = uploadedMessage(picked, await start(picked))
      if (done) {
        announce(done)
      }
    },
    [start, announce]
  )
  return { ...drafts, add, settings, message, announce }
}

/** What `useCommentFiles` returns. */
export type CommentFiles = ReturnType<typeof useCommentFiles>

interface AttachButtonProps {
  files: CommentFiles
  buttonRef: RefObject<HTMLButtonElement | null>
}

/** The paperclip button in a comment box. */
export function AttachButton({ files, buttonRef }: AttachButtonProps) {
  const maxFiles = files.settings?.maxFiles ?? null
  const full = maxFiles !== null && files.uploads.length >= maxFiles
  return (
    <FilePicker
      label={full ? `Attach files, ${maxFiles} at most` : "Attach files"}
      settings={files.settings}
      buttonRef={buttonRef}
      iconOnly
      disabled={full}
      onPick={(picked) => void files.add(picked)}
    />
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
      {files.uploads.length > 0 && (
        <ul className="file-list" aria-label="Files to attach">
          {files.uploads.map((item) => (
            <li key={item.id}>
              <UploadRow
                upload={item}
                stopLabel="Remove"
                onStop={(stopped) => {
                  files.remove(stopped.id)
                  files.announce(`Removed ${stopped.name}`)
                  returnFocus.current?.focus()
                }}
              />
            </li>
          ))}
        </ul>
      )}
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
