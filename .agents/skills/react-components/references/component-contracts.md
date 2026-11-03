# Component contracts

## Declaration and children

Use a named function declaration and named export. Define `type ComponentNameProps` in the same file. Infer the return
type; annotate only for a concrete external contract or useful constraint. Avoid `React.FC`. Use type-only imports for
React types.

Bad — a component promises children it discards, with an unnecessary render annotation:

```tsx
import type { ReactElement, ReactNode } from "react"

type ProjectNameProps = { name: string; children?: ReactNode }

export const ProjectName = ({ name }: ProjectNameProps): ReactElement => {
  return <span>{name}</span>
}
```

Good — only declare supported inputs:

```tsx
type ProjectNameProps = { name: string }

export function ProjectName({ name }: ProjectNameProps) {
  return <span>{name}</span>
}
```

For content slots, use `ReactNode`. `ReactElement` is unnecessarily restrictive when text, arrays, or empty content are
valid. A required property does not guarantee visible output: `ReactNode` includes `null` and `undefined`. Validate more
narrowly only when required by the UX.

Good — a component that actually renders children:

```tsx
import type { ReactNode } from "react"

type PanelProps = { title: string; children: ReactNode }

export function Panel({ title, children }: PanelProps) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  )
}
```

Use `children?: ReactNode` when omission is supported. For a render callback, declare the function contract, such as
`children: (selectedId: string | null) => ReactNode`. Use `ReactElement` when the API genuinely requires an element. Do
not pretend a JSX children type reliably restricts callers to one particular component type.

## Valid modes

Bad — independent optional fields allow an editable field with no change handler:

```ts
type ProjectTitleProps = {
  title: string
  editable?: boolean
  onChange?: (title: string) => void
}
```

Good — each mode defines a complete contract:

```tsx
type ProjectTitleProps =
  | { mode: "read"; title: string }
  | { mode: "edit"; title: string; onChange: (title: string) => void }

export function ProjectTitle(props: ProjectTitleProps) {
  if (props.mode === "read") return <h1>{props.title}</h1>
  return (
    <label>
      Project title
      <input value={props.title} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  )
}
```

Ordinary independent options do not need a union. Destructure props when readable; retain the props object when it makes
narrowing clearer.

## Focused inputs and events

Bad — a display control depends on an API envelope and a store:

```ts
type ProjectCardProps = {
  response: ProjectsApiResponse
  store: ProjectStore
  index: number
}
```

Good — a stable domain summary and a meaningful event:

```ts
type ProjectSummary = { id: string; name: string; memberCount: number }
type ProjectCardProps = {
  project: ProjectSummary
  onOpen: (projectId: string) => void
}
```

Passing a meaningful domain object is fine; do not flatten every property into a separate prop. Name callback props
`onOpen` and local handlers `handleOpen`. Prefer action callbacks over exposing internal state setters. For native
wrappers, reuse appropriate React DOM prop types and omit conflicting props; consume custom props before spreading onto
DOM elements.

## Controlled values and drafts

Bad — copying a prop erases edits whenever fresh server data arrives:

```tsx
const [name, setName] = useState(project.name)
useEffect(() => setName(project.name), [project.name])
```

Good — a controlled input has one owner:

```tsx
<ProjectTitle mode="edit" title={draftName} onChange={setDraftName} />
```

An independent editor draft is also valid. Name its initial input `initialName`, initialize once, and explicitly decide
save, cancel, record-switch, and external-update behavior. A key based on record identity can reset the editor when
switching records; do not reset it on every refetch. Never switch between controlled and uncontrolled ownership
accidentally.

Source: [React TypeScript guidance](https://react.dev/learn/typescript). Named exports, type aliases, and return-type
inference are our conventions, not requirements imposed by React.
