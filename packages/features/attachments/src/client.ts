// The framework-free browser half of attachments: a store of each record's files and the uploads under way, that any
// framework binds to. Uploads send their bytes with XMLHttpRequest, for progress. It imports no server code.
import type { BetterApp } from "better-apps"
import {
  BetterAppsClientError,
  createStore,
  type BetterAppsClient,
  type CallOptions,
  type Serialized,
  type Store
} from "better-apps/client"
import type { ClientAttachmentEvent } from "./feature.js"
import { allowsType, cleanContentType } from "./files.js"
import type { AttachmentsOptions, AttachmentsTypes, TypesOf, UploadTarget } from "./options.js"
import type { AttachedFile, FileInfo } from "./present.js"
import type { AttachmentSettings } from "./records.js"
import type { CompleteUploadResult, CreateUploadResult, UploadRequest } from "./uploads.js"

export type { ClientAttachmentEvent } from "./feature.js"
export type { AttachmentsOptions, AttachmentsTypes, TypesOf, UploadTarget } from "./options.js"
export type { AttachedFile, FileInfo } from "./present.js"
export type { AttachmentSettings } from "./records.js"

type AttachmentsFeatureOf<App> =
  App extends BetterApp<infer Features> ? Extract<Features[number], { id: "attachments" }> : never

/** The attachments types of an app, from `typeof app`. */
export type AppAttachmentsTypes<App> =
  AttachmentsFeatureOf<App> extends { options: infer Options extends AttachmentsOptions }
    ? TypesOf<Options>
    : AttachmentsTypes

/** Which record files are on. */
export interface Subject<SubjectType extends string = string> {
  subjectType: SubjectType
  subjectId: string
}

/** Where a load stands. `error` holds the client error when it failed. */
export type LoadState = "idle" | "loading" | "ready" | "error"

/** A record's files, in order, with this tab's changes the server hasn't confirmed yet. */
export interface SubjectFiles {
  files: AttachedFile[]
  state: LoadState
  error: Error | null
  /** Files this tab is taking off, still waiting for the server. */
  pending: readonly string[]
}

/**
 * Where an upload stands: sending its bytes, `finishing` while the server checks them, `done`, or stopped by an `error`
 * or a `cancel`.
 */
export type UploadState = "uploading" | "finishing" | "done" | "error" | "cancelled"

/** One upload from this tab. */
export interface Upload {
  id: string
  name: string
  contentType: string
  /** Bytes. */
  size: number
  /** Bytes sent so far. */
  loaded: number
  state: UploadState
  error: Error | null
  /** The file, once the server has it. */
  file: FileInfo | null
  target: UploadTarget
}

/**
 * An upload the server is ready for, from `prepareUpload`: the pending file, and where to send its bytes. An upload
 * engine such as UploadCN sends them, then passes this to `finishUpload`.
 */
export interface PreparedUpload {
  file: FileInfo
  /** A `PUT` with these headers, straight to storage when it signs uploads, or to the app's upload route. */
  upload: UploadRequest
  target: UploadTarget
}

/** Everything the store holds. */
export interface AttachmentsState {
  subjects: Readonly<Record<string, SubjectFiles>>
  uploads: Readonly<Record<string, Upload>>
  /** Limits by subject type, with `""` for files on their own, from `loadSettings`. */
  settings: Readonly<Record<string, AttachmentSettings>>
}

/** A store snapshot as JSON carries it, for server rendering. */
export type DehydratedAttachments = Serialized<Pick<AttachmentsState, "subjects" | "settings">>

/** What a transport sends: one `PUT` of a file's bytes. */
export interface TransportRequest {
  url: string
  method: "PUT"
  headers: Record<string, string>
  body: Blob
  signal: AbortSignal
  /** Called as bytes go out, with how many have. */
  onProgress(loaded: number): void
}

/** Sends an upload's bytes and resolves with the response's status. */
export type UploadTransport = (request: TransportRequest) => Promise<{ status: number }>

