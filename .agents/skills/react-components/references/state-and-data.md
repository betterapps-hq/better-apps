# State and data

## Pick an owner

Keep state as close as possible to the consumers that must coordinate. Lift it to the nearest common owner when needed.
Separate server data, URL state, form drafts, and transient UI state instead of copying all of them into a global store.

| Need                                                                       | Starting choice                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------- |
| One component's disclosure, selection, or draft                            | Local state or an existing local hook             |
| Nearby components coordinating                                             | State in their common owner, passed through props |
| Wrapper forwarding unrelated data through many layers                      | Consider composition first                        |
| Shared dependency across a meaningful subtree                              | Scoped context                                    |
| Shared client state across distant consumers, with selective subscriptions | Existing store such as Zustand                    |
| Shareable filters, sorting, pagination, navigation                         | Project's URL-state and routing tools             |
| Remote resource cache, loading, refetching, mutation                       | Existing server-data layer                        |
| Integration with an external mutable source                                | Existing adapter or `useSyncExternalStore`        |

Depth alone does not decide the tool. Do not introduce context merely to pass a prop one layer, or force many layers of
irrelevant forwarding when composition/context would clarify ownership.

Bad — global state for one panel:

```tsx
const open = useAppStore((state) => state.projectsHelpOpen)
const setOpen = useAppStore((state) => state.setProjectsHelpOpen)
```

Good — keep local interaction state local:

```tsx
const [open, setOpen] = useState(false)
```

A global panel opened from multiple independent areas can legitimately have shared ownership. Decide from behavior, not
from the control's appearance.

## Connected and presentational components

Connected components coordinate external data, routing, mutations, or application services. Presentational components
render explicit inputs and may own local UI behavior. Presentational does not mean stateless. Do not force a
container/view pair when it only adds indirection.

Bad — a page fetches projects, billing, notifications, and invitations and threads every result through unrelated
children.

Good — connected sections own distinct data responsibilities:

```tsx
export function WorkspacePage() {
  return (
    <main>
      <ProjectsSection />
      <BillingSummary />
      <InvitationsPanel />
    </main>
  )
}
```

Example `ProjectsSection.tsx` using an existing data hook:

```tsx
export function ProjectsSection() {
  const query = useProjects()
  if (query.status === "pending") return <ProjectsSkeleton />
  if (query.status === "error") return <ProjectsError onRetry={() => query.refetch()} />
  return <ProjectList projects={query.data} />
}
```

Keep orchestration above these sections when they truly share transactions, coordinated state, or a single resource.
Avoid accidental duplicate requests; reuse the project's cache/data layer. Do not make every leaf independently
connected just to eliminate props.

## Start independent requests together

A project overview needs activity and members. Both reads take the project ID. In the page's data loader, awaiting
activity first makes the member list wait for a response it never uses.

```ts
// Bad: the second request starts only after the first finishes.
const activity = await loadActivity(projectId)
const members = await loadMembers(projectId)
```

```ts
// Good: both requests start immediately. This overview needs both results.
export async function loadProjectOverview(projectId: string) {
  const [activity, members] = await Promise.all([loadActivity(projectId), loadMembers(projectId)])
  return { activity, members }
}
```

Start the reads through the project's existing data layer, outside the component's render body. `Promise.all` waits for
both and rejects if either fails. If the sections can render or retry independently, mount both connected sections as
siblings and let each consume its own query, loading state, and error state. Avoid mounting the members section only
after activity succeeds. Keep a real dependency sequential: if loading members requires a team ID from the project
response, obtain that ID first.

## Composition before pass-through plumbing

Bad — `WorkspaceLayout` and `SidebarFrame` forward `project`, `onSelect`, and `selectedId` without using them.

Good — their owner supplies the composed UI:

```tsx
<WorkspaceLayout sidebar={<ProjectNavigation projects={projects} onSelect={handleSelect} />}>
  <ProjectDetails project={selectedProject} />
</WorkspaceLayout>
```

For context, scope providers to the relevant subtree, separate unrelated domains, and expose a purpose-named consumer
hook. Use an undefined default and a helpful missing-provider error when there is no valid default. Do not hide a broken
provider arrangement behind dummy values.

```ts
// useProjectContext.ts
import { useContext } from "react"
import { ProjectContext } from "./ProjectContext"

export function useProjectContext() {
  const value = useContext(ProjectContext)
  if (value === undefined) throw new Error("useProjectContext requires ProjectProvider")
  return value
}
```

Do not treat context as automatically global. With Zustand, select needed values rather than subscribing every consumer
to the entire store. Avoid constructing a fresh aggregate selector result unless the project's store API provides the
needed equality/stability behavior. `useSyncExternalStore` is a low-level subscription bridge; use a maintained library
integration where available, and honor stable snapshot and server-rendering contracts when implementing one.

## Derive values

Bad — redundant state requires every mutation path to keep a count synchronized:

```tsx
const [selectedIds, setSelectedIds] = useState<string[]>([])
const [selectedCount, setSelectedCount] = useState(0)
useEffect(() => setSelectedCount(selectedIds.length), [selectedIds])
```

Good:

```tsx
const [selectedIds, setSelectedIds] = useState<string[]>([])
const selectedCount = selectedIds.length
```

Likewise derive filtered results, totals, and validity where practical. An intentional snapshot or editable draft is
different from a computed value; make its lifecycle explicit.

## Model transitions

Bad — independently maintained flags permit contradictory states:

```ts
type UploadState = { isLoading: boolean; isSuccess: boolean; isError: boolean }
```

Good — a discriminated union carries the data appropriate to each state:

```ts
type UploadState =
  | { status: "idle" }
  | { status: "uploading"; progress: number }
  | { status: "success"; fileId: string }
  | { status: "error"; message: string }
```

Use a reducer when multiple transitions or dependent fields need one clear update path. A simple `isOpen` boolean is
appropriate. Do not rewrap a data library's existing state model merely to match this example; background fetching and
existing successful data may legitimately coexist.

Sources: Kent C. Dodds on [application state](https://kentcdodds.com/blog/application-state-management-with-react),
[context](https://kentcdodds.com/blog/how-to-use-react-context-effectively),
[derived state](https://kentcdodds.com/blog/dont-sync-state-derive-it), and
[status flags](https://kentcdodds.com/blog/stop-using-isloading-booleans). Store selection is our architectural
guidance, not an endorsement attributed to Kent.
