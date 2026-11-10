// Uploads through Better Apps attachments with UploadCN's engine. Attachments decides where the bytes go, who sees the
// file and which record keeps it, and checks the bytes once they've arrived. UploadCN queues, sends and retries them,
// and shows each upload's progress.
import type { AttachmentSettings, AttachmentsClient, FileInfo, UploadTarget } from "@better-apps/attachments/client"
import {
  abortError,
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
const refusals = new Set(["INVALID_INPUT", "PAYLOAD_TOO_LARGE", "FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"])

function isResumeState(value: unknown): value is AttachmentsResumeState {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AttachmentsResumeState).fileId === "string" &&
    typeof (value as AttachmentsResumeState).url === "string"
  )
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

/** Whether a failed send's address is no use for another attempt, such as one that expired or was refused. */
const deadAddress = (status: number) => status >= 400 && status < 500 && status !== 413 && status !== 429

/** A failed send, with the upload route's own message when it gave one. */
function sendError(response: TransportResponse): UploadError {
  let message = "The file couldn’t be stored. Try again."
  try {
    const body = JSON.parse(response.body) as { error?: { message?: unknown } }
    if (typeof body.error?.message === "string") {
      message = body.error.message
    }
  } catch {
    // Storage answers in XML or not at all.
  }
  if (response.status === 413) {
    return new UploadError(message, { code: "rejected", status: 413, retryable: false })
  }
  // Another refusal usually means the address expired or the bytes were cut short, so the next attempt starts over with
  // a new one. A server error or rate limiting tries the same address again.
  return new UploadError(message, { code: "http", status: response.status, retryable: true })
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
        client.deleteFile(fileId).catch(() => undefined)
      }
      let state = isResumeState(resumeState) ? resumeState : null
      if (state && !state.sent && state.expiresAt - Date.now() < renewEarlyMs) {
        drop(state)
        state = null
      }
      try {
        if (!state) {
          const prepared = await client.prepareUpload(file, targetOf(item), { name: item.name, signal })
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
            headers: state.headers,
            body: file,
            signal,
            onUploadProgress: (loaded, total) => onProgress(loaded, total)
          })
          if (response.status < 200 || response.status >= 300) {
            if (deadAddress(response.status)) {
              drop(state)
            }
            throw sendError(response)
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
        const failure = uploadErrorOf(error)
        // An upload that expired, or bytes that didn't arrive, start over with a new address.
        if (state && error instanceof BetterAppsClientError && error.code === "CONFLICT") {
          drop(state)
        }
        throw failure
      }
    },
    async abort({ resumeState }) {
      if (!isResumeState(resumeState)) {
        return
      }
      const { fileId, target, sent } = resumeState
      // Bytes that arrived may have put the file on its record before the upload stopped.
      if (sent && target.subjectType !== undefined && target.subjectId !== undefined) {
        const subject = { subjectType: target.subjectType as SubjectType, subjectId: target.subjectId }
        await client.detach(subject, fileId).catch(() => undefined)
      }
      await client.deleteFile(fileId).catch(() => undefined)
    }
  }
}

/**
 * UploadCN's checks for what attachments allows: the media types, which also limit the file picker, the size, and for
 * a record, the places left on it when `existing` says how many files it has. `null` settings, still loading, check
 * nothing, and the server still refuses what it doesn't allow.
 */
export function uploadLimits(
  settings: AttachmentSettings | null,
  { existing }: { existing?: number | undefined } = {}
): Pick<ValidationOptions, "accept" | "maxSize" | "maxFiles"> {
  if (!settings) {
    return {}
  }
  return {
    ...(settings.contentTypes ? { accept: settings.contentTypes } : {}),
    maxSize: settings.maxSize,
    ...(settings.maxFiles !== null && existing !== undefined
      ? { maxFiles: Math.max(0, settings.maxFiles - existing) }
      : {})
  }
}

export type { FileInfo, UploadTarget } from "@better-apps/attachments/client"
