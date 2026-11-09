// React hooks over the attachments store, with no UI: apps bring their own pickers, lists and progress.
import { useBetterApps, useStore } from "@better-apps/react"
import type { BetterApp } from "better-apps"
import { BetterAppsClientError, type BetterAppsClient } from "better-apps/client"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  createAttachmentsClient,
  subjectKey,
  type AttachedFile,
  type AttachmentsClient,
  type AttachmentSettings,
  type AttachmentsState,
  type AttachmentsTypes,
  type LoadState,
  type Subject,
  type Upload,
  type UploadTarget
} from "./client.js"

export * from "./client.js"

/**
 * The attachments client for the nearest `BetterAppsProvider`. Each Better Apps client has one, so every hook shares
 * one store. Pass `typeof app` for the app's types.
 */
export function useAttachmentsClient<App = BetterApp>() {
  return createAttachmentsClient(useBetterApps<BetterAppsClient<App>>())
}

function useAttachmentsState<Selected>(select: (state: AttachmentsState) => Selected) {
  const attachments = useAttachmentsClient()
  return useStore(attachments.store as AttachmentsClient["store"], select)
}

const isAborted = (error: unknown) => error instanceof BetterAppsClientError && error.code === "ABORTED"
const none: AttachedFile[] = []
const noUploads: Upload[] = []

/** A record's files as `useAttachments` returns them. */
export interface AttachmentsResult {
  /** In the record's order. */
  files: AttachedFile[]
  state: LoadState
  error: Error | null
  /** Takes a file off the record. It goes at once, and comes back when the server refuses. */
  detach(fileId: string): Promise<void>
  /** Puts the record's files in a new order, every file's id listed. */
  reorder(fileIds: readonly string[]): Promise<void>
  /** The latest change the server refused, until the next one. */
  writeError: Error | null
  /** Whether a file is still being taken off. */
  isPending(fileId: string): boolean
}

/** A record's files, loaded on first use. Records that mount together, such as a thread's comments, load in one call. */
export function useAttachments<Types extends AttachmentsTypes = AttachmentsTypes>(
  subject: Subject<Types["subjectType"]>
): AttachmentsResult {
  const attachments = useAttachmentsClient()
  const { subjectType, subjectId } = subject
  const loaded = useAttachmentsState((state) => state.subjects[subjectKey(subjectType, subjectId)])
  const [writeError, setWriteError] = useState<Error | null>(null)
  const loadedState = loaded?.state
  useEffect(() => {
    if (loadedState === undefined || loadedState === "idle") {
      attachments.load(subjectType, [subjectId]).catch(() => undefined)
    }
  }, [attachments, subjectType, subjectId, loadedState])
  useEffect(() => attachments.onReset(() => setWriteError(null)), [attachments])
  const write = useCallback(async (change: () => Promise<unknown>) => {
    setWriteError(null)
    try {
      await change()
    } catch (caught) {
      if (!isAborted(caught)) {
        setWriteError(caught as Error)
      }
    }
  }, [])
  const detach = useCallback(
    async (fileId: string) => write(() => attachments.detach({ subjectType, subjectId }, fileId)),
    [attachments, write, subjectType, subjectId]
  )
  const reorder = useCallback(
    async (fileIds: readonly string[]) => write(() => attachments.reorder({ subjectType, subjectId }, fileIds)),
    [attachments, write, subjectType, subjectId]
  )
  const pending = loaded?.pending
  const isPending = useCallback((fileId: string) => pending?.includes(fileId) === true, [pending])
  return {
    files: loaded?.files ?? none,
    state: loadedState === undefined || loadedState === "idle" ? "loading" : loadedState,
    error: loaded?.error ?? null,
    detach,
    reorder,
    writeError,
    isPending
  }
}

/** The uploads among these ids, in their order. */
function useUploads(ids: readonly string[]): Upload[] {
  const uploads = useAttachmentsState((state) => state.uploads)
  return useMemo(() => {
    const found = ids.flatMap((id) => (uploads[id] ? [uploads[id]] : []))
    return found.length === 0 ? noUploads : found
  }, [ids, uploads])
}

