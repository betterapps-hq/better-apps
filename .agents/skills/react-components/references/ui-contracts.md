# UI contracts

## Semantic controls

Use semantic HTML and the selected UI system's accessible primitives. Prefer existing dialogs, menus, comboboxes, and
disclosure components over hand-building keyboard and focus behavior. Respect the product surface's styling system and
tokens.

Bad — mouse-only action with no native keyboard behavior:

```tsx
<div onClick={handleCreate}>Create project</div>
```

Good:

```tsx
<button type="button" onClick={handleCreate}>
  Create project
</button>
```

Use links for navigation and buttons for actions. Use the project's router link for internal navigation. Set
`type="button"` for buttons inside forms that must not submit. Icon-only controls need an accessible name; icons alone
do not supply a reliable one.

Bad:

```tsx
<input placeholder="Project name" value={name} onChange={handleNameChange} />
```

Good:

```tsx
<label>
  Project name
  <input value={name} onChange={handleNameChange} />
</label>
```

For separate label/control elements, use stable unique IDs rather than a hardcoded ID repeated across instances.
Associate validation messages with their fields and communicate invalid state. Preserve visible focus. For dialogs, use
the existing primitive's focus containment, dismissal, and focus-return behavior.

## Resilient content

Do not implement only the ideal design data. Consider long and short text, zero/one/many records, missing optional
fields, loading, empty, errors, retries, disabled and pending actions, and narrow layouts.

Bad — a fixed-width row assumes every title fits and every project has an owner:

```tsx
<div className="w-80 flex">
  <span>{project.name}</span>
  <span>{project.owner.name}</span>
</div>
```

Good — a utility-class example for a surface using that styling system:

```tsx
<div className="flex min-w-0 flex-wrap gap-2">
  <span className="min-w-0 break-words">{project.name}</span>
  <span>{project.owner?.name ?? "Unassigned"}</span>
</div>
```

Use actual layout requirements to decide wrapping, truncation, scrolling, or virtualization. Do not truncate essential
information without a way to access it. Do not introduce Tailwind into a different styling system merely to copy this
example. Use shared tokens rather than arbitrary repeated colors and spacing.

## State ownership and recovery

Bad — passing `value` sometimes and `defaultValue` other times, or mirroring a controlled field into unrelated local
state.

Good — document and keep one ownership mode for a component instance. Use the project's form library and schema
integration where established. Keep validation and submission logic out of low-level display controls.

Place error boundaries at meaningful recovery boundaries so one failed section need not erase the entire app. Use the
application's established root providers and error handling in stories/tests as appropriate. Error boundaries handle
render failures; event handlers and async operations need their own error paths. Do not show a success state before the
operation actually succeeds.

Avoid separately implemented mobile and desktop component trees when responsive layout can serve the same experience.
Preserve semantics, content, and behavior across modes. Distinct workflows may require distinct components, but screen
size alone should not produce duplicate business logic.
