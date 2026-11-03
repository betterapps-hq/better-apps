# Component boundaries

## Extract responsibilities

Keep one React component per file. Rendering helpers are components in `.tsx` files, not hidden JSX factories in
`.utils.ts`. Private components belong in the owner's `components/` folder.

At roughly 100–150 lines, review responsibilities. Sprawling components that coordinate unrelated work must be
decomposed. A long, straightforward declarative layout is different from intertwined state and effects. Do not extract
every wrapper to satisfy a numeric limit.

Bad — one page owns unrelated selection, invitations, and uploads:

```tsx
export function ProjectsPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [inviteEmail, setInviteEmail] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const projects = useProjects()
  const invite = useInviteMember()
  const upload = useUploadFiles()
  return (
    <main>
      <ProjectList projects={projects} selectedIds={selectedIds} onSelectionChange={setSelectedIds} />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          invite(inviteEmail)
        }}
      >
        <label>
          Email
          <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
        </label>
        <button>Invite</button>
      </form>
      <input type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
      <button onClick={() => upload(files)}>Upload</button>
    </main>
  )
}
```

Good — each production component owns its cohesive UX and associated behavior:

```tsx
import { FileUploadPanel } from "./components/FileUploadPanel"
import { InviteMemberForm } from "./components/InviteMemberForm"
import { ProjectsSection } from "./components/ProjectsSection"

export function ProjectsPage() {
  return (
    <main>
      <ProjectsSection />
      <InviteMemberForm />
      <FileUploadPanel />
    </main>
  )
}
```

The child implementations move out of the page; they are not copied. If two sections need coordinated selection, retain
that state at their nearest common owner rather than giving each an inconsistent copy.

## JSX variables are a signal

Bad — an increasingly complex chunk hides a distinct feature inside the parent:

```tsx
const invitePanel = (
  <section>
    <h2>Invite members</h2>
    <InviteForm onSubmit={submitInvite} error={inviteError} pending={invitePending} />
    <InvitationList invitations={invitations} onRevoke={revokeInvitation} />
  </section>
)
```

Good — extract its rendering and behavior together:

```tsx
<InvitationsPanel projectId={projectId} />
```

A simple expression such as `const label = pending ? 'Saving' : 'Save'` or a small JSX value passed to an API is fine.
Extract when a meaningful responsibility emerges, not whenever a variable contains JSX.

## Stable identity

Bad — defining a component inside its parent creates a different component type on each render:

```tsx
export function ProjectPage() {
  function SearchField() {
    const [query, setQuery] = useState("")
    return <input aria-label="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
  }
  return <SearchField />
}
```

Good — define `SearchField` in its own file and import it. Its state then follows the component's position and key
instead of a recreated function type.

Bad:

```tsx
projects.map(ProjectCard)
```

Good:

```tsx
projects.map((project) => <ProjectCard key={project.id} project={project} />)
```

React must call the component so it can own hook state and identity.

## Composition instead of unrelated flags

Bad:

```tsx
<Panel isProject isEditable showMembers hideFooter useCompactHeader />
```

Good:

```tsx
<Panel title="Project" actions={<EditProjectButton projectId={project.id} />}>
  <ProjectMembers projectId={project.id} />
</Panel>
```

Slots should express useful extension points, not turn a simple component into a configurable framework. A small
semantic variant such as `size="compact"` is reasonable.

## Choose slots, named variants, or shared context

**Slot.** In the panel above, the caller already knows which action to render. Give `Panel` an `actions?: ReactNode`
slot and a `children: ReactNode` body. The panel owns placement. The edit button owns the interaction. A render callback
earns its place when the component must supply data, as in `renderRow(member)`.

**Named variant.** If every invitation panel needs the same title, form, and pending invitations, passing those pieces
separately at every call site duplicates a product decision. Flags such as
`<Panel inviteMode showPending showInviteForm />` also permit combinations the product never uses. Give that composition
a name and reuse the panel underneath:

```tsx
type InvitationsPanelProps = { projectId: string }

export function InvitationsPanel({ projectId }: InvitationsPanelProps) {
  return (
    <Panel title="Invitations">
      <InviteMemberForm projectId={projectId} />
      <PendingInvitations projectId={projectId} />
    </Panel>
  )
}
```

**Shared context.** Suppose a bulk-edit variant lets callers arrange a toolbar, a filter, and a member list. The toolbar
must act on the exact selection shown by the rows. Calling `useMemberSelection()` separately in each part gives each its
own selection. When the owner renders both parts directly, pass the selected IDs and actions as props. When callers
compose the parts at different depths, use a provider scoped to this panel:

```tsx
<MemberSelectionProvider>
  <Panel title="Members" actions={<BulkMemberActions />}>
    <MemberFilter />
    <SelectableMemberList members={members} />
  </Panel>
</MemberSelectionProvider>
```

Here the provider calls the selection hook once and exposes `selectedIds`, `toggle(id)`, and `clear()` through context.
Rows read selection and call `toggle`. The toolbar reads the same IDs and clears them after a successful operation. The
filter only narrows the rendered list. Two panels can mount separate providers and select independently.

Sources: Kent C. Dodds on
[component decomposition](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components) and
[rendering component functions](https://kentcdodds.com/blog/dont-call-a-react-function-component). The line-count review
signal and one-component-per-file rule are our conventions; Kent favors extraction in response to real problems.
