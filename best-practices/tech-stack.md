# Preferred Tech Stack

The tools we reach for **first**. Prefer them before introducing an alternative for the same job.

> **Deviating from this list requires a discussion with a human.** If a task seems to need a library that isn't here (or
> a different one than what's listed), raise it — in the issue or PR — and get agreement before adding it. Don't
> silently swap in a different tool.

Agents must follow the [permission rule](../AGENTS.md#permission-to-change-guidance) before editing this guide.

## Developer experience

- Use [Node.js](https://github.com/nodejs/node) LTS for local tooling.
- [Vite+](https://github.com/voidzero-dev/vite-plus) is the primary toolchain. Use `vp` to run workspace tasks, start dev servers, build, test, lint, and format.
- Use [`@buildkitgg/dev-domains`](https://github.com/betterapps-hq/buildkit/tree/main/packages/tooling/dev-domains) by default for local dev servers. It discovers servers and gives each Git worktree predictable HTTPS URLs through Portless.
- [pnpm](https://github.com/pnpm/pnpm) manages dependencies, workspaces, and shared version catalogs.
- Use [TypeScript](https://github.com/microsoft/TypeScript) for application and library code.
- Use [`@buildkitgg/oxlint-config`](https://github.com/betterapps-hq/buildkit/tree/main/packages/tooling/oxlint-config) as the shared lint configuration for Vite+. It includes BuildKit’s anti-slop rules.
- Use [Vite+](https://github.com/voidzero-dev/vite-plus) for Git hooks and `vp staged` for pre-commit checks. Follow the [quality gates](conventions.md#quality-gates) for what runs in each hook.
- [Knip](https://github.com/webpro-nl/knip/tree/main/packages/knip) finds unused files, dependencies, and exports.
- [Dependabot](https://github.com/dependabot/dependabot-core) opens dependency update pull requests.
- [Beachball](https://github.com/microsoft/beachball/tree/main/packages/beachball) manages change files, package versions, changelogs, and releases.

## Backend / full-stack

- Use [TanStack Start](https://github.com/TanStack/router/tree/main/packages/react-start) by default for full-stack React apps. It supports server-side rendering and server functions.

## Library authoring

- Scaffold a library with `vp create vite:library`. Build it with `vp pack`.
- See [Developer experience](#developer-experience) for versioning and releases.

## CLI tooling

For building command-line tools.

- [citty](https://github.com/unjs/citty) — define CLI commands, parse arguments, and load subcommands on demand.
- [@clack/prompts](https://github.com/bombshell-dev/clack/tree/main/packages/prompts) — interactive prompts.
- [picocolors](https://github.com/alexeyraspopov/picocolors) — terminal colors.
- Use [Ink](https://github.com/vadimdemedes/ink) to build interactive terminal screens with React.
- Use [c12](https://github.com/unjs/c12) when a CLI needs to load a project configuration file.

## Testing

| Task | Preferred tools |
| --- | --- |
| Unit tests | Run [Vitest](https://github.com/vitest-dev/vitest/tree/main/packages/vitest) through [Vite+](https://github.com/voidzero-dev/vite-plus). Use [`@vitest/coverage-v8`](https://github.com/vitest-dev/vitest/tree/main/packages/coverage-v8) for coverage. |
| React component tests | Render with [`@testing-library/react`](https://github.com/testing-library/react-testing-library) in [`happy-dom`](https://github.com/capricorn86/happy-dom), drive interactions with [`@testing-library/user-event`](https://github.com/testing-library/user-event), and assert DOM state with [`@testing-library/jest-dom`](https://github.com/testing-library/jest-dom). |
| API mocking | Use [MSW](https://github.com/mswjs/msw) to intercept requests. Use `createApiMock` from [`@buildkitgg/api-mocker`](https://github.com/betterapps-hq/buildkit/tree/main/packages/tooling/api-mocker) to share endpoint mocks between unit tests and Storybook. |
| [Storybook](https://github.com/storybookjs/storybook) | Start React and Vite stories with [`@buildkitgg/storybook-config`](https://github.com/betterapps-hq/buildkit/tree/main/packages/tooling/storybook-config). Its shared configuration includes the Vitest, accessibility, and Chromatic addons. |
| Visual regression | Use [Chromatic](https://github.com/chromaui/chromatic-cli) to compare snapshots and publish Storybook. |
| End-to-end tests | Exercise user workflows with [`@playwright/test`](https://github.com/microsoft/playwright/tree/main/packages/playwright-test) and check accessibility with [`@axe-core/playwright`](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright). |

## Core libraries

- [zod](https://github.com/colinhacks/zod) — schema validation (Standard Schema; powers forms + env parsing).
- [@t3-oss/env-core](https://github.com/t3-oss/t3-env/tree/main/packages/core) — type-safe environment variables.
- In apps, import shared helpers and types from [`@buildkitgg/typescript-utils`](https://github.com/betterapps-hq/buildkit/tree/main/packages/core/typescript-utils). Set up its `/reset` entry in the app’s TypeScript configuration. Published libraries should import the upstream helpers directly to avoid changing consumers’ global types.
- [es-toolkit](https://github.com/toss/es-toolkit) — general runtime helpers.
- [ts-extras](https://github.com/sindresorhus/ts-extras) — typed built-ins and narrowing helpers.
- [type-fest](https://github.com/sindresorhus/type-fest) — compile-time utility types such as `SetRequired` and `PartialDeep`.
- [ts-reset](https://github.com/total-typescript/ts-reset) — stricter built-in typings for apps. Keep global type changes out of published libraries.
- [ts-pattern](https://github.com/gvergnaud/ts-pattern) — pattern matching and exhaustive handling of unions.
- [date-fns](https://github.com/date-fns/date-fns) — date utilities.
- [@mantine/hooks](https://github.com/mantinedev/mantine/tree/master/packages/@mantine/hooks) — React hooks catalog.
- [react-error-boundary](https://github.com/bvaughn/react-error-boundary) — error boundaries · [nuqs](https://github.com/47ng/nuqs/tree/next/packages/nuqs) — type-safe URL state.
- [@tanstack/react-router](https://github.com/TanStack/router/tree/main/packages/react-router) — type-safe routing. Preferred setup: [@tanstack/router-plugin](https://github.com/TanStack/router/tree/main/packages/router-plugin) (Vite, file-based
  routes) + [router-devtools](https://github.com/TanStack/router/tree/main/packages/react-router-devtools). _(This repo currently uses code-based routes; move to the plugin when routes grow.)_
- [TanStack Form](https://github.com/TanStack/form/tree/main/packages/react-form) — React forms. Pass Zod schemas directly to form or field validators.
- [@tanstack/react-hotkeys](https://github.com/TanStack/hotkeys/tree/main/packages/react-hotkeys) — keyboard shortcuts (or `useHotkeys` from [`@mantine/hooks`](https://github.com/mantinedev/mantine/tree/master/packages/@mantine/hooks)).

## UI & components

- Use [shadcn/ui](https://github.com/shadcn-ui/ui) with [`@buildkitgg/shadcn-baseui-nova`](https://github.com/betterapps-hq/buildkit/tree/main/packages/shadcn/shadcn-baseui-nova) as the default style. Install it under the `@buildkitgg/shadcn-baseui-kit` alias so app components and BuildKit adapters share the same kit.
- Load one reset. With Tailwind 4, import the kit’s `tailwind.css` alongside Tailwind. Without Tailwind, use the kit’s compiled `styles.css`, which includes Preflight. If the app supplies its own reset, use `styles-no-reset.css`. Use [the-new-css-reset](https://github.com/elad2412/the-new-css-reset) only when neither the kit nor the app loads Preflight or another reset.
- Use [Recharts](https://github.com/recharts/recharts) for charts.

| Need | BuildKit packages |
| --- | --- |
| Persistent inline alerts | [`@buildkitgg/react-alerts`](https://github.com/betterapps-hq/buildkit/tree/main/packages/react/react-alerts) manages alert state. [`@buildkitgg/shadcn-alerts-manager`](https://github.com/betterapps-hq/buildkit/tree/main/packages/shadcn/shadcn-alerts-manager) renders the alerts. |
| Modals | [`@buildkitgg/react-modals`](https://github.com/betterapps-hq/buildkit/tree/main/packages/react/react-modals) manages typed modal state and results. [`@buildkitgg/shadcn-modals-manager`](https://github.com/betterapps-hq/buildkit/tree/main/packages/shadcn/shadcn-modals-manager) renders the dialogs. |
| Themes | [`@buildkitgg/react-theme`](https://github.com/betterapps-hq/buildkit/tree/main/packages/react/react-theme) manages theme state. [`@buildkitgg/shadcn-theme`](https://github.com/betterapps-hq/buildkit/tree/main/packages/shadcn/shadcn-theme) applies it to shadcn surfaces. |
| User preferences | [`@buildkitgg/react-preferences`](https://github.com/betterapps-hq/buildkit/tree/main/packages/react/react-preferences) manages user preferences. |
| App configuration | [`@buildkitgg/react-configuration`](https://github.com/betterapps-hq/buildkit/tree/main/packages/react/react-configuration) provides typed configuration and developer overrides. |
| URL-driven tabs and panels | Use [`@buildkitgg/react-routing`](https://github.com/betterapps-hq/buildkit/tree/main/packages/react/react-routing) with the adapter for the app’s router, either [`@buildkitgg/tanstack-router`](https://github.com/betterapps-hq/buildkit/tree/main/packages/react/tanstack-router) or [`@buildkitgg/react-router`](https://github.com/betterapps-hq/buildkit/tree/main/packages/react/react-router). |
| Shared component runtime | [`@buildkitgg/shadcn-runtime`](https://github.com/betterapps-hq/buildkit/tree/main/packages/shadcn/shadcn-runtime) supplies localization, text direction, and class merging for BuildKit’s shadcn components. |

## Markdown & rich text

Built on the [unified](https://github.com/unifiedjs/unified) ([remark](https://github.com/remarkjs/remark) + [rehype](https://github.com/rehypejs/rehype)) ecosystem — the standard for parsing and transforming Markdown/HTML.

- [react-markdown](https://github.com/remarkjs/react-markdown) — render Markdown as React components (no `dangerouslySetInnerHTML`); the default for showing
  Markdown content.
- [remark-rehype](https://github.com/remarkjs/remark-rehype) + [rehype-react](https://github.com/rehypejs/rehype-react) — build a custom Markdown→React pipeline directly on [unified](https://github.com/unifiedjs/unified) when
  [`react-markdown`](https://github.com/remarkjs/react-markdown) isn't flexible enough.

## State management

- [zustand](https://github.com/pmndrs/zustand) — lightweight client state (default for local/global UI state).
- [@reduxjs/toolkit](https://github.com/reduxjs/redux-toolkit) — formal store for larger apps; includes [RTK Query](https://github.com/reduxjs/redux-toolkit/tree/master/packages/toolkit/src/query), our **preferred data-fetching /
  server-cache** layer.

## Database & data layer

- [drizzle-orm](https://github.com/drizzle-team/drizzle-orm/tree/main/drizzle-orm) + [drizzle-zod](https://github.com/drizzle-team/drizzle-orm/tree/main/drizzle-zod) + [drizzle-kit](https://github.com/drizzle-team/drizzle-orm/tree/main/drizzle-kit) — SQL ORM, zod schema bridge, and migrations.
- [@neondatabase/serverless](https://github.com/neondatabase/serverless) — serverless Postgres driver.
- [convex](https://github.com/convex/convex-backend/tree/main/npm-packages/convex) — reactive backend + database (alternative to a SQL stack).

## Authentication

- Prefer [Clerk](https://github.com/clerk/javascript) for B2C apps.
- Prefer [WorkOS](https://github.com/workos/authkit-react) for B2B apps, especially when customers need enterprise SSO or directory sync.
- [better-auth](https://github.com/better-auth/better-auth/tree/main/packages/better-auth) — self-hosted auth.

## Payments

- [stripe](https://github.com/stripe/stripe-node) — server-side SDK (checkout, subscriptions, webhooks).
- [@stripe/stripe-js](https://github.com/stripe/stripe-js) — the browser Stripe.js loader.
- [@stripe/react-stripe-js](https://github.com/stripe/react-stripe-js) — React components + hooks for Stripe Elements.

## File uploads

- Use [UploadCN](https://github.com/uploadcn/uploadcn) for file uploads. For direct uploads to S3 or R2, issue short-lived presigned URLs on the server.
- [react-dropzone](https://github.com/react-dropzone/react-dropzone) — drag-and-drop / file-picker hook; pairs with any upload target.
- [convex](https://github.com/convex/convex-backend/tree/main/npm-packages/convex) — built-in file storage + serving when Convex is the backend.

## Observability

- [@sentry/react](https://github.com/getsentry/sentry-javascript/tree/develop/packages/react) — error + performance monitoring.
- [@launchdarkly/react-sdk](https://github.com/launchdarkly/js-core) — feature flags.

## Background jobs & events

- [@trigger.dev/sdk](https://github.com/triggerdotdev/trigger.dev/tree/main/packages/trigger-sdk) — durable background tasks, scheduled/cron jobs, and event/webhook handlers (long-running work
  off the request path).
- [@trigger.dev/react-hooks](https://github.com/triggerdotdev/trigger.dev/tree/main/packages/react-hooks) — realtime hooks to subscribe to run status from the frontend.
- [convex](https://github.com/convex/convex-backend/tree/main/npm-packages/convex) — its scheduled functions, cron, and database triggers cover event-driven work when Convex is the
  backend.

## Notifications

- [@trycourier/courier](https://github.com/trycourier/courier-node) — multi-channel notification infrastructure.
- [novu](https://github.com/novuhq/novu) — multi-channel notification infrastructure with optional self hosting.

## Localization (i18n)

- [Lingui](https://github.com/lingui/js-lingui)

## SEO

- [react-schemaorg](https://github.com/google/react-schemaorg) — typed schema.org structured data.
