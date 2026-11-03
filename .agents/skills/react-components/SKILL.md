---
name: react-components
description:
  Write, refactor, and review React components and custom hooks with clear props, cohesive responsibilities, deliberate
  state ownership, production reuse, and feature-based file organization. Use when implementing React UI, extracting
  components or hooks, or reviewing component architecture.
---

# React components

Build small, cohesive pieces of production UX. Apply DRY to shared behavior and domain rules without forcing unrelated
use cases into one abstraction.

## Core conventions

- Use named function declarations with a colocated `type ComponentNameProps`. Infer return types unless an explicit
  contract provides a concrete benefit. Do not use `React.FC`.
- Declare children only when rendered; use `ReactNode` for ordinary content slots.
- Keep one component per file. Keep private components inside their owner's folder; promote genuinely shared components
  to the appropriate shared folder.
- Review components around 100–150 lines for decomposition. Do not allow sprawling, unrelated responsibilities; do not
  split straightforward markup just to meet a line count.
- Extract cohesive stateful behavior into purpose-named `useName.ts` hooks. Use ordinary functions for logic that does
  not need React. Do not use `ComponentName.hooks.ts` collections.
- Keep state close to its consumers, derive values when possible, and use effects for external synchronization.
- Search existing components, hooks, utilities, and mocks before creating another implementation.

## Choose the reference

Read the references relevant to the task, including their exceptions and paired examples. All detailed guidance is one
link from this file; there are no nested reference documents.

| Task                                                             | Reference                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------- |
| Define component signatures, children, callbacks, or prop modes  | [Component contracts](references/component-contracts.md)       |
| Split a component, extract JSX, or choose composition boundaries | [Component boundaries](references/component-boundaries.md)     |
| Extract stateful behavior, pure helpers, or constants            | [Hooks and logic](references/hooks-and-logic.md)               |
| Choose state ownership, connected components, context, or stores | [State and data](references/state-and-data.md)                 |
| Review effects, identity, cleanup, or optimization               | [Rendering and effects](references/rendering-and-effects.md)   |
| Remove duplication or design a shared abstraction                | [Reuse and abstractions](references/reuse-and-abstractions.md) |
| Place pages, private components, hooks, tests, and mocks         | [Project structure](references/project-structure.md)           |
| Build accessible UI and resilient content states                 | [UI contracts](references/ui-contracts.md)                     |
| Create or review stories for production components               | [storybook-development](../storybook-development/SKILL.md)     |

## Decide what to extract

| Responsibility                                       | Owner                     |
| ---------------------------------------------------- | ------------------------- |
| Meaningful UI with its behavior                      | Component                 |
| Cohesive React state, subscriptions, or interactions | Purpose-named custom hook |
| Calculation, validation, formatting, transformation  | Ordinary function         |
| State shared by nearby components                    | Closest common owner      |
| Existing equivalent behavior                         | Existing implementation   |

Examples use an illustrative projects application. Imported domain components and services represent existing production
modules; adapt them to the actual project. Bad examples intentionally demonstrate defects. Do not copy their defects
into production. Directory and library choices are conventions, not claims that React mandates them.

## Review the result

- Does each component or hook own an understandable responsibility?
- Are props explicit, state minimally owned, and derived values computed rather than synchronized?
- Are repeated behaviors shared without creating a flag-heavy universal component?
- Are private details colocated and shared code independent of feature implementations?
- Are loading, empty, error, keyboard, focus, and difficult-content states handled where relevant?

For behavioral test design, apply [test-quality](../test-quality/SKILL.md). For Vitest mechanics, use
[vitest](../vitest/SKILL.md); for network handlers, use [msw](../msw/SKILL.md). These are separate task skills, not
additional levels of this skill's reference hierarchy.
