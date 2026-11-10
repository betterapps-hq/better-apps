// React hooks over UploadCN's `useUploader` that upload through attachments, for UploadCN's `Upload` primitives and the
// blocks built on them: onto a record, as drafts before their record exists, or as files on their own.
import { subjectKey, type AttachmentsTypes, type FileInfo, type UploadTarget } from "@better-apps/attachments/client"
import { useAttachmentsClient, useAttachmentSettings } from "@better-apps/attachments/react"
import { useStore } from "@better-apps/react"
import type { Transport, Uploader } from "@uploadcn/core"
import { useUploader, useUploadSelector, type UseUploaderOptions } from "@uploadcn/react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { attachmentsAdapter, uploadLimits } from "./index.js"

export interface AttachmentsUploaderOptions extends Omit<UseUploaderOptions<FileInfo>, "adapter"> {
  /** Sends a file's bytes, as `attachmentsAdapter` takes it. */
  transport?: Transport | undefined
}

/**
 * An UploadCN uploader that uploads through attachments. It checks files against the subject type's limits, which also
 * limit the file picker, and against the places left on the record, all of them for drafts. Options given here win over
 * the limits.
 *
 * A file uploaded onto a record joins the record's list in `useAttachments`, so it leaves the queue once it's there.
 * Drafts and files on their own stay in the queue, with the `FileInfo` as each item's `result`.
 */
export function useAttachmentsUploader<Types extends AttachmentsTypes = AttachmentsTypes>(
  target: UploadTarget<Types["subjectType"]>,
  { transport, ...options }: AttachmentsUploaderOptions = {}
): Uploader<FileInfo> {
  const client = useAttachmentsClient()
  const { settings } = useAttachmentSettings(target.subjectType)
  const { subjectType, subjectId } = target
  const owner = "owner" in target ? target.owner : undefined
  const key = subjectType !== undefined && subjectId !== undefined ? subjectKey(subjectType, subjectId) : null
  const existing = useStore(client.store, (state) => {
    if (key !== null) {
      return state.subjects[key]?.files.length
    }
    // Drafts go on a record that doesn't exist yet, so it has no files. Files on their own have no record to fill.
    return subjectType === undefined ? undefined : 0
  })
  const adapter = useMemo(
    () =>
      attachmentsAdapter(client, (subjectType === undefined ? { owner } : { subjectType, subjectId }) as UploadTarget, {
        transport
      }),
    [client, subjectType, subjectId, owner, transport]
  )
  const uploader = useUploader<FileInfo>({ ...uploadLimits(settings, { existing }), ...options, adapter })
  useEffect(() => {
    if (key === null) {
      return undefined
    }
    return uploader.on("success", ({ item }) => uploader.remove(item.id))
  }, [uploader, key])
  return uploader
}

/** What `useDraftUploader` returns. */
export interface DraftUploader {
  uploader: Uploader<FileInfo>
  /** Whether a draft is still uploading, so its record shouldn't be saved yet. */
  busy: boolean
  /** Puts the drafts that finished on the saved record, then empties the queue. */
  attachTo(subjectId: string): Promise<void>
  /** Empties the queue: drafts that finished are deleted, and those still uploading stop. */
  clear(): void
}

/**
 * An UploadCN uploader for files picked before their record exists, such as a comment's before it's posted. They upload
 * at once as drafts of the subject type, so saving the record doesn't wait, and `attachTo` puts them on it. Removing a
 * draft that finished deletes it, so it doesn't wait for the sweep.
 */
export function useDraftUploader<Types extends AttachmentsTypes = AttachmentsTypes>(
  subjectType: Types["subjectType"],
  options: AttachmentsUploaderOptions = {}
): DraftUploader {
  const client = useAttachmentsClient()
  const uploader = useAttachmentsUploader<Types>({ subjectType }, options)
  // Drafts that went on their record leave the queue without being deleted.
  const attached = useRef(new Set<string>())
  useEffect(
    () =>
      uploader.on("remove", ({ item }) => {
        if (item.status === "success" && item.result && !attached.current.delete(item.id)) {
          client.deleteFile(item.result.id).catch(() => undefined)
        }
      }),
    [client, uploader]
  )
  const busy = useUploadSelector(uploader, (state) =>
    state.items.some((item) => ["validating", "queued", "uploading", "processing", "scanning"].includes(item.status))
  )
  const attachTo = useCallback(
    async (subjectId: string) => {
      const done = uploader.getState().items.filter((item) => item.status === "success" && item.result)
      if (done.length > 0) {
        await client.attach(
          { subjectType, subjectId },
          done.map((item) => (item.result as FileInfo).id)
        )
      }
      for (const item of done) {
        attached.current.add(item.id)
      }
      uploader.remove()
    },
    [client, subjectType, uploader]
  )
  const clear = useCallback(() => uploader.remove(), [uploader])
  return { uploader, busy, attachTo, clear }
}
