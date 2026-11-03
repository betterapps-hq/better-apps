# Hooks and logic

## Extract cohesive behavior

Complicated state transitions, subscriptions, and interaction logic belong in purpose-named hooks. Keep logic for one
task together. A hook need not have multiple consumers to justify an extraction that clarifies responsibility.

Use one hook per `useName.ts` file, colocated inside the component folder when private. Do not create
`ComponentName.hooks.ts` collections. Check existing project hooks and installed library hooks first. Use their APIs
instead of reinventing equivalent behavior.

Bad — unrelated responsibilities have merely moved behind a short component:

```tsx
const {
  projects,
  files,
  inviteEmail,
  query,
  setFiles,
  setInviteEmail,
  setQuery,
  uploadFiles,
  inviteMember,
  deleteProject
} = useProjectsPageLogic()
```

Good — separate responsibilities at the UI boundary, and extract meaningful hook APIs within those components:

```tsx
const { selectedIds, toggle, clear } = useProjectSelection()
```

Example `useProjectSelection.ts`:

```ts
import { useState } from "react"

export function useProjectSelection() {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clear() {
    setSelectedIds(new Set())
  }

  return { selectedIds, toggle, clear }
}
```

This is an instructional implementation; reuse an existing selection hook if its behavior fits. Each call owns separate
state. Calling this hook independently in a toolbar and list does not connect them: call once in their shared owner and
pass the result or use an appropriate scoped store.

Expose purposeful operations, not a bag of internal setters. Keep related transitions atomic with a reducer when several
fields must change consistently. For async hooks, define idle/pending/success/error behavior and handle stale results,
cleanup, and retries according to the operation.

## Pure functions are not hooks

Bad — a hook prefix implies React behavior where there is none:

```ts
export function useProjectMatches(name: string, query: string) {
  return name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
}
```

Good — a pure utility can be reused in React and outside it:

```ts
export function projectMatches(name: string, query: string) {
  return name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
}
```

Keep one ordinary helper near its only consumer if that is clearer; use a component `.utils.ts` or feature utility file
when it warrants separation. Do not make trivial utilities merely to reduce line count.

## Hoist safely

Bad — recreating an independent helper inside the component:

```tsx
export function ProjectCount({ count }: { count: number }) {
  function formatCount(value: number) {
    return value === 1 ? "1 project" : `${value} projects`
  }
  return <span>{formatCount(count)}</span>
}
```

Good — move `formatCount` to module scope or a nearby utility and keep `ProjectCount` focused on rendering. Keep
handlers that depend on current props/state inside, or pass those inputs explicitly to a pure helper.

Bad — module state leaks across component instances and potentially server requests:

```ts
const selectedIds = new Set<string>()
```

Good — initialize mutable instance data with `useState` or `useRef` according to whether updates should render.
Immutable configuration can live at module scope. Values that depend on locale, theme, credentials, request context, or
current props must retain the correct scope.

## Purpose instead of lifecycle wrappers

Bad — hiding dependencies inside `useMount(callback)` encourages stale closures.

Good — `useOnlineStatus` owns the browser subscription, snapshot, and cleanup, or reuse the existing equivalent. A hook
name should communicate the capability, not when an arbitrary callback happens to run. Call hooks at the top level
according to React's rules; do not invoke them in conditional branches or event handlers.

Source: [React: reusing logic with custom hooks](https://react.dev/learn/reusing-logic-with-custom-hooks).
