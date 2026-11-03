# Project structure

## Feature ownership and colocation

Organize by feature. Keep code that changes together nearby. This layout describes the inside of an application; a
monorepo may put it under `apps/<app>/src` and share cross-app components through packages. Follow existing framework
route discovery instead of imposing a second routing tree.

```text
src/
  app/
    App.tsx
    providers/
      AppProviders.tsx
    routes/
      projects.tsx
  features/
    projects/
      pages/
        ProjectsPage/
          ProjectsPage.tsx
          ProjectsPage.stories.tsx
          ProjectsPage.test.tsx
          components/
            ProjectsToolbar.tsx
      components/
        ProjectList/
          ProjectList.tsx
          ProjectList.stories.tsx
          ProjectList.test.tsx
          ProjectList.utils.ts
          useProjectSelection.ts
          useProjectSelection.test.ts
          components/
            ProjectListItem.tsx
        ProjectStatusBadge.tsx
      hooks/
        useProjects.ts
      api/
        projects.ts
      testing/
        projectFixtures.ts
        projectHandlers.ts
  shared/
    components/
      EmptyState/
        EmptyState.tsx
        EmptyState.stories.tsx
        EmptyState.test.tsx
    hooks/
      useOnlineStatus.ts
    utils/
      formatDate.ts
      formatDate.test.ts
    testing/
      renderWithProviders.tsx
      server.ts
```

Create only the directories and files the feature needs. This is an ownership example, not a scaffold requiring every
component to have a hook, utility, story, stylesheet, and test.

## Placement rules

| Code                                          | Location                        |
| --------------------------------------------- | ------------------------------- |
| App composition, providers, route integration | `app/`                          |
| Actual production page                        | Feature `pages/`                |
| Component used only inside one owner          | Owner's `components/` subfolder |
| Component shared within one feature           | Feature `components/`           |
| Component shared across features              | `shared/components/`            |
| Hook private to a component                   | Beside it as `useName.ts`       |
| Hook shared within a feature                  | Feature `hooks/useName.ts`      |
| Hook shared across features                   | `shared/hooks/useName.ts`       |
| Non-render component helper                   | `ComponentName.utils.ts`        |
| Domain fixtures and HTTP handler factories    | Feature `testing/`              |
| General test infrastructure                   | `shared/testing/`               |

Use one component per file and PascalCase component filenames. Keep its `ComponentNameProps` type in the component file.
Use purpose-named `useName.ts` files, one hook per file; do not use `ComponentName.hooks.ts` aggregators. Use camelCase
for ordinary utilities and services.

Put multi-file components in a matching folder. A standalone `ProjectStatusBadge.tsx` does not need an otherwise empty
folder. Rename component, companion files, and folder together. Colocate `.stories.tsx` and `.test.tsx`; pure tests use
`.test.ts`. Add `ComponentName.styles.ts` when the selected styling system warrants it, not when utility classes already
suffice.

## Dependency direction

App composition can import features and shared modules. Features can import shared modules. Shared modules must not
import app or feature implementations. Avoid reaching into another feature's private component folders; place genuinely
shared behavior at the appropriate common boundary.

Bad:

```ts
// shared/components/EmptyState.tsx
import { useProjectsStore } from "@/features/projects/state/projectsStore"
```

Good — the feature supplies the dependency through props:

```tsx
<EmptyState title="No projects" action={<CreateProjectButton />} />
```

Avoid broad barrel files; a leaf folder re-exporting its own component may be useful. Prefer established aliases over
chains of `../../../`. Do not introduce a generic `utils/` dumping ground for unrelated domain behavior.

## Routes and pages

Keep route integration in the route module. Render the feature's page component there and let the page own its layout
and section composition.

## Central mocks without a giant global file

Keep domain factories and handlers discoverable under feature `testing/`; compose them in shared test setup. Search
there before adding another mock. Share response factories across stories and tests. Production modules must never
import testing or story modules. Scenario overrides belong at the consuming story/test boundary, not in mutable global
defaults.

Basis: Kent C. Dodds' [Colocation](https://kentcdodds.com/blog/colocation). Exact paths, hook filenames, and dependency
boundaries are our conventions, not a prescribed Kent folder template.
