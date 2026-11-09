# Storybook interaction tests

## Choose a user scenario

A `play` function should protect an interaction or state transition. Static stories remain valuable for documentation and visual review without artificial interaction assertions. Keep logic permutations in unit tests; add stories for the UI behavior those tests cannot observe.

Examples below assume the current Storybook interaction API. Use the project's framework-specific `Meta` and `StoryObj` imports and component definitions. Imports for assertions and spies come from `storybook/test`.

## Exercise the component through its UI

```ts
// Bad: brittle selector and no demonstrated outcome.
play: async ({ canvasElement }) => {
  canvasElement.querySelector('.primary-button')?.dispatchEvent(new MouseEvent('click'))
}

// Good: accessible action and observable expanded state.
play: async ({ canvas, userEvent }) => {
  const toggle = canvas.getByRole('button', { name: 'Delivery details' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(toggle)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(canvas.getByRole('region', { name: 'Delivery details' })).toBeVisible()
}
```

Prefer roles and accessible names; use labels for inputs. Test IDs are acceptable for elements without a useful semantic query. Do not add inappropriate roles just to satisfy a test. Scope ordinary queries to `canvas`; use `within(canvasElement.ownerDocument.body)` deliberately for portalled dialogs or menus and ensure cleanup.

Await interactions and Storybook assertions. Use `findBy*` or `waitFor` for asynchronous changes instead of sleeps. Use `step` to explain meaningful stages of a longer scenario, not to narrate every click.

## Test the public callback through an interaction

```ts
// Bad: directly calling the callback bypasses the component entirely.
play: async ({ args }) => {
  args.onSave({ title: 'Release notes' })
  await expect(args.onSave).toHaveBeenCalled()
}

// Good: SaveDraft emits the documented payload after user input.
args: { onSave: fn() },
play: async ({ args, canvas, userEvent }) => {
  await userEvent.type(canvas.getByRole('textbox', { name: 'Title' }), 'Release notes')
  await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
  await expect(args.onSave).toHaveBeenCalledExactlyOnceWith({ title: 'Release notes' })
}
```

Callback assertions are valid when the callback is the component's public output. For a composed screen, also check visible completion or failure instead of stopping at an internal callback.

## Check errors and recovery

```ts
// Bad: a disabled control alone does not show validation worked.
await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled()

// Good: for a form that validates on submission, show the error and recover.
await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
await expect(await canvas.findByRole('alert')).toHaveTextContent('Title is required')
await userEvent.type(canvas.getByRole('textbox', { name: 'Title' }), 'Release notes')
await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
await expect(await canvas.findByRole('status')).toHaveTextContent('Draft saved')
```

These are different assertions, not a requirement that every form permit empty submission. Match the component's contract. A disabled-button assertion is sufficient when enablement is the behavior being tested.

Use MSW for API-backed stories. Configure a deterministic failure, assert the error and retained input, then exercise Retry against a success response using the project's mock integration. Keep handlers and mutable state local to the story. Never rely on a previously opened story to configure the network.

## Cover keyboard and focus where they matter

For dialogs, menus, and forms, test relevant keyboard activation, focus entry, Escape behavior, and focus restoration. Assert the focus outcome rather than an implementation's event listener calls. Interaction checks complement accessibility audits; neither proves complete accessibility.

## Keep appearance and behavior distinct

Use visual checks for clipping, layout, and styling. Avoid CSS-class or DOM-tree assertions as substitutes for visual tests. Accessible attributes such as expanded or selected state can be behavioral contracts and are appropriate assertions.

Keep stories independently runnable and replayable. Restore handlers, spies, storage, and globals through the project's lifecycle setup. Do not hide flaky interactions with retries. Local execution is optional under the repository's policy; this skill does not add browser tests to hooks or required local gates.
