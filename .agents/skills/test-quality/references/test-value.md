# Test value

## Select cases by risk

Describe what could break and who would notice. Prioritize business decisions, previously observed defects, supported boundaries, important state transitions, and failure recovery. Avoid speculative inputs outside the contract unless rejecting them is itself a requirement.

Choose the smallest layer that observes the risk:

| Risk | Useful layer |
| --- | --- |
| Calculation, parser, validation rule, state transition | Unit test |
| Keyboard behavior, form feedback, component interaction | Storybook interaction or component test |
| Database constraints, serialization, external adapter contract | Integration test |
| Critical workflow across deployed services | End-to-end test |

An in-memory double cannot prove a database constraint. A mocked HTTP response cannot prove that the real service still honors its contract.

## Good and bad case selection

Contract: standard shipping is free at a subtotal of 5000 cents, otherwise costs 600 cents.

```ts
// Bad: equivalent values inflate the suite without exercising the decision boundary.
test.each([100, 200, 300, 400, 500])('shipping for %i', (subtotal) => {
  expect(shippingCost(subtotal)).toBe(600)
})

// Good: explicit cases distinguish both sides of the threshold.
test.each([
  { subtotal: 4999, expected: 600 },
  { subtotal: 5000, expected: 0 },
  { subtotal: 5001, expected: 0 }
])('charges $expected cents at $subtotal cents', ({ subtotal, expected }) => {
  expect(shippingCost(subtotal)).toBe(expected)
})
```

Multiple ordinary values can be worthwhile for interpolation, rounding, parsing, or an actual regression. Explain the distinction instead of imposing a fixed number of cases.

## Avoid coverage without protection

```ts
// Bad: checks the language and fixture, not application behavior.
test('supports archived status', () => {
  const status = 'archived'
  expect(status).toBe('archived')
})

// Good: protects a supported transition and its effect.
test('archiving a draft removes it from the editable list', () => {
  const drafts = createDraftStore([{ id: 'draft-7', status: 'draft' }])
  drafts.archive('draft-7')
  expect(drafts.listEditable()).toEqual([])
  expect(drafts.get('draft-7').status).toBe('archived')
})
```

Tests for constants or forwarding functions can be valuable when they protect a wire format, public compatibility contract, or security boundary. Merely asserting an export exists usually adds little.

## Avoid duplicate coverage

Test a calculation's permutations in unit tests; use a story to prove that the UI displays and updates its result. Repeating the entire calculation table in stories increases maintenance without necessarily covering another failure.

Keep complementary tests when they protect different boundaries. Parameterize genuinely equivalent cases; keep distinct scenarios separate when combined setup obscures intent.

Use coverage to find unexercised branches, then decide which represent real risk. Preserve required thresholds, but do not pad coverage with empty tests, irrelevant assertions, or indiscriminate snapshots. Property-based tests can add value when the domain has a clear invariant; they are optional.
