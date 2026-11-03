# Coding Conventions

These conventions apply to TypeScript and React code.

## Toolchain

Use Vite+ as the primary toolchain and pnpm for dependencies and workspaces.
Migration is pending; use existing repository scripts until Vite+ is configured.

| Command | Purpose |
| --- | --- |
| `vp dev` | Development server |
| `vp build` | Application build |
| `vp pack` | Library packaging |
| `vp test` | Tests |
| `vp check` | Formatting, linting, and type checks |
| `vp check --fix` | Apply formatting and lint fixes |
| `vp run <task>` | Repository scripts and task workflows |

- Use `vp` in package scripts; use `pnpm exec vp` from a shell without the global CLI.
- Define lint and formatting policy in the root `vite.config.ts`. Enable `lint.options.typeAware` and
  `lint.options.typeCheck` for type checks.
- Keep shared TypeScript and Storybook configuration in workspace packages. Configure builds and tests in the owning workspace.
- Define task dependencies and caching explicitly. Keep Knip for unused-code checks.
- Use Vite+ hooks in `.vite-hooks/`. Configure staged-file checks and hooks according to the quality gates below.

## Quality gates

- Complete a coherent change before running checks. Run focused checks, then the required verification gate.
- Pre-commit hooks run only quick checks: formatting and linting on staged files. Exclude type checking and tests.
- Pre-push hooks run longer checks, including unit tests and type checking.
- Keep very long or disruptive checks, including Storybook interaction tests and end-to-end tests, out of hooks and
  required local verification. Local runs are optional; these checks can run in CI.
- Read the owning workspace's scripts and documentation for verification requirements. Confirm the root gate covers it.
- Across local gates and CI, cover formatting, lint, types, unused-code checks, coverage, required builds, and integration checks.
- Keep coverage thresholds passing. Preserve specialized checks when migrating tooling.
- Don't bypass Git hooks with `--no-verify` without explicit user permission.

## TypeScript & type helpers

Read [typescript.md](typescript.md) for type conventions and existing helpers before writing a new type helper.

## Hooks

Read [hooks.md](hooks.md) for hook conventions and the `@mantine/hooks` catalog before writing a new hook.

## React

When writing, refactoring, or reviewing React components or hooks, apply
[react-components](../.agents/skills/react-components/SKILL.md). Read [react.md](react.md) for the project's compiler,
UI system, styling, and library conventions.

## Storybook

When creating or reviewing stories, translating designs into stories, or configuring previews and visual modes, apply
[storybook-development](../.agents/skills/storybook-development/SKILL.md).

## Imports & exports

- Prefer named exports.
- Avoid barrel files, except a leaf folder re-exporting its own component or resource.
- Extend shared configuration instead of duplicating rules per package.
- Prefer path or package aliases over deep relative paths (`../../../`).

## Logging

- Only `console.warn` and `console.error` are allowed in product code. Remove temporary debug logging.

## Tests

- When writing or reviewing unit tests or Storybook interaction tests, read and apply
  [test-quality](../.agents/skills/test-quality/SKILL.md).
- Hold tests to the same quality standards as production code.
- Co-locate tests with source. Use `*.test.tsx` for JSX tests and `*.test.ts` otherwise.
- Keep stories in `*.stories.tsx`; run story tests through `@storybook/addon-vitest` with Playwright.
- Use `@testing-library/user-event` for interactions. Query by role or text, not implementation details.
- Mock only what is necessary. Prefer real collaborators over fully mocked units.

<a id="files--component-layout"></a>

## Files & component layout

Split a component by concern so the `.tsx` stays focused on rendering:

| File                          | Holds                                                                    |
| ----------------------------- | ------------------------------------------------------------------------ |
| `{ComponentName}.tsx`         | The component **and** its `{ComponentName}Props` type                    |
| `{ComponentName}.styles.ts`   | Griffel styles for Fluent components; omit when utility classes suffice |
| `useName.ts`                  | One purpose-named hook per file, beside its component when private       |
| `{ComponentName}.utils.ts`    | Non-render helpers and logic                                             |
| `{ComponentName}.test.tsx`    | Tests (`.tsx` when they render JSX, otherwise `{ComponentName}.test.ts`) |
| `{ComponentName}.stories.tsx` | Storybook stories                                                        |

- Use PascalCase for component files and camelCase for utilities, hooks, and services.
- Put multi-file components in a folder named after the component. Single-file components need no folder.
- Rename the component, its files, and its folder together.
