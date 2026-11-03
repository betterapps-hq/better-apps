# Reuse and abstractions

## Apply DRY to shared knowledge

Before creating a component, hook, utility, or mock, search for an equivalent implementation and inspect its contract.
Reuse the existing behavior or extend it coherently. Do not create a near-copy because its name or location is
unfamiliar.

Share domain rules so one bug fix reaches every consumer. Distinguish genuinely repeated responsibility from code that
happens to look similar.

Bad — the page, dialog, and story each implement the same name validation differently:

```ts
// One consumer accepts spaces; another trims; a third has a different maximum.
const validInDialog = name.length > 0 && name.length < 80
const validOnPage = name.trim().length > 0 && name.length <= 80
```

Good — one domain function, used by every relevant consumer:

```ts
export function validateProjectName(name: string): string | undefined {
  const trimmed = name.trim()
  if (trimmed.length === 0) return "Enter a project name."
  if (trimmed.length > 80) return "Use 80 characters or fewer."
  return undefined
}
```

If an existing schema already owns this rule, use that schema instead of adding a second validator. The limit is
illustrative, not a universal product requirement.

## Avoid abstractions built around flags

Bad:

```tsx
<UniversalEditor kind="project" enableMembers disableInvoices useProjectValidation />
<UniversalEditor kind="invoice" disableMembers enableInvoices useMoneyValidation />
```

Good — separate responsibilities share only the stable common UI:

```tsx
<EditorLayout title="Edit project"><ProjectForm project={project} /></EditorLayout>
<EditorLayout title="Edit invoice"><InvoiceForm invoice={invoice} /></EditorLayout>
```

The layout can be shared while domain behavior remains independent. A finite semantic variant is not inherently wrong.
The warning sign is a growing set of switches that couples unrelated consumers and makes changes unsafe.

## Promote deliberately

Start a private `ProjectListItem` inside `ProjectList/components/`. Move it to feature components when multiple project
experiences need that same contract. Move to app-shared components only when it has a meaningful cross-feature role.
Shared workspace packages serve actual cross-application consumers.

Bad — putting everything in `shared/` because it might someday be useful.

Good — placing code beside its current owner and promoting it when real reuse establishes the boundary. Update consumers
to import the single implementation; do not retain a copied original.

## Reusable fixtures

Bad — copy the same HTTP response into every consumer.

Good — share fixtures and handler factories by domain. Factories create fresh data for each scenario so one test cannot
mutate another's fixture. Reuse definitions and behavior, not mutable singleton state.

Example fixture factory:

```ts
type Project = { id: string; name: string; members: string[] }

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Website",
    ...overrides,
    members: [...(overrides.members ?? [])]
  }
}
```

Use explicit distinct IDs when building lists. Copy nested mutable objects as needed; a shallow spread is not universal
isolation. Keep domain fixture factories centrally discoverable within their feature's testing folder.

Kent C. Dodds' [AHA Programming](https://kentcdodds.com/blog/aha-programming) supports choosing abstractions from
demonstrated commonality. Apply DRY to shared rules and responsibilities while avoiding premature coupling. Neither
“always abstract the second occurrence” nor “always duplicate until the third” is a useful universal threshold.
