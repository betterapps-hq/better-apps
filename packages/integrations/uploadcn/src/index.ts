// Uploads through Better Apps attachments with UploadCN's engine. Attachments decides where the bytes go, who sees the
// file and which record keeps it, and checks the bytes once they've arrived. UploadCN queues, sends and retries them,
// and shows each upload's progress.
import type { AttachmentSettings, AttachmentsClient, FileInfo, UploadTarget } from "@better-apps/attachments/client"
import {
  abortError,
  getFileType,
  isActiveStatus,
  toUploadError,
  UploadError,
  xhrTransport,
  type Transport,
  type TransportResponse,
  type UploadAdapter,
  type UploadItem,
  type ValidationOptions
} from "@uploadcn/core"
import { BetterAppsClientError } from "better-apps/client"

/** What an item keeps between attempts: where attachments said to send its bytes, and whether they went. */
export interface AttachmentsResumeState {
  fileId: string
  url: string
  headers: Record<string, string>
  /** When the upload address stops working, in milliseconds since the epoch. */
  expiresAt: number
  target: UploadTarget
  sent: boolean
}

/** The client steps the adapter takes, which `createAttachmentsClient` and `useAttachmentsClient` give. */
export interface AttachmentsUploads<SubjectType extends string = string> {
  prepareUpload(
    ...args: Parameters<AttachmentsClient<{ subjectType: SubjectType }>["prepareUpload"]>
  ): ReturnType<AttachmentsClient<{ subjectType: SubjectType }>["prepareUpload"]>
  finishUpload(
    ...args: Parameters<AttachmentsClient<{ subjectType: SubjectType }>["finishUpload"]>
  ): ReturnType<AttachmentsClient<{ subjectType: SubjectType }>["finishUpload"]>
  detach(
    ...args: Parameters<AttachmentsClient<{ subjectType: SubjectType }>["detach"]>
  ): ReturnType<AttachmentsClient<{ subjectType: SubjectType }>["detach"]>
  deleteFile(
    ...args: Parameters<AttachmentsClient<{ subjectType: SubjectType }>["deleteFile"]>
  ): ReturnType<AttachmentsClient<{ subjectType: SubjectType }>["deleteFile"]>
}

export interface AttachmentsAdapterOptions {
  /** Sends a file's bytes. UploadCN's XMLHttpRequest transport by default, the one way to see a send's progress. */
  transport?: Transport | undefined
}

/** An attempt asks for a new upload address when the one it has expires sooner than this. */
const renewEarlyMs = 30_000

// Refusals a second try won't change. A full record or too many drafts may free up, so those can be tried again by hand.
const refusals = new Set(["INVALID_INPUT", "PAYLOAD_TOO_LARGE", "FORBIDDEN", "NOT_FOUND", "UNAUTHENTICATED"])

function isResumeState(value: unknown): value is AttachmentsResumeState {
  const state = value as Partial<AttachmentsResumeState> | null
  return (
    typeof state === "object" &&
    state !== null &&
    typeof state.fileId === "string" &&
    typeof state.url === "string" &&
    typeof state.expiresAt === "number" &&
    typeof state.sent === "boolean" &&
    typeof state.target === "object" &&
    state.target !== null
  )
}

/** Whether an upload hasn't ended: waiting, being checked, sent or processed, or paused, such as while offline. */
export function isUnderWay(item: Pick<UploadItem, "status">): boolean {
  return isActiveStatus(item.status) || item.status === "paused" || item.status === "idle"
}

/**
 * An attachments error in UploadCN's shape, with attachments' message. Refusals that won't change, such as a type the
 * record doesn't take, are `rejected` and never retried. A full record or too many drafts fail without an automatic
 * retry, so they can be tried again by hand once there's room. An upload that expired, a server error, rate limiting and
 * a lost connection are retried.
 */
