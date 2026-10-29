import { createServerFn } from "@tanstack/react-start"
import { BetterAppsError } from "better-apps"
import { api } from "./better-apps.server"
import type { Note } from "./features"

/** Lists notes as the user of the request being served, or `null` when nobody is signed in. */
export const listNotes = createServerFn({ method: "GET" }).handler(async (): Promise<Note[] | null> => {
  try {
    return await api.notes.list()
  } catch (error) {
    if (error instanceof BetterAppsError && error.code === "UNAUTHENTICATED") {
      return null
    }
    throw error
  }
})