/** Options for `createAttachmentsClient`. */
export interface AttachmentsClientOptions {
  /** How bytes are sent. `XMLHttpRequest` where there is one, for progress, and `fetch` elsewhere. */
  transport?: UploadTransport | undefined
}

/** Keys a record's files. */
export function subjectKey(subjectType: string, subjectId: string): string {
  return JSON.stringify([subjectType, subjectId])
}

const empty: AttachmentsState = { subjects: {}, uploads: {}, settings: {} }
const pageSize = 20
// Headers a browser sets itself and refuses to have set.
const unsafeHeaders = new Set(["content-length", "host", "connection"])

const aborted = () => new BetterAppsClientError("ABORTED", "The upload was cancelled.", { status: 0 })

function sendWithXhr(request: TransportRequest): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(request.method, request.url)
    for (const [name, value] of Object.entries(request.headers)) {
      if (!unsafeHeaders.has(name.toLowerCase())) {
        xhr.setRequestHeader(name, value)
      }
    }
    xhr.upload.addEventListener("progress", (event) => request.onProgress(event.loaded))
    xhr.addEventListener("load", () => resolve({ status: xhr.status }))
    xhr.addEventListener("error", () =>
      reject(new BetterAppsClientError("NETWORK_ERROR", "The file couldn't be sent.", { status: 0 }))
    )
    xhr.addEventListener("abort", () => reject(aborted()))
    request.signal.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(request.body)
  })
}

async function sendWithFetch(request: TransportRequest): Promise<{ status: number }> {
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([name]) => !unsafeHeaders.has(name.toLowerCase()))
  )
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers,
      body: request.body,
      signal: request.signal
    })
    request.onProgress(request.body.size)
    return { status: response.status }
  } catch (error) {
    if (request.signal.aborted) {
      throw aborted()
    }
    throw new BetterAppsClientError("NETWORK_ERROR", "The file couldn't be sent.", { status: 0, cause: error })
  }
}

const defaultTransport: UploadTransport = (request) =>
  typeof XMLHttpRequest === "undefined" ? sendWithFetch(request) : sendWithXhr(request)

/** A record's files in the server's order: by position, then when they were attached, then attachment id. */
function inServerOrder(files: readonly AttachedFile[]): AttachedFile[] {
  return [...files].sort(
    (a, b) =>
      a.position - b.position ||
      a.attachedAt.getTime() - b.attachedAt.getTime() ||
      (a.attachmentId < b.attachmentId ? -1 : 1)
  )
}

/**
 * A record's files in the order a reorder asked for, numbered from 0, with any it didn't name after them in the order
 * given. With no order, the files as given.
 */
function inOrder(files: AttachedFile[], order: readonly string[] | undefined): AttachedFile[] {
  if (!order) {
    return files
  }
  const rank = new Map(order.map((id, index) => [id, index]))
  const at = (file: AttachedFile, index: number) => rank.get(file.id) ?? order.length + index
  return files
    .map((file, index) => ({ file, rank: at(file, index) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ file }, position) => ({ ...file, position }))
}

/** Dates arrive as ISO strings; the store keeps `Date`s. */
function reviveFile<File extends FileInfo>(file: Serialized<File> | File): File {
  const date = (value: unknown) => (value === null || value === undefined ? null : new Date(value as string))
  const revived = {
    ...(file as object),
    createdAt: new Date((file as { createdAt: string }).createdAt),
    uploadedAt: date((file as { uploadedAt: unknown }).uploadedAt),
    expiresAt: date((file as { expiresAt: unknown }).expiresAt),
    urlExpiresAt: date((file as { urlExpiresAt: unknown }).urlExpiresAt)
  } as Record<string, unknown>
  if ("attachedAt" in (file as object)) {
    revived.attachedAt = new Date((file as { attachedAt: string }).attachedAt)
  }
  return revived as File
}

const clients = new WeakMap<object, AttachmentsClient>()