export function uploadErrorOf(error: unknown): UploadError {
  if (error instanceof UploadError) {
    return error
  }
  if (!(error instanceof BetterAppsClientError)) {
    return toUploadError(error)
  }
  if (error.code === "ABORTED") {
    return abortError(error.cause)
  }
  const options = { ...(error.status > 0 ? { status: error.status } : {}), details: { code: error.code }, cause: error }
  if (error.code === "NETWORK_ERROR") {
    return new UploadError(error.message, { ...options, code: "network", retryable: true })
  }
  if (refusals.has(error.code)) {
    return new UploadError(error.message, { ...options, code: "rejected", retryable: false })
  }
  const retryable = error.code === "CONFLICT" || error.status === 429 || error.status >= 500
  return new UploadError(error.message, { ...options, code: "http", retryable })
}

/** Cleans up without failing: what's being deleted may be gone already, and the sweep deletes what's left. */
async function quietly(cleanup: Promise<unknown>): Promise<void> {
  try {
    await cleanup
  } catch {
    // Nothing to do.
  }
}

// Headers a browser sets itself and refuses to have set, such as the length R2 signs.
const unsafeHeaders = new Set(["content-length", "host", "connection"])

const sendable = (headers: Record<string, string>) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => !unsafeHeaders.has(name.toLowerCase())))

/**
 * A failed send, with the upload route's own code and message when it gave them. `startOver` drops the prepared upload,
 * whose pending file is no use: one refused for good, or one whose address is gone.
 */
function sendError(response: TransportResponse): { error: UploadError; startOver: boolean } {
  let code: string | undefined
  let message: string | undefined
  try {
    const body = JSON.parse(response.body) as { error?: { code?: unknown; message?: unknown } }
    code = typeof body.error?.code === "string" ? body.error.code : undefined
    message = typeof body.error?.message === "string" ? body.error.message : undefined
  } catch {
    // Storage answers in XML or not at all.
  }
  const options = { status: response.status, ...(code === undefined ? {} : { details: { code } }) }
  // A type or length the upload route refuses, or a body too large to store, won't change on another attempt.
  if (code === "INVALID_INPUT" || code === "PAYLOAD_TOO_LARGE" || response.status === 413) {
    const error = new UploadError(message ?? "The file is too large to store.", {
      ...options,
      code: "rejected",
      retryable: false
    })
    return { error, startOver: true }
  }
  const error = new UploadError(message ?? "The file couldn’t be stored. Try again.", {
    ...options,
    code: "http",
    retryable: true
  })
  // An address that expired, or that storage stopped taking, is replaced. Anything else tries the same one again.
  return { error, startOver: code === "NOT_FOUND" || response.status === 403 }
}

/**
 * An UploadCN adapter that uploads through attachments: `prepareUpload` checks the file against the loaded limits and
 * asks the server where to send it, UploadCN's transport sends the bytes with progress, and `finishUpload` has the server
 * check them. A file uploaded onto a record joins the record's list in the attachments store, and the `FileInfo` becomes
 * the item's `result`.
 *
 * An attempt after a failure keeps the prepared upload until its address expires, and doesn't send bytes that already
 * arrived. A cancelled or removed upload is deleted, and taken off its record if it got there.
 */
