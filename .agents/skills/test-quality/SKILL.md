---
name: test-quality
description: Write and review meaningful unit tests and Storybook interaction tests. Use when choosing test cases, designing assertions or mocks, or fixing brittle, redundant, flaky, or low-value tests. Covers test value and good/bad examples; use Vitest and MSW skills for their APIs.
---

# Test quality

A test should protect a meaningful behavior and fail when that behavior breaks. Choose tests by the defects they catch, not by their count.

Apply this guidance whether implementation already exists or is being written. It imposes no test-first sequence, mandatory TDD, or approval steps.

## Choose the relevant guidance

- Read [Test value](references/test-value.md) when selecting cases, choosing a test layer, or reviewing redundant coverage.
- Read [Assertions](references/assertions.md) when writing expectations, names, fixtures, or snapshots.
- Read [Mocking](references/mocking.md) when introducing doubles, network scenarios, or testability changes.
- Read [Reliability](references/reliability.md) for async work, timers, shared state, or flaky failures.
- Read [Storybook interactions](references/storybook-interactions.md) when writing or reviewing story `play` functions.

## Apply the standard

Identify the caller-visible contract and a plausible failure. Choose the least expensive test layer that can observe it. Keep setup small, exercise real production behavior, and assert the result independently of the implementation.

Review whether the test would detect a relevant mistake: ignoring an input, returning a constant, skipping validation, or failing to update the UI. Use this as a reasoning check; mutation testing is optional, not a required tool or ritual.

One test may contain several assertions describing one outcome. Call counts, ordering, snapshots, and test IDs are tools with valid uses, not blanket violations. The references explain when they add value.

Follow the repository's verification policy. Report what ran and distinguish failures from checks that could not run. This skill adds no requirement to run browser tests locally or change CI, coverage thresholds, or dependencies.

## Reviewing existing tests

For each material issue, identify the behavior at risk, explain why the current test misses it or is brittle, and propose a concrete correction. Recommend keeping, strengthening, consolidating, moving, or removing a test. Remove redundancy only when its distinct regression protection is retained.

## Tool guidance

- Use [Vitest](../vitest/SKILL.md) for runner APIs and configuration. Match examples to the installed version; reference material may describe newer APIs.
- Use [MSW](../msw/SKILL.md) for network mocking mechanics.
- Use the project's Storybook framework imports and supported interaction APIs.

Examples in the references illustrate test design using hypothetical application contracts. They are not drop-in implementations or reasons to add new production APIs.

## Sources and scope

This is an original synthesis with new examples, informed by:

- [Matt Pocock's test examples](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/tests.md) and [mocking guidance](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/mocking.md): behavior, independent expectations, and boundaries.
- [Superpowers testing anti-patterns](https://github.com/obra/superpowers-skills/tree/main/skills/testing/testing-anti-patterns): testing doubles instead of production behavior and test-only production APIs.
- [Test Master](https://github.com/Jeffallan/claude-skills/tree/main/skills/test-master): specific outcomes, realistic fixtures, and failure diagnosis.
- [Storybook interaction testing](https://storybook.js.org/docs/writing-tests/interaction-testing), [Testing Library principles](https://testing-library.com/docs/guiding-principles/), and [MSW assertion guidance](https://mswjs.io/guides/best-practices/avoid-request-assertions).

Source workflows, TDD mandates, approval gates, and broad QA processes are not part of this skill. These links document provenance; normal use does not require loading the source skills.