/**
 * Creates the attachments store for a Better Apps client. Pass `typeof app` as the client's type to get the app's
 * subject types. Each Better Apps client has one store, so calling this again with the same client, as the React hooks
 * do, returns the store already made.
 *
 * The store holds what the signed-in person could see. When someone else signs in without a page load, call `reset()`
 * or create a new Better Apps client.
 */
export function createAttachmentsClient<App = BetterApp>(
  client: BetterAppsClient<App>,
  options: AttachmentsClientOptions = {}
) {
  let attachments = clients.get(client)
  if (!attachments) {
    attachments = createAttachmentsClientFor((client as BetterAppsClient).$call, options)
    clients.set(client, attachments)
  }
  return attachments as unknown as AttachmentsClient<AppAttachmentsTypes<App>>
}

function createAttachmentsClientFor<Types extends AttachmentsTypes>(
  call: (feature: string, action: string, input: unknown, options: CallOptions) => Promise<unknown>,
  options: AttachmentsClientOptions
) {
  const store: Store<AttachmentsState> = createStore(empty)
  const transport = options.transport ?? defaultTransport
  let controller = new AbortController()
  const resetListeners = new Set<() => void>()
  const uploadControllers = new Map<string, AbortController>()
  // What the server last said about each record, in its order, kept up to date by this tab's writes once they're saved.
  // The store shows it with this tab's writes still under way on top: files being taken off are left out, and the latest
  // reorder's order is kept.
  const bases = new Map<string, AttachedFile[]>()
  // Each record's version goes up when a write starts and when it settles, and with every event, so an answer that went
  // out before one is dropped and loaded again.
  const versions = new Map<string, number>()
  // The order each record's reorders under way asked for, the latest last, so a load that lands meanwhile keeps it.
  const reordering = new Map<string, { order: readonly string[]; count: number }>()
  // A record's reorders go to the server one after another, so the order it keeps is the last one asked for.
  const reorderChains = new Map<string, Promise<unknown>>()
  const queued = new Map<string, Map<string, { resolve: () => void; reject: (error: unknown) => void }[]>>()
  let flushing: Promise<void> | null = null
  // Answers to calls made before a reset() belong to the previous person, so they change the store only in their
  // generation.
  let generation = 0
  const scoped = () => {
    const started = generation
    return () => started === generation
  }

  const run = <Output>(action: string, input: unknown) =>
    call("attachments", action, input, { signal: controller.signal }) as Promise<Output>
  const bump = (key: string) => versions.set(key, (versions.get(key) ?? 0) + 1)

  const setSubject = (key: string, change: (current: SubjectFiles) => SubjectFiles) =>
    store.setState((state) => {
      const current = state.subjects[key] ?? { files: [], state: "idle", error: null, pending: [] }
      return { ...state, subjects: { ...state.subjects, [key]: change(current) } }
    })
  /** Changes a record's entry, then shows the server's list for it with this tab's writes under way on top. */
  const refresh = (key: string, change: (subject: SubjectFiles) => Partial<SubjectFiles> = () => ({})) =>
    setSubject(key, (subject) => {
      const next = { ...subject, ...change(subject) }
      const files = (bases.get(key) ?? []).filter((file) => !next.pending.includes(file.id))
      return { ...next, files: inOrder(files, reordering.get(key)?.order) }
    })
  const setBase = (key: string, files: readonly AttachedFile[]) => bases.set(key, inServerOrder(files))
  const setUpload = (id: string, change: Partial<Upload>) =>
    store.setState((state) => {
      const current = state.uploads[id]
      return current ? { ...state, uploads: { ...state.uploads, [id]: { ...current, ...change } } } : state
    })

  async function loadList(subjectType: string, subjectIds: string[]) {
    const current = scoped()
    const started = new Map(subjectIds.map((id) => [id, versions.get(subjectKey(subjectType, id)) ?? 0]))
    for (const id of subjectIds) {
      setSubject(subjectKey(subjectType, id), (current) => ({ ...current, state: "loading", error: null }))
    }
    try {
      const answer = await run<Record<string, Serialized<AttachedFile>[]>>("listFiles", { subjectType, subjectIds })
      if (!current()) {
        return
      }
      const stale: string[] = []
      for (const id of subjectIds) {
        const key = subjectKey(subjectType, id)
        if ((versions.get(key) ?? 0) !== started.get(id)) {
          stale.push(id)
          continue
        }
        setBase(
          key,
          (answer[id] ?? []).map((file) => reviveFile<AttachedFile>(file))
        )
        refresh(key, () => ({ state: "ready", error: null }))
      }
      if (stale.length > 0) {
        await load(subjectType, stale)
      }
    } catch (error) {
      if (current()) {
        for (const id of subjectIds) {
          setSubject(subjectKey(subjectType, id), (subject) => ({ ...subject, state: "error", error: error as Error }))
        }
      }
      throw error
    }
  }

  /** Sends the loads asked for in this tick, 20 records a call per subject type. */
  async function flush() {
    await Promise.resolve()
    flushing = null
    const batches = [...queued]
    queued.clear()
    await Promise.all(
      batches.flatMap(([subjectType, waiting]) => {
        const ids = [...waiting.keys()]
        return Array.from({ length: Math.ceil(ids.length / pageSize) }, async (_, index) => {
          const page = ids.slice(index * pageSize, (index + 1) * pageSize)
          const settle = (outcome: "resolve" | "reject", error?: unknown) => {
            for (const id of page) {
              for (const waiter of waiting.get(id) ?? []) {
                if (outcome === "resolve") {
                  waiter.resolve()
                } else {
                  waiter.reject(error)
                }
              }
            }
          }
          await loadList(subjectType, page).then(
            () => settle("resolve"),
            (error: unknown) => settle("reject", error)
          )
        })
      })
    )
  }

  /** Loads records' files. Loads asked for in the same tick go out together. */
  function load(subjectType: Types["subjectType"], subjectIds: readonly string[]): Promise<void> {
    const waiting = queued.get(subjectType) ?? new Map()
    queued.set(subjectType, waiting)
    const done = Promise.all(
      [...new Set(subjectIds)].map(
        (id) =>
          new Promise<void>((resolve, reject) => {
            waiting.set(id, [...(waiting.get(id) ?? []), { resolve, reject }])
          })
      )
    ).then(() => undefined)
    flushing ??= flush()
    return done
  }

  /** Loads the limits for a subject type, or for files on their own without one. */
  async function loadSettings(subjectType?: Types["subjectType"]): Promise<AttachmentSettings> {
    const current = scoped()
    const settings = await run<AttachmentSettings>("getSettings", subjectType === undefined ? {} : { subjectType })
    if (current()) {
      store.setState((state) => ({ ...state, settings: { ...state.settings, [subjectType ?? ""]: settings } }))
    }
    return settings
  }

  /** Refuses a file the loaded limits don't allow, without a call. */
  function checkLocally(target: UploadTarget, contentType: string, size: number) {
    const settings = store.getSnapshot().settings[target.subjectType ?? ""]
    if (!settings) {
      return
    }
    if (!allowsType(settings.contentTypes, contentType)) {
      throw new BetterAppsClientError("INVALID_INPUT", `Files of type ${contentType} aren't allowed here.`, {
        status: 400
      })
    }
    if (size > settings.maxSize) {
      throw new BetterAppsClientError("PAYLOAD_TOO_LARGE", `Files here can be up to ${settings.maxSize} bytes.`, {
        status: 413
      })
    }
  }

  /**
   * The first step of an upload, for an engine that sends the bytes itself, such as UploadCN's: checks the file against
   * the loaded limits and asks the server where to send it. Send the bytes as `upload` says, then call `finishUpload`.
   */
  async function prepareUpload(
    file: Blob & { name?: string },
    target: UploadTarget<Types["subjectType"]>,
    { name = file.name ?? "file", signal }: { name?: string; signal?: AbortSignal } = {}
  ): Promise<PreparedUpload> {
    const contentType = cleanContentType(file.type) ?? "application/octet-stream"
    checkLocally(target, contentType, file.size)
    const created = await (call(
      "attachments",
      "createUpload",
      { ...target, name, contentType, size: file.size },
      { signal }
    ) as Promise<Serialized<CreateUploadResult>>)
    const upload = { ...created.upload, expiresAt: new Date(created.upload.expiresAt) }
    return { file: reviveFile<FileInfo>(created.file), upload, target }
  }

  /**
   * The last step of an upload: has the server check the bytes and mark the file ready. An upload onto a record adds the
   * file to the record's list.
   */
  async function finishUpload(prepared: PreparedUpload, { signal }: { signal?: AbortSignal } = {}): Promise<FileInfo> {
    const current = scoped()
    const { subjectType, subjectId } = prepared.target
    const key = subjectType !== undefined && subjectId !== undefined ? subjectKey(subjectType, subjectId) : null
    const started = key === null ? 0 : (versions.get(key) ?? 0)
    const completed = await (call("attachments", "completeUpload", { fileId: prepared.file.id }, { signal }) as Promise<
      Serialized<CompleteUploadResult>
    >)
    if (current() && completed.attachment && key !== null && subjectId !== undefined) {
      const changed = (versions.get(key) ?? 0) !== started
      bump(key)
      if (changed) {
        // The record changed while the upload finished, such as the file being taken off after a load showed it, so
        // this answer may be stale, and the record loads again instead.
        await load(subjectType as Types["subjectType"], [subjectId]).catch(() => undefined)
      } else {
        // At the place the server saved it, so the server's order shows whichever answer lands first.
        const attached = reviveFile<AttachedFile>(completed.attachment)
        setBase(key, [...(bases.get(key) ?? []).filter((item) => item.id !== attached.id), attached])
        refresh(key)
      }
    }
    return reviveFile<FileInfo>(completed.file)
  }

  /**
   * Starts uploading a file and returns its id in `uploads` at once, with `done` for the outcome. See `upload`.
   */
  function startUpload(
    file: Blob & { name?: string },
    target: UploadTarget<Types["subjectType"]>,
    { name = file.name ?? "file" }: { name?: string } = {}
  ): { id: string; done: Promise<FileInfo> } {
    const id = crypto.randomUUID()
    const done = sendUpload(id, file, target, name)
    // Callers that only watch the store still see the failure there.
    done.catch(() => undefined)
    return { id, done }
  }

  /**
   * Uploads a file: asks the server where to send it, sends the bytes with progress, and has the server check them. An
   * upload onto a record adds the file to the record's list. Resolves with the file, and rejects when it fails or is
   * cancelled, with the upload's `state` saying which.
   */
  async function upload(
    file: Blob & { name?: string },
    target: UploadTarget<Types["subjectType"]>,
    options: { name?: string } = {}
  ): Promise<FileInfo> {
    return startUpload(file, target, options).done
  }

  async function sendUpload(
    id: string,
    file: Blob & { name?: string },
    target: UploadTarget,
    name: string
  ): Promise<FileInfo> {
    const contentType = cleanContentType(file.type) ?? "application/octet-stream"
    const current = scoped()
    const entry: Upload = {
      id,
      name,
      contentType,
      size: file.size,
      loaded: 0,
      state: "uploading",
      error: null,
      file: null,
      target
    }
    store.setState((state) => ({ ...state, uploads: { ...state.uploads, [id]: entry } }))
    const own = new AbortController()
    uploadControllers.set(id, own)
    const signal = AbortSignal.any([own.signal, controller.signal])
    try {
      const prepared = await prepareUpload(file, target, { name, signal })
      setUpload(id, { file: prepared.file })
      const sent = await transport({
        url: prepared.upload.url,
        method: "PUT",
        headers: prepared.upload.headers,
        body: file,
        signal,
        onProgress: (loaded) => setUpload(id, { loaded })
      })
      if (sent.status < 200 || sent.status >= 300) {
        throw new BetterAppsClientError("UPLOAD_FAILED", "The file couldn't be stored. Try again.", {
          status: sent.status
        })
      }
      setUpload(id, { state: "finishing", loaded: file.size })
      const ready = await finishUpload(prepared, { signal })
      setUpload(id, { state: "done", file: ready })
      return ready
    } catch (error) {
      const cancelled = signal.aborted || (error instanceof BetterAppsClientError && error.code === "ABORTED")
      setUpload(id, { state: cancelled ? "cancelled" : "error", error: cancelled ? null : (error as Error) })
      // A cancelled upload the server knows of is deleted, so its row and any bytes don't wait for the sweep.
      const fileId = store.getSnapshot().uploads[id]?.file?.id
      if (cancelled && fileId && current()) {
        run("deleteFile", { fileId }).catch(() => undefined)
      }
      throw cancelled ? aborted() : error
    } finally {
      uploadControllers.delete(id)
    }
  }

  /** Stops an upload under way. */
  function cancel(uploadId: string) {
    uploadControllers.get(uploadId)?.abort()
  }

  /** Forgets finished, failed or cancelled uploads, such as once a composer is cleared. */
  function dismiss(uploadIds: readonly string[]) {
    store.setState((state) => {
      const uploads = { ...state.uploads }
      for (const id of uploadIds) {
        if (uploads[id]?.state !== "uploading" && uploads[id]?.state !== "finishing") {
          delete uploads[id]
        }
      }
      return { ...state, uploads }
    })
  }

  /** Puts drafts or files on their own on a record, then loads the record again. */
  async function attach(subject: Subject<Types["subjectType"]>, fileIds: readonly string[]) {
    const key = subjectKey(subject.subjectType, subject.subjectId)
    const current = scoped()
    bump(key)
    try {
      const { files } = await run<{ files: Serialized<AttachedFile>[] }>("attach", { ...subject, fileIds })
      return files.map((file) => reviveFile<AttachedFile>(file))
    } finally {
      if (current()) {
        bump(key)
        await load(subject.subjectType, [subject.subjectId]).catch(() => undefined)
      }
    }
  }

  /** Takes a file off a record. It goes at once, and comes back when the server refuses. */
  async function detach(subject: Subject<Types["subjectType"]>, fileId: string) {
    const key = subjectKey(subject.subjectType, subject.subjectId)
    const current = scoped()
    const settled = (entry: SubjectFiles) => ({ pending: entry.pending.filter((id) => id !== fileId) })
    bump(key)
    refresh(key, (entry) => ({ pending: [...entry.pending, fileId] }))
    try {
      await run("detach", { ...subject, fileId })
      if (current()) {
        setBase(
          key,
          (bases.get(key) ?? []).filter((file) => file.id !== fileId)
        )
        // A load still under way may have read the file before it came off, so its answer is dropped and it loads again.
        bump(key)
        refresh(key, settled)
      }
    } catch (error) {
      // Refused, the file shows again as the server last listed it.
      if (current()) {
        bump(key)
        refresh(key, settled)
      }
      throw error
    }
  }

  /** Puts a record's files in a new order at once, and back when the server refuses. */
  async function reorder(subject: Subject<Types["subjectType"]>, fileIds: readonly string[]) {
    const key = subjectKey(subject.subjectType, subject.subjectId)
    const current = scoped()
    reordering.set(key, { order: [...fileIds], count: (reordering.get(key)?.count ?? 0) + 1 })
    const settle = () => {
      const left = (reordering.get(key)?.count ?? 1) - 1
      if (left > 0) {
        reordering.set(key, { order: reordering.get(key)?.order ?? [], count: left })
      } else {
        reordering.delete(key)
      }
    }
    bump(key)
    refresh(key)
    // The signal is taken now, so a reorder still waiting its turn when reset() runs never goes out as the next person.
    const { signal } = controller
    const write = (reorderChains.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => call("attachments", "reorder", { ...subject, fileIds }, { signal }))
    reorderChains.set(key, write)
    try {
      await write
      if (current()) {
        // The server wrote every position, so its list is now in this order.
        setBase(key, inOrder(bases.get(key) ?? [], fileIds))
        settle()
        // A load still under way may have read the order from before the write, so its answer is dropped and it loads
        // again.
        bump(key)
        refresh(key)
      }
    } catch (error) {
      // Refused, the files show in the server's last order, or a later reorder's still under way, and load again.
      if (current()) {
        settle()
        bump(key)
        refresh(key)
        await load(subject.subjectType, [subject.subjectId]).catch(() => undefined)
      }
      throw error
    } finally {
      if (reorderChains.get(key) === write) {
        reorderChains.delete(key)
      }
    }
  }

  /** Deletes a file: a draft or upload of the caller's, or a file on its own, which comes off every record too. */
  async function deleteFile(fileId: string) {
    const current = scoped()
    await run("deleteFile", { fileId })
    if (!current()) {
      return
    }
    // Every loaded record drops it, and loads under way, which may have read it before it went, load again.
    for (const key of Object.keys(store.getSnapshot().subjects)) {
      bump(key)
      const files = bases.get(key)
      if (files?.some((file) => file.id === fileId)) {
        setBase(
          key,
          files.filter((file) => file.id !== fileId)
        )
        refresh(key)
      }
    }
  }

  /** Applies an event from `toClientEvent`, such as from a live updates feature, by loading the record again. */
  function applyEvent(event: ClientAttachmentEvent | null) {
    if (!event || event.type !== "subject.changed") {
      return
    }
    bump(subjectKey(event.subjectType, event.subjectId))
    load(event.subjectType, [event.subjectId]).catch(() => undefined)
  }

  /** The loaded records and limits, for a server render to send to the browser. */
  function dehydrate(): DehydratedAttachments {
    const { subjects, settings } = store.getSnapshot()
    // Through JSON on purpose, so dates become the strings a server render sends.
    // oxlint-disable-next-line unicorn/prefer-structured-clone
    return JSON.parse(JSON.stringify({ subjects, settings })) as DehydratedAttachments
  }

  /** Takes a server render's loads. */
  function hydrate(snapshot: DehydratedAttachments) {
    store.setState((state) => ({
      ...state,
      settings: { ...state.settings, ...(snapshot.settings as Record<string, AttachmentSettings>) }
    }))
    for (const [key, subject] of Object.entries(snapshot.subjects)) {
      setBase(
        key,
        (subject.files as unknown as Serialized<AttachedFile>[]).map((file) => reviveFile<AttachedFile>(file))
      )
      refresh(key, () => ({ state: subject.state, error: null, pending: subject.pending }))
    }
  }

  /**
   * Empties the store and cancels calls and uploads under way, such as when someone else signs in. They reject with an
   * `ABORTED` error. A call it can't cancel, such as `finishUpload` with a signal of its own, changes nothing when it
   * settles.
   */
  function reset() {
    generation += 1
    controller.abort()
    controller = new AbortController()
    // Loads asked for this tick haven't gone out yet, so they never do.
    const cancelled = new BetterAppsClientError("ABORTED", "The call was cancelled.", { status: 0 })
    for (const waiting of queued.values()) {
      for (const waiter of [...waiting.values()].flat()) {
        waiter.reject(cancelled)
      }
    }
    queued.clear()
    bases.clear()
    versions.clear()
    reordering.clear()
    reorderChains.clear()
    store.setState(empty)
    for (const listener of resetListeners) {
      listener()
    }
  }

  /** Runs a function after each `reset`. Returns a function that stops it. */
  function onReset(listener: () => void) {
    resetListeners.add(listener)
    return () => void resetListeners.delete(listener)
  }

  return {
    store,
    load,
    loadSettings,
    upload,
    startUpload,
    prepareUpload,
    finishUpload,
    cancel,
    dismiss,
    attach,
    detach,
    reorder,
    deleteFile,
    applyEvent,
    dehydrate,
    hydrate,
    reset,
    onReset
  }
}

/** The attachments client of a Better Apps client, from `createAttachmentsClient`. */
export type AttachmentsClient<Types extends AttachmentsTypes = AttachmentsTypes> = ReturnType<
  typeof createAttachmentsClientFor<Types>
>
