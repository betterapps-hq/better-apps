import type { Actor, SubjectArgs } from "better-apps"
import type { AttachmentFile } from "./schema.js"
import type { StorageAdapter, StoredBody } from "./storage.js"

/** Which files a record or a standalone upload takes. */
export interface FileLimits {
  /**
   * The media types allowed, exactly, such as `application/pdf`, or by kind, such as `image/*`. Any, by default.
   * Types are compared in lower case, without parameters.
   */
  contentTypes?: readonly string[] | undefined
  /** The largest file, in bytes. */
  maxSize?: number | undefined
}

/** How attachments work on one subject type, such as `invoice` or comments' `comments.comment`. */
export interface AttachmentRules extends FileLimits {
  /** Whether the actor can add files to a record, and reorder them. Everyone who can see the record, by default. */
  canUpload?: ((args: SubjectArgs) => boolean | Promise<boolean>) | undefined
  /** Whether the actor can take anyone's files off a record, such as an admin. Nobody, by default. */
  canModerate?: ((args: SubjectArgs) => boolean | Promise<boolean>) | undefined
  /** How many files one record holds, from 1 to 30. 10 by default. */
  maxFiles?: number | undefined
}

/** Who can upload and manage files that aren't on any record. */
export interface StandaloneRules extends FileLimits {
  /** Whether the actor can upload a file on its own. Everyone signed in, by default. */
  canUpload?: ((actor: Actor) => boolean | Promise<boolean>) | undefined
  /** Whether the actor can delete an organization's files. Every member, by default. */
  canManage?: ((args: { actor: Actor; orgId: string }) => boolean | Promise<boolean>) | undefined
}

/** What an image preview's `transform` receives. */
export interface PreviewArgs {
  file: AttachmentFile
  /** The stored image, with its body. */
  object: StoredBody
  /** The width asked for, snapped up to one of `widths`. */
  width: number
  request: Request
}

/** Image previews at a few widths, made by the app, such as with Cloudflare's Images binding. */
export interface PreviewOptions {
  /** The widths previews are made at, in pixels. A request's `?w=` is snapped up to the next one. */
  widths?: readonly number[] | undefined
  /** Makes the preview. Its response is served with the download's headers for caching and safety. */
  transform(args: PreviewArgs): Response | Promise<Response>
}

/** How attachments are set up in an app. */
export interface AttachmentsOptions {
  /** Where files' bytes are kept, such as `r2Storage({ bucket })` from `@better-apps/storage-r2`. */
  storage: StorageAdapter
  /** The subject types files can be attached to, keyed by name. The app or a feature declares each one. */
  subjects?: Readonly<Record<string, AttachmentRules>> | undefined
  /** Allows files on their own, with no record, such as a person's documents. Off without it. */
  standalone?: StandaloneRules | undefined
  /** The default media types for every subject type and standalone files. Any, by default. */
  contentTypes?: readonly string[] | undefined
  /** The default largest file, in bytes. 25 MiB by default. */
  maxSize?: number | undefined
  /** Where the upload and download routes are. `/api/apps/attachments` by default; follow the app's `basePath`. */
  path?: string | undefined
  /** The origin of the URLs actions return, such as for emails. Without it, they're paths on the same origin. */
  baseUrl?: string | undefined
  /**
   * Signs download URLs, so they work without the request's sign-in for a while, such as in `<img src>` with a bearer
   * token or a link in an email. Without it, downloads need the request's own sign-in.
   */
  secret?: string | undefined
  /** How long an upload URL works, in seconds. 15 minutes by default. */
  uploadTtl?: number | undefined
  /** How long a draft waits to be attached, in seconds. 24 hours by default. */
  draftTtl?: number | undefined
  /** How long a signed download URL works, in seconds. An hour by default. */
  downloadTtl?: number | undefined
  /** Image previews at a few widths. Without it, `?w=` is ignored and the original is served. */
  previews?: PreviewOptions | undefined
}

/** The types an app's options give attachments, for typed inputs. */
export interface AttachmentsTypes {
  subjectType: string
}

/** The types a set of options gives attachments. */
export interface TypesOf<Options extends AttachmentsOptions> {
  subjectType: keyof NonNullable<Options["subjects"]> & string
}

/** A record files are on. */
export interface AttachmentSubject<SubjectType extends string = string> {
  subjectType: SubjectType
  subjectId: string
}

/** Where an upload goes: onto a record, a draft for a record of one type, or on its own. */
export type UploadTarget<SubjectType extends string = string> =
  | AttachmentSubject<SubjectType>
  | { subjectType: SubjectType; subjectId?: undefined }
  | { subjectType?: undefined; subjectId?: undefined; owner?: "user" | "org" | undefined }

/** The input of `createUpload`. */
export type CreateUploadInput<SubjectType extends string = string> = UploadTarget<SubjectType> & {
  name: string
  contentType: string
  /** Bytes. */
  size: number
}

/** The input of `attach`. */
export interface AttachInput<SubjectType extends string = string> extends AttachmentSubject<SubjectType> {
  /** Up to `maxFiles`, added after the record's files in this order. */
  fileIds: readonly string[]
}

/** The input of `detach`. */
export interface DetachInput<SubjectType extends string = string> extends AttachmentSubject<SubjectType> {
  fileId: string
}

/** The input of `reorder`: every file on the record, in their new order. */
export interface ReorderInput<SubjectType extends string = string> extends AttachmentSubject<SubjectType> {
  fileIds: readonly string[]
}

/** The input of `listFiles`. */
export interface ListFilesInput<SubjectType extends string = string> {
  subjectType: SubjectType
  /** Up to 20. */
  subjectIds: readonly string[]
}

/** The input of `listOwnFiles`. */
export interface ListOwnFilesInput {
  /** The signed-in person's own files, or their organization's. */
  owner: "user" | "org"
  cursor?: string | undefined
  /** 20 by default, at most 50. */
  limit?: number | undefined
}
