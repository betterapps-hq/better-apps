import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { identity } from "./better-apps.server"

/** Who the page is for. */
export interface Viewer {
  id: string
  name: string | null
}

/** Reads who the request is for from the app's identity, or `null` when nobody is signed in. */
export const getViewer = createServerFn({ method: "GET" }).handler(async (): Promise<Viewer | null> => {
  const actor = await identity.getActor(getRequest())
  if (!actor) {
    return null
  }
  const [user] = (await identity.getUsers?.([actor.userId])) ?? []
  return { id: actor.userId, name: user?.name ?? null }
})
