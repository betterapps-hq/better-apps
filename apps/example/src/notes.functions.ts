import { createServerFn } from "@tanstack/react-start"
import { api } from "./better-apps.server"

/** Lists notes as the user of the request being served. */
export const listNotes = createServerFn({ method: "GET" }).handler(() => api.notes.list())
