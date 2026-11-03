# Assertions

## Use an independent expectation

Contract: a 25% discount on 1200 cents produces a 900-cent total.

```ts
// Bad: repeats the implementation's calculation, including any shared mistake.
expect(discountedTotal(1200, 25)).toBe(1200 * (1 - 25 / 100))

// Good: a worked example provides the expected result.
expect(discountedTotal(1200, 25)).toBe(900)
```

Expected results may come from a specification, reviewed fixture, mathematical invariant, or independent reference implementation. Avoid invoking the function under test to generate its own expected values.

## Assert the contract precisely

```ts
// Bad: almost any object passes, including an error-shaped response.
expect(parseInvite('expired-token', fixedNow)).toBeTruthy()

// Good: checks the documented failure outcome.
expect(parseInvite('expired-token', fixedNow)).toEqual({
  ok: false,
  reason: 'expired'
})
```

Use exact equality for complete stable outputs. Use partial matching when other fields are intentionally irrelevant. A truthiness assertion is appropriate when the contract is actually boolean; an existence assertion is appropriate when presence is the behavior.

## Observe public behavior

```ts
// Bad: ties the test to storage layout.
expect(cache['_entries'].size).toBe(0)

// Good: checks the supported eviction behavior.
cache.put('report', report)
cache.evict('report')
expect(cache.get('report')).toBeUndefined()
```

Public interfaces include exported functions and component callbacks, not only UI. For persistence integration tests, inspecting stored data can be the correct observation boundary.

## Keep one coherent scenario

Name the condition and result: `retains the entered title when saving fails`. Avoid names such as `works` or names that only repeat an internal method.

Several assertions may jointly establish that a failed save displays an error, preserves input, and permits retry. Split unrelated scenarios, not every assertion. Keep inputs relevant to the case visible; use typed fixture builders for uninteresting required fields rather than large inline objects or `as any`.

## Use call assertions when effects are the contract

```ts
// Bad: an internal helper call says nothing about the returned result.
expect(normalizeSpy).toHaveBeenCalled()

// Good: a delivery adapter must not send the same message twice.
await deliverOnce(message, sender)
await deliverOnce(message, sender)
expect(sender.send).toHaveBeenCalledExactlyOnceWith(message)
```

Retries, deduplication, callback payloads, resource disposal, and telemetry can justify call counts or ordering. Prefer externally observable results when available. Check matcher support in the installed test runner.

## Keep snapshots reviewable

```ts
// Bad: a large component tree hides the important change.
expect(container).toMatchSnapshot()

// Good: asserts the behavior the test intends to protect.
expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
```

Small snapshots are useful for stable serialized output or deliberately reviewed structures. Inspect diffs; do not regenerate snapshots merely because tests fail. Use visual testing for appearance rather than treating DOM snapshots as screenshots.
