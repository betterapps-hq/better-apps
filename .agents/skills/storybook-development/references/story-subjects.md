# Pages, sections, and controls

Start from the route or the design. Identify the production component that owns the layout users will see. A story of a
composition renders the component that owns that composition. This also applies to a dashboard combining independently
developed controls.

## A design arrives before the app exists

**Bad.** This story becomes the only implementation of the design. The route author has to reconstruct the layout and
remember which permission controls the action.

```tsx
export const Overview = {
  render: () => (
    <main className="workspace">
      <ProjectHeader title="Website" />
      <div className="columns">
        <ProjectActivity items={recentActivity} />
        <MemberList members={members} />
      </div>
      <button onClick={() => alert("Invite")}>Invite member</button>
    </main>
  )
}
```

**Good.** Build the real `ProjectOverviewPage` in application source, including its layout, permission checks, and
invitation action. Render it through the same interface in both places. In this example the route supplies the ID and
the story supplies the same input.

```tsx
// Route
return <ProjectOverviewPage projectId={params.projectId} />
```

```tsx
// ProjectOverviewPage.stories.tsx
import type { Meta, StoryObj } from "@storybook/react-vite"
import { projectOverviewHandlers } from "../../testing/projectHandlers"
import { ProjectOverviewPage } from "./ProjectOverviewPage"

const meta = {
  component: ProjectOverviewPage,
  args: { projectId: "website" },
  parameters: { msw: { handlers: projectOverviewHandlers("website") } }
} satisfies Meta<typeof ProjectOverviewPage>

export default meta
type Story = StoryObj<typeof meta>
export const Overview: Story = {}
```

The handler factory above represents the project's shared test support. If the real page reads route params, register it
at the matching path in the preview router and supply the initial URL. Preserve its production interface. A support-only
prop such as `storybookProjectId` would introduce a separate path through the page.

## Choose subjects at each level

| Subject                                                 | What the story should reveal                                           | Bad substitute                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| Each actual page                                        | How its sections fit together with route data, shell, and real actions | A “page” story that arranges individual section stories |
| A meaningful section, such as `MemberList`              | How the section handles zero, one, or many members independently       | Rendering the entire page to inspect a single list      |
| A meaningful subsection or control, such as `MemberRow` | How a long name, missing avatar, or disabled action fits               | Recreating a row with divs in the story                 |

Put each subject's stories beside its implementation. A private subsection can still have stories. Use typed args for a
component that already accepts data. Prefer the default render when args are enough so controls and scenario overrides
reach the real component.

## Where a wrapper helps

**Bad.** A story-only sidebar, grid, and toolbar around `MemberList` duplicate the page whose layout the team wants to
review.

**Good.** A decorator can constrain width when reviewing the list inside a sidebar-sized space. If reviewers need to
inspect the sidebar itself, make the real sidebar the subject of its own story.

```tsx
decorators: [
  (Story) => (
    <div style={{ maxWidth: "24rem" }}>
      <Story />
    </div>
  )
]
```

Use shared decorators for recurring context. Keep application imports pointing toward production code. Stories, fixture
modules, and preview setup stay outside the application's import graph.
