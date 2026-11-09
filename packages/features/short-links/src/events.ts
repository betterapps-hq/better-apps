import { defineEvent } from "better-apps"
import type { ShortLink } from "./link.js"
import type { OwnerType } from "./options.js"

/** The events short links emit. Opening a link emits none. */
export const shortLinkEvents = {
  "link.created": defineEvent<{ link: ShortLink }>(),
  "link.updated": defineEvent<{ link: ShortLink }>(),
  "link.removed": defineEvent<{ link: ShortLink }>(),
  /** A record's links were removed, such as after the record was deleted. */
  "subject.removed": defineEvent<{ subjectType: string; subjectId: string; removed: number }>(),
  /** A person's or an organization's links were removed. */
  "owner.removed": defineEvent<{ owner: { type: OwnerType; id: string }; removed: number }>()
}

/** The data of each short links event, by type. */
export type ShortLinksEventData = {
  [Type in keyof typeof shortLinkEvents]: (typeof shortLinkEvents)[Type] extends { "~data"?: infer Data }
    ? NonNullable<Data>
    : never
}
