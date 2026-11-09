# Reliability

## Await the work being checked

```ts
// Bad: the test can finish before the rejection assertion runs.
expect(saveDraft(invalidDraft)).rejects.toThrow('Title is required')

// Good: a failure reaches the runner.
await expect(saveDraft(invalidDraft)).rejects.toThrow('Title is required')
```

Avoid swallowed exceptions, assertions hidden in callbacks that may never execute, and conditional branches that skip checks. Use assertion counts when they genuinely verify that a callback path ran, not as boilerplate in every test.

## Wait for conditions, not elapsed time

```ts
// Bad: fast machines waste time; slow machines still fail.
await new Promise((resolve) => setTimeout(resolve, 1000))
expect(screen.getByRole('status')).toHaveTextContent('Saved')

// Good: wait for the expected visible outcome.
await waitFor(() => {
  expect(screen.getByRole('status')).toHaveTextContent('Saved')
})
```

Keep actions outside retrying assertion callbacks; otherwise a retry may submit a form twice. Use fake timers for time-based logic and restore them afterward. Fixed delays are appropriate only when elapsed time itself is the behavior under test and a controlled clock cannot express it.

## Keep cases independent

```ts
// Bad: the second test depends on the first.
const basket = createBasket()
test('adds a product', () => basket.add(product))
test('removes a product', () => {
  basket.remove(product.id)
  expect(basket.items()).toEqual([])
})

// Good: the scenario establishes its own starting state.
test('removing the last product empties the basket', () => {
  const basket = createBasket([product])
  basket.remove(product.id)
  expect(basket.items()).toEqual([])
})
```

Restore spies, network overrides, timers, globals, storage, and owned resources. Share immutable fixture data, not mutable test state. Concurrent tests need isolated overrides; process-global mutation is not made safe by an `afterEach` alone.

Control relevant dates, randomness, locale, and timezone explicitly. Keep fixtures small and representative. Avoid real external network calls in unit tests.

## Diagnose failures before changing expectations

Distinguish a broken behavior from bad setup, an unavailable dependency, and a race. Preserve the intended contract when fixing tests. Do not lower coverage thresholds, add skips, increase retries, or accept snapshots to conceal a failure. If an environmental prerequisite is missing, report it separately from test results.
