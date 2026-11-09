---
name: storybook-development
description:
  Build and review Storybook stories for real production pages, sections, and controls. Use when translating designs
  into stories, adding page coverage, configuring preview context, mocking connected UI, or preparing content states for
  visual regression.
---

# Storybook development

Each story renders one production component. A page or section can compose many children internally. The app and
Storybook import that same page or section. When starting from a design before the route exists, implement the component
in production source first and preview it from a colocated `*.stories.tsx` file. The route can then import it directly.

| When working on                                                                 | Read                                                              |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Translating a design, covering a route, or choosing what to render in isolation | [Pages, sections, and controls](references/story-subjects.md)     |
| Supplying routing, providers, app styling, network data, or clean state         | [Preview environment and data](references/preview-environment.md) |
| Stressing a design, selecting scenarios, or configuring visual coverage         | [Scenarios and visual modes](references/scenarios-and-modes.md)   |

Use [react-components](../react-components/SKILL.md) for component boundaries, hooks, state ownership, and source
layout. Use [test-quality](../test-quality/SKILL.md) when deciding what a `play` function should exercise or assert. Use
[MSW](../msw/SKILL.md) for request handler APIs. Match the project's installed Storybook framework, CSF format,
decorators, and visual runner.

## Review a story change

- Trace the route and story imports to the same component. For a new design, check that the app can import the
  implementation without importing Storybook.
- Cover every page and give meaningful sections and subsections their own isolated stories. Preview providers or layout
  divs may supply context and available space. Product layout and behavior belong to the subject.
- Choose examples that could reveal a design failure. Describe data and behavior in story names. Never create separate
  stories for viewport sizes or themes.
- Verify connected stories can run from a fresh preview in any order using shared fixtures and MSW handlers. Use
  production styling, fonts, tokens, and relevant providers.
- Run visual and interaction coverage in CI according to the project's setup. Local runs are optional. Keep these suites
  out of Git hooks and required local checks.
