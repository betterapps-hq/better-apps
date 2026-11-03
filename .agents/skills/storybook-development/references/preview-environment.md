# Preview environment and data

A page can import exactly the right component and still render differently because its environment differs. Check the
shell and data path before adding CSS or special props to “fix” its story.

## Supply the application's environment

**Bad.** The page story sets an approximate font, reimplements the navigation bar, and hardcodes the light palette. The
real app applies a reset, loads a different font, and supplies spacing and color tokens from its UI provider.

**Good.** Load the same base stylesheet and font assets in the preview. Use the app's provider composition and connect
its theme input to Storybook's theme global. Register the matching route, parameters, and initial location for routed
subjects. Render the real app shell when its navigation or content area affects the page under review. For isolated
controls, supply the providers and arrangement they actually require.

```tsx
// Preview decorator excerpt. AppPreviewEnvironment is shared preview support
// that mounts the project's providers with isolated router and data clients.
;(Story, context) => (
  <AppPreviewEnvironment
    key={context.id}
    theme={context.globals.theme}
    initialUrl={context.parameters.initialUrl ?? "/"}
  >
    <Story />
  </AppPreviewEnvironment>
)
```

The wrapper name and parameter are illustrative. Reuse the project's existing decorator where available. Create
per-mount mutable clients inside the wrapper. Strictly scoping a wrapper cannot isolate a singleton cache imported at
module scope. Check a direct story URL as well as navigation from another story.

## Exercise the connected page through its real requests

**Bad.** A story replaces `useMembers` with a fake hook, copies the endpoint's JSON inline, or branches to sample data
inside the production page. Such a preview can pass even if the page cannot consume the server response.

**Good.** Search feature testing support and shared MSW setup before creating a fixture or handler. Put reusable domain
factories in one discoverable location. Let story-specific setup supply the data for this case. The real page still
selects loading, empty, error, and success UI.

```tsx
// CSF excerpts. Assume the preview's MSW loader is configured.
// Each factory builds a fresh response with the application's wire format.
export const EmptyWorkspace: Story = {
  parameters: { msw: { handlers: [membersHandler([])] } }
}

export const TeamWithLongNames: Story = {
  parameters: {
    msw: {
      handlers: [
        membersHandler([
          makeMember({ id: "m1", name: "Alexandria Hernández-Watanabe" }),
          makeMember({ id: "m2", name: "Jo Li" })
        ])
      ]
    }
  }
}
```

Reuse baseline handlers for unrelated requests. Override only the resource the scenario changes using the project's
handler composition. For a presentational list that accepts members as props, pass the same fresh fixtures as args. It
needs no artificial HTTP dependency.

## Keep scenarios independent

**Bad.** A retry handler closes over a module-level attempt counter. After a reviewer clicks Retry once, opening the
story again starts on the success screen. A shared query cache may hide the failure altogether.

**Good.** In the story's per-run setup, create a fresh handler instance that fails its first request and succeeds on
retry. Give the preview a fresh cache and store. Reset runtime handler overrides and clean up owned subscriptions,
timers, and seeded storage on teardown. Reuse fixture and handler _definitions_ across stories and tests. Scope mutable
state to the run.

Check that opening the failure story directly, revisiting it after success, and rerunning it all start at the failure
state. Use the project's established isolation hooks. Avoid clearing unrelated browser storage or depending on the order
the runner discovers stories.
