// React hooks over UploadCN's `useUploader` that upload through attachments, for UploadCN's `Upload` primitives and the
// blocks built on them: onto a record, as drafts before their record exists, or as files on their own.
import { subjectKey, type AttachmentsTypes, type FileInfo, type UploadTarget } from "@better-apps/attachments/client"
import { useAttachmentsClient, useAttachmentSettings } from "@better-apps/attachments/react"
import { useStore } from "@better-apps/react"
import type { Transport, Uploader } from "@uploadcn/core"
import { useUploader, useUploadSelector, type UseUploaderOptions } from "@uploadcn/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { attachmentsAdapter, isUnderWay, uploadLimits } from "./index.js"

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
    // A record whose list hasn't loaded gets all its places until it does, which the server still checks.
    if (key !== null) {
      return state.subjects[key]?.files.length ?? 0
    }
    // Drafts go on a record that doesn't exist yet, so it has no files. Files on their own have no record to fill.
    return subjectType === undefined ? undefined : 0
  })
  // Each upload keeps the target it was added for, so one queued or tried again after the target changed, such as on
  // another record's page, still goes where it was picked for.
  const [targets] = useState(() => new Map<string, UploadTarget>())
  const adapter = useMemo(
    () =>
      attachmentsAdapter(client, (item) => targets.get(item.id) as UploadTarget, {
        transport
      }),
    [client, targets, transport]
  )
  const uploader = useUploader<FileInfo>({ ...uploadLimits(settings, { existing }), ...options, adapter })
  useEffect(() => {
    const current = (subjectType === undefined ? { owner } : { subjectType, subjectId }) as UploadTarget
    const added = uploader.on("add", ({ items }) => {
      for (const item of items) {
        targets.set(item.id, current)
      }
    })
    const removed = uploader.on("remove", ({ item }) => targets.delete(item.id))
    return () => {
      added()
      removed()
    }
  }, [uploader, targets, subjectType, subjectId, owner])
  useEffect(
    () =>
      uploader.on("success", ({ item }) => {
        if (targets.get(item.id)?.subjectId !== undefined) {
          uploader.remove(item.id)
        }
      }),
    [uploader, targets]
  )
  return uploader
}

/** What `useDraftUploader` returns. */
export interface DraftUploader {
  uploader: Uploader<FileInfo>
  /** Whether a draft hasn’t finished, such as one paused while offline, so its record shouldn’t be saved yet. */
  busy: boolean
  /**
   * Puts the drafts that finished on the saved record, then takes every draft the queue held off it. Drafts picked
   * meanwhile stay.
   */
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
  const busy = useUploadSelector(uploader, (state) => state.items.some(isUnderWay))
  const attachTo = useCallback(
    async (subjectId: string) => {
      const { items } = uploader.getState()
      const done = items.filter((item) => item.status === "success" && item.result)
      if (done.length > 0) {
        await client.attach(
          { subjectType, subjectId },
          done.map((item) => (item.result as FileInfo).id)
        )
      }
      for (const item of done) {
        attached.current.add(item.id)
      }
      // Drafts picked while the record saved stay, for the next one.
      uploader.remove(items.map((item) => item.id))
    },
    [client, subjectType, uploader]
  )
  const clear = useCallback(() => uploader.remove(), [uploader])
  return { uploader, busy, attachTo, clear }
}
