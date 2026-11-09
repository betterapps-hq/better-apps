# AGENTS.md

## Permission to change guidance

Treat repository rules, agent instructions, skills, and best practices as read-only unless the user explicitly
authorizes a concrete change. This covers this rule itself, every `AGENTS.md` and `CLAUDE.md`, instructions loaded
from other files, and everything in [best-practices/](best-practices/README.md). It applies to creating, editing,
formatting, moving, renaming, and deleting protected files, including changes made by tools or scripts.

When permission is needed, show the proposed changes in a table with **File**, **Before**, and **After** columns.
Give the exact affected wording or paths, with a row for each change. For additions or deletions, mark the absent
side as “absent.” Ask for approval of that table and wait before applying it. If the user has already explicitly
authorized the concrete change, apply only that change. A feature request, review, or failing check does not authorize
changing the rules.

## Repository instructions

- Start at the [best-practices index](best-practices/README.md). For every code change, apply the
  [coding principles](best-practices/principles.md) and [conventions](best-practices/conventions.md).
- Check the [preferred tech stack](best-practices/tech-stack.md) and discuss new libraries before adding them.

## Copy and UX

- Review every new or changed user-facing string with at least one writing skill before opening a PR. Use
  [writing-style-guide](.agents/skills/writing-style-guide/SKILL.md) for interface text, including labels, errors,
  empty states, and accessible names. Use [copy-editing](.agents/skills/copy-editing/SKILL.md) for marketing copy.
  Apply [brand-voice](.agents/skills/brand-voice/SKILL.md) when shaping the voice or
  [deslopify-writing](.agents/skills/deslopify-writing/SKILL.md) when checking for formulaic phrasing.
- Avoid dot glyphs as visual separators.
- Exercise changed user workflows in the running app with the integrated browser. Check desktop and mobile layouts,
  keyboard use, and accessible names.

## Documentation and data

- Update product documentation alongside behavior changes. Keep each page focused on one topic. Review prose, evidence
  ledgers, status tables, and narrative records directly. Reserve executable tests for code and generated artifacts
  that affect behavior, fabrication, or an external interface.
- Treat stale prototype data as disposable. Only migrate or repair it on explicit request. Preserve integration
  credentials and unrelated external configuration during a data reset unless the user explicitly requests a full reset.

## Before opening a PR

- When the change is ready for review, run the relevant focused checks, fix related failures together, and run
  `pnpm verify`.
- Only bypass a Git hook with explicit user permission for an unrelated failure. Run focused checks on the files
  being committed and report the blocker and checks in the handoff.

# Project-specific guidance

Project-specific requirements below take precedence over shared recommendations when they differ.

# Better Apps agent guidance

Read [.github/copilot-instructions.md](.github/copilot-instructions.md) before changes. Use pnpm 12 on Node 24+, Vite+
(`vp` for lint, format, type checks, tests and tasks), native TypeScript, and knip. Run `pnpm verify` before finishing;
never bypass Git hooks.

Put worktrees under `D:\system\worktrees\better-apps\<name>`. Remove worktrees and merged branches when done.

# Better Apps monorepo guidelines

A Vite+ and pnpm monorepo of Better Apps packages: app features with their own tables, actions and events. See
[README.md](README.md) for what each package is for and the [docs index](docs/README.md) for the rest.

## Tooling (differs from common defaults)

- **Toolchain:** [Vite+](https://viteplus.dev) (`vp`), set up as a monorepo. Lint and format config lives only in the
  root `vite.config.ts`; packages keep their own `vitest.config.ts`. `vp lint` runs Oxlint, `vp fmt` runs Oxfmt, and
  `vp check` runs both plus type checks, from the root.
- **Type-check:** `vp check` type-checks every workspace with the pinned native TypeScript; packages build with `tsc`.
- **Test:** Vitest through `vp test`, importing from `vite-plus/test`.
- **Package manager:** pnpm (`>=12`) on Node `>=24`, enforced through root `engines` and `engine-strict`.
- **Task runner:** `vp run`, which runs workspace scripts in dependency order and caches them with `--cache`.

## Build and verify loop

Complete the coherent implementation before running tests, type checks, lint or the full verification suite. Then run
the smallest relevant focused checks, then `pnpm verify`. It checks format, lint, types, unused code, API reports, test
coverage and builds.

Git hooks (Vite+, in `.vite-hooks/`): **pre-commit** runs `vp staged`; **pre-push** runs `pnpm check`. Do not bypass
them with `--no-verify`.

## Workspace layout

- `packages/core`, `packages/features`, `packages/adapters`, `packages/integrations`, `packages/tooling`: published
  packages, grouped by role. An adapter's name starts with the slot it fills, such as `identity-` or `database-`.
- `apps/example`: the example app.
- `internal/`: private shared config and repo tools (`@repo/typescript-config`, `@repo/oxlint-config`,
  `@repo/api-tools`). Never published.

## Documentation

- Document only current behavior. Do not add migration guides or comparisons with earlier implementations.
- Keep this file brief and link to `docs/` pages and package docs instead of duplicating them.
- Update docs and the [index](docs/README.md) in the same change as the behavior they describe.

## Product copy

Never use a dot glyph, including `·` or `•`, as a visual separator.

## Gotchas

- **Never edit files under a `src/vendor/` folder.** They are upstream copies regenerated by a sync script, and a test
  fails after hand edits. See [vendored Better Auth source](packages/tooling/cli/docs/vendoring.md).
- Forked upstream code, such as the Drizzle adapter, is owned code: edit it normally. Its `upstream.json` tracks the
  upstream files, and `pnpm --filter @better-apps/database-drizzle upstream:changes` reports fixes to port. See
  [forked Better Auth source](packages/adapters/database-drizzle/docs/fork.md).

## Principles

- Prefer correctness over expediency or backwards compatibility. Unreleased packages may change directly.
- Do not create version-suffixed files, symbols, schemas, routes or APIs such as `V2` or `legacy`, or compatibility
  aliases. Keep one canonical implementation, and fix forward.
- Introducing a library that isn't already used needs a human discussion, not a silent add.
