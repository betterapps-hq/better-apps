# Rendering and effects

## Events and effects have different jobs

Use event handlers for user-triggered actions. Use effects for synchronization with external systems. Compute render
data directly instead of creating effect-driven copies. Keep rendering pure; never mutate props, state, or external
systems while rendering.

Bad — a flag indirectly triggers a user action and makes retries harder to reason about:

```tsx
const [shouldSave, setShouldSave] = useState(false)
useEffect(() => {
  if (shouldSave) saveProject(draft)
}, [shouldSave, draft])
return <button onClick={() => setShouldSave(true)}>Save</button>
```

Good — the action is explicit, with pending and failure behavior:

```tsx
const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")

async function handleSave() {
  setStatus("saving")
  try {
    await saveProject(draft)
    setStatus("idle")
  } catch {
    setStatus("error")
  }
}

return (
  <>
    <button disabled={status === "saving"} onClick={handleSave}>
      {status === "saving" ? "Saving" : "Save"}
    </button>
    {status === "error" && <p role="alert">Could not save the project. Try again.</p>}
  </>
)
```

In production, reuse the existing mutation/form mechanism when it already supplies this lifecycle. Error boundaries do
not replace handling rejected event-handler promises.

Bad:

```tsx
const [total, setTotal] = useState(0)
useEffect(() => setTotal(items.reduce((sum, item) => sum + item.price, 0)), [items])
```

Good:

```tsx
const total = items.reduce((sum, item) => sum + item.price, 0)
```

## Cleanup and stale results

Bad — changing projects accumulates listeners:

```tsx
useEffect(() => {
  projectEvents.subscribe(projectId, handleUpdate)
}, [projectId, handleUpdate])
```

Good — for an API whose `subscribe` returns an unsubscribe function:

```tsx
useEffect(() => {
  return projectEvents.subscribe(projectId, handleUpdate)
}, [projectId, handleUpdate])
```

Adapt cleanup to the actual API; DOM listeners require `removeEventListener` with the corresponding listener/options.
Keep dependencies truthful. Do not suppress dependency checks to make an effect run once.

When a manual async effect is genuinely needed, prevent stale requests overwriting current data. This excerpt assumes
`loadProject(id, { signal })` supports cancellation:

```tsx
useEffect(() => {
  const controller = new AbortController()
  let active = true
  setState({ status: "pending" })

  loadProject(projectId, { signal: controller.signal }).then(
    (project) => {
      if (active) setState({ status: "success", project })
    },
    (error: unknown) => {
      if (active) setState({ status: "error", error })
    }
  )

  return () => {
    active = false
    controller.abort()
  }
}, [projectId])
```

Prefer the established data layer over recreating caching, cancellation, and retry policies in each component. Cleanup
should tolerate setup/cleanup/setup cycles in Strict Mode. A “has run” ref that merely hides repeated setup is not a
cleanup fix.

## Identity and immutable updates

Bad:

```tsx
projects.sort(compareProjects)
return projects.map((project) => <ProjectRow key={Math.random()} project={project} />)
```

Good:

```tsx
const sortedProjects = projects.toSorted(compareProjects)
return sortedProjects.map((project) => <ProjectRow key={project.id} project={project} />)
```

Do not use array indexes as keys for records that can reorder, insert, or delete. Use deliberate keys when changing
identity should reset a component. If state must survive hiding or unmounting a section, place it in an owner with the
necessary lifetime.

## Optimization

Follow the actual compiler configuration. In compiler-enabled projects, do not routinely add `memo`, `useMemo`, or
`useCallback` for performance. Keep React's purity and hook rules intact so optimization is safe. Do not assume every
project importing this skill enables the compiler.

Bad — wrapping every trivial calculation and event handler without evidence.

Good — keep ordinary calculations and handlers readable; profile a real slow interaction, then address the measured
work. Appropriate fixes may include state colocation, reducing data processed, virtualization, or an evidenced
optimization supported by the project. Memoization is not a correctness guarantee or storage mechanism.

## Load a heavy component when the user opens it

A project page displays a description to every visitor. Only editors who choose **Edit description** need the rich-text
editor. A static import brings the editor into the page's module dependencies even when JSX hides it:

```tsx
// Bad for this optional, heavy control: conditional rendering alone doesn't defer the import.
import { DescriptionEditor } from "./DescriptionEditor"

// Inside the component:
return editing ? <DescriptionEditor projectId={projectId} /> : <button onClick={startEditing}>Edit description</button>
```

Use a dynamic import at module scope with React's `lazy`. Map the named export to the shape React expects. The first
render of the editor starts loading its module. Keep the loading boundary close to the editor so the rest of the page
stays usable.

```tsx
import { lazy, Suspense, useState } from "react"

const LazyDescriptionEditor = lazy(() =>
  import("./DescriptionEditor").then(({ DescriptionEditor }) => ({ default: DescriptionEditor }))
)

type EditDescriptionProps = { projectId: string }

export function EditDescription({ projectId }: EditDescriptionProps) {
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)}>
        Edit description
      </button>
    )
  }
  return (
    <Suspense fallback={<p role="status">Loading editor…</p>}>
      <LazyDescriptionEditor projectId={projectId} />
    </Suspense>
  )
}
```

Use the app's error boundary for a failed module load. Check the production build or network trace: opening the page
should leave the editor chunk unloaded, and choosing Edit should request it. A static import elsewhere on the initial
path can defeat the split. Keep small controls and content needed on first paint eager.

Sources: [React effects guidance](https://react.dev/learn/you-might-not-need-an-effect),
[React Compiler](https://react.dev/learn/react-compiler/introduction).
