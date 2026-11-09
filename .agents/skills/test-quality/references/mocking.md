# Mocking

## Keep the subject real

```ts
// Bad: the assertion only confirms the configured double.
const calculateFee = vi.fn().mockReturnValue(300)
expect(calculateFee(order)).toBe(300)

// Good: exercise production pricing with an injected external rate source.
const rates = { getRate: vi.fn().mockResolvedValue({ cents: 300 }) }
const quote = await quoteDelivery(order, rates)
expect(quote).toEqual({ deliveryCents: 300, totalCents: 2300 })
```

Prefer real local collaborators. Isolate network access, time, randomness, and expensive external systems when necessary. Mock an internal collaborator only when the test has a clear isolation purpose and still exercises meaningful production behavior.

## Match the real interface

```ts
// Bad: an unchecked fake can invent methods or omit required data.
const directory = { lookup: vi.fn() } as any

// Good: the actual dependency type checks the fixture.
const directory = {
  findById: vi.fn().mockResolvedValue({ id: 'u-4', name: 'Rae' })
} satisfies UserDirectory
```

Read the dependency contract before building the double. Include required fields and relevant failure semantics. Small fixtures are preferable to copying entire production records. Types do not prove runtime compatibility; use integration or contract tests where drift matters.

Do not extend a fake with an invented method just because incorrect production code calls it. Do not remove a side effect that the scenario needs, such as recording a duplicate key, and then claim to have tested duplicate detection.

## Use network scenarios to test application behavior

```ts
// Bad: no application code is exercised.
server.use(http.get('/api/projects', () => HttpResponse.json([])))
expect(server.listHandlers()).toHaveLength(1)

// Good: configure the boundary, then exercise the real UI.
server.use(http.get('/api/projects', () => new HttpResponse(null, { status: 503 })))
render(<ProjectList />)
expect(await screen.findByRole('alert')).toHaveTextContent('Could not load projects')
expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
```

Use MSW's version-appropriate imports and lifecycle setup. Reset per-test overrides, handle unexpected traffic explicitly, and keep handlers faithful to the API. Request assertions are useful for one-way effects with no observable result, such as telemetry; ordinary UI scenarios should demonstrate the user's outcome.

## Keep test utilities separate

Avoid adding private-state getters, reset endpoints, or production branches solely to satisfy a test. Prefer fresh instances and test-owned fixtures. Dependency injection and real lifecycle methods are legitimate design choices when they clarify ownership; do not create a new abstraction for every mock.
