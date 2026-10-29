# @better-apps/react

Binds a [Better Apps](../better-apps/README.md) client and its stores to React. It adds no UI and needs no data-fetching
library; feature packages build their hooks on it, such as
[`@better-apps/comments/react`](../comments/README.md#in-the-browser).

## Usage

```tsx
import { BetterAppsProvider, useBetterApps, useStore } from "@better-apps/react"
import { createBetterAppsClient, type BetterAppsClient } from "better-apps/client"
import type { app } from "./server/app"

const client = createBetterAppsClient<typeof app>()

export function App() {
  return (
    <BetterAppsProvider client={client}>
      <Notes />
    </BetterAppsProvider>
  )
}

function Notes() {
  const client = useBetterApps<BetterAppsClient<typeof app>>()
  // Call client.notes.add(...) from an event handler.
}
```

## Behavior

- `useBetterApps()` returns the provider's client, and throws without a provider.
- `useStore(store)` reads a store from `createStore` through `useSyncExternalStore`, so it works with server rendering
  and concurrent rendering.
- `useStore(store, select, isEqual)` re-renders only when the selection changes. The selection is cached per state, so a
  selector may build new objects; `isEqual` also keeps it across states that select equal values.