/** Uploads this hook started: their ids, and functions to add and forget them. */
function useOwnUploads(target: UploadTarget) {
  const attachments = useAttachmentsClient()
  const [ids, setIds] = useState<readonly string[]>([])
  const uploads = useUploads(ids)
  useEffect(() => attachments.onReset(() => setIds([])), [attachments])
  const { subjectType, subjectId } = target
  const owner = (target as { owner?: "user" | "org" }).owner
  const start = useCallback(
    async (files: Iterable<File>) => {
      const started = Array.from(files, (file) =>
        attachments.startUpload(file, { subjectType, subjectId, owner } as UploadTarget)
      )
      setIds((current) => [...current, ...started.map((upload) => upload.id)])
      return Promise.allSettled(started.map((upload) => upload.done))
    },
    [attachments, subjectType, subjectId, owner]
  )
  const forget = useCallback(
    (forgotten: readonly string[]) => {
      attachments.dismiss(forgotten)
      setIds((current) => current.filter((id) => !forgotten.includes(id)))
    },
    [attachments]
  )
  return { attachments, ids, uploads, start, forget }
}

/** Uploads onto a record that exists, or files on their own, with each upload's progress. */
export function useUpload<Types extends AttachmentsTypes = AttachmentsTypes>(
  target: UploadTarget<Types["subjectType"]>
) {
  const { attachments, uploads, start, forget } = useOwnUploads(target)
  return {
    /** Starts an upload for each file. Resolves once every one has finished or failed. */
    upload: start,
    /** This hook's uploads, oldest first, until they're dismissed. */
    uploads,
    cancel: attachments.cancel,
    /** Forgets uploads that finished, failed or were cancelled. */
    dismiss: forget
  }
}

/**
 * Uploads drafts for a record that isn't saved yet, such as files in a comment composer, and attaches them once it is.
 */
export function useDraftAttachments<Types extends AttachmentsTypes = AttachmentsTypes>(
  subjectType: Types["subjectType"]
) {
  const { attachments, ids, uploads, start, forget } = useOwnUploads({ subjectType })
  const busy = uploads.some((upload) => upload.state === "uploading" || upload.state === "finishing")
  /** Cancels a draft that's uploading, or deletes one that's done, and forgets it. */
  const remove = useCallback(
    (uploadId: string) => {
      const upload = attachments.store.getSnapshot().uploads[uploadId]
      if (upload?.state === "uploading" || upload?.state === "finishing") {
        attachments.cancel(uploadId)
      } else if (upload?.state === "done" && upload.file) {
        attachments.deleteFile(upload.file.id).catch(() => undefined)
      }
      forget([uploadId])
    },
    [attachments, forget]
  )
  /** Attaches the finished drafts to the saved record, then empties the list. */
  const attachTo = useCallback(
    async (subjectId: string) => {
      const done = uploads.filter((upload) => upload.state === "done" && upload.file)
      if (done.length > 0) {
        await attachments.attach(
          { subjectType, subjectId },
          done.map((upload) => upload.file?.id as string)
        )
      }
      forget(ids)
    },
    [attachments, forget, ids, subjectType, uploads]
  )
  /** Empties the list, deleting drafts that finished and cancelling those still uploading. */
  const clear = useCallback(() => {
    for (const id of ids) {
      remove(id)
    }
  }, [ids, remove])
  return { add: start, uploads, busy, remove, attachTo, clear }
}

/** The limits for a subject type, or files on their own, such as for a picker's `accept`. `null` until loaded. */
export function useAttachmentSettings<Types extends AttachmentsTypes = AttachmentsTypes>(
  subjectType?: Types["subjectType"]
) {
  const attachments = useAttachmentsClient()
  const settings = useAttachmentsState((state) => state.settings[subjectType ?? ""])
  const [error, setError] = useState<Error | null>(null)
  const loaded = settings !== undefined
  useEffect(() => {
    if (!loaded) {
      attachments.loadSettings(subjectType).then(
        () => setError(null),
        (caught: unknown) => setError(caught as Error)
      )
    }
  }, [attachments, subjectType, loaded])
  return { settings: (settings ?? null) as AttachmentSettings | null, error }
}
