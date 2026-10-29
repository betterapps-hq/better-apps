import { getRouteApi } from "@tanstack/react-router"

const root = getRouteApi("__root__")

/** Who the page is for, from the root route's loader, or `null` when nobody is signed in. */
export function useViewer() {
  return root.useLoaderData()
}
