# React

Conventions for authoring React components in this monorepo. Hooks have their own page — see [hooks.md](hooks.md).

## Components

- **Define components as function declarations**, not arrow consts (use an arrow only for `forwardRef` wrappers).
  **Never use `React.FC`.**
- **Prop types are named `{ComponentName}Props`** and live in the component's `.tsx` file.
- **Omit explicit return types** — let inference handle the render type.
- **The React Compiler is on** — do **not** hand-write `useMemo`/`useCallback`/`React.memo` for performance. Follow the
  Rules of React so the compiler can memoize safely.
- **Name event handlers** with an `on` prefix (`onClick`) or a `handle` prefix (`handleClick`).
- **Wrap every app in `<StrictMode>` and a top-level `react-error-boundary`.** Add the provider required by that app's
  selected UI system, such as `FluentProvider` for Fluent UI. Wrap stories and tests with the same shell so every
  surface shares context.
- **Choose the UI system at the app or product-surface boundary.** Fluent UI v9 and shadcn/ui are both allowed for apps
  and product surfaces designed around them. Keep one coherent component system within a product surface unless an
  explicit integration requires otherwise.

## Styling

- **Follow the selected UI system's styling model.** Fluent surfaces use griffel `makeStyles()` and Fluent tokens;
  shadcn/ui surfaces use Tailwind CSS and their CSS-variable token layer. Define shared visual values as tokens rather
  than scattering hardcoded colors or spacing. Apply the app's global reset and base styles once at its root.
- **Put styles in `{ComponentName}.styles.ts`** and export a hook named `use{ComponentName}Styles()`; name the result
  `classes` at the call site.

## State, errors & URL

- **Wrap error-prone subtrees in [`react-error-boundary`](https://github.com/bvaughn/react-error-boundary).**
- **Read/write URL state with [`nuqs`](https://nuqs.dev)** rather than hand-parsing `location.search`.
- **Routing is type-safe via [TanStack Router](https://tanstack.com/router)** — register the router type and prefer the
  router's `<Link>` (it validates `to` and preloads on intent).
- Use [TanStack Form](https://github.com/TanStack/form/tree/main/packages/react-form) with Zod schemas for validation.
- On Fluent surfaces, use `form.Field` to bind the control's value and change and blur handlers. Use Fluent `Field`
  for its label and validation message.
- **Use the selected UI system's feedback and dialog primitives.** On Fluent surfaces, use Toasts for transient action
  feedback, reserve Message Bars for persistent inline status, and use Fluent `Dialog` for modals rather than building
  ad hoc global state for them.

For component file layout (`{ComponentName}.tsx` / `.styles.ts` / `.utils.ts` / `.test.tsx` / `.stories.tsx`), see
[conventions.md](conventions.md#files--component-layout).