export function attachmentsAdapter<SubjectType extends string = string>(
  client: AttachmentsUploads<SubjectType>,
  target: NoInfer<UploadTarget<SubjectType> | ((item: UploadItem) => UploadTarget<SubjectType>)>,
  { transport = xhrTransport }: AttachmentsAdapterOptions = {}
): UploadAdapter<FileInfo> {
  const targetOf = typeof target === "function" ? target : () => target
  return {
    name: "better-apps-attachments",
    resumable: false,
    async upload({ item, file, signal, resumeState, onProgress, saveResumeState }) {
      // A prepared upload that's no use is prepared again, so its pending file goes now rather than at the sweep.
      const drop = ({ fileId }: AttachmentsResumeState) => {
        saveResumeState(null)
        void quietly(client.deleteFile(fileId))
      }
      // UploadCN takes a file with no type by its extension, as some systems give a CSV, so attachments gets that type.
      const typed = file.type ? file : file.slice(0, file.size, getFileType(file))
      let state = isResumeState(resumeState) ? resumeState : null
      if (state && !state.sent && state.expiresAt - Date.now() < renewEarlyMs) {
        drop(state)
        state = null
      }
      try {
        if (!state) {
          // Preparing isn't stopped midway, so a file the server made for an upload stopped meanwhile is known and
          // deleted. UploadCN keeps no state after a stop, so `abort` couldn't.
          // A new upload sends every byte again, so its progress starts over.
          onProgress(0, file.size)
          const prepared = await client.prepareUpload(typed, targetOf(item), { name: item.name })
          if (signal.aborted) {
            void quietly(client.deleteFile(prepared.file.id))
            throw abortError(signal.reason)
          }
          state = {
            fileId: prepared.file.id,
            url: prepared.upload.url,
            headers: prepared.upload.headers,
            expiresAt: prepared.upload.expiresAt.getTime(),
            target: prepared.target,
            sent: false
          }
          saveResumeState(state)
        }
        if (!state.sent) {
          const response = await transport({
            method: "PUT",
            url: state.url,
            headers: sendable(state.headers),
            body: typed,
            signal,
            onUploadProgress: (loaded, total) => onProgress(loaded, total)
          })
          if (response.status < 200 || response.status >= 300) {
            const { error, startOver } = sendError(response)
            if (startOver) {
              drop(state)
            }
            throw error
          }
          state = { ...state, sent: true }
          saveResumeState(state)
        }
        onProgress(file.size)
        return await client.finishUpload(
          { file: { id: state.fileId }, target: state.target as UploadTarget<SubjectType> },
          { signal }
        )
      } catch (error) {
        if (!state || !(error instanceof BetterAppsClientError)) {
          throw uploadErrorOf(error)
        }
        // An upload that expired, or bytes that didn't arrive, start over with a new address.
        if (error.code === "CONFLICT") {
          drop(state)
          throw uploadErrorOf(error)
        }
        // A finish the server refused leaves nothing to finish, so the pending file goes and trying again by hand starts
        // over. One the server found gone, such as after the sweep, starts over at once.
        if (state.sent && error.status >= 400 && error.status < 500 && error.status !== 429) {
          drop(state)
          if (error.code === "NOT_FOUND") {
            throw new UploadError(error.message, {
              code: "http",
              status: error.status,
              retryable: true,
              details: { code: error.code },
              cause: error
            })
          }
        }
        throw uploadErrorOf(error)
      }
    },
    async abort({ resumeState }) {
      if (!isResumeState(resumeState)) {
        return
      }
      const { fileId, target } = resumeState
      // Deleted first, so a finish still under way can't put the file on its record. A finish that got there first
      // leaves a file that only comes off its record.
      try {
        await client.deleteFile(fileId)
      } catch (error) {
        const onRecord = error instanceof BetterAppsClientError && error.code === "INVALID_INPUT"
        if (onRecord && target.subjectType !== undefined && target.subjectId !== undefined) {
          const subject = { subjectType: target.subjectType as SubjectType, subjectId: target.subjectId }
          await quietly(client.detach(subject, fileId))
        }
      }
    }
  }
}

/**
 * UploadCN's checks for what attachments allows: the media types, which also limit the file picker, the size, and for
 * a record, the places left on it when `existing` says how many files it has. `null` settings, still loading, check
 * nothing, and the server still refuses what it doesn't allow. Every limit is given, with `[]` for any type and
 * `Infinity` for any size or number of files, so an uploader whose options are merged, as `useUploader`'s are, drops
 * one that no longer applies, such as another subject type's while this one's settings load.
 */
export function uploadLimits(
  settings: AttachmentSettings | null,
  { existing }: { existing?: number | undefined } = {}
): Pick<ValidationOptions, "accept" | "maxSize" | "maxFiles"> {
  if (!settings) {
    return { accept: [], maxSize: Infinity, maxFiles: Infinity }
  }
  return {
    accept: settings.contentTypes ?? [],
    maxSize: settings.maxSize,
    maxFiles:
      settings.maxFiles !== null && existing !== undefined ? Math.max(0, settings.maxFiles - existing) : Infinity
  }
}

export type { FileInfo, UploadTarget } from "@better-apps/attachments/client"
