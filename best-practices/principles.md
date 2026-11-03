# Coding principles

Apply these principles to code changes across the repository. Use judgment about scale: a small function does not need
the structure of a subsystem, and a growing subsystem should not remain one sprawling function.

## Separation of concerns

Keep each module focused on a coherent responsibility. When logic grows, separate distinct concerns into modules with
clear interfaces. Promote a boundary to a package when it has a stable responsibility and independent consumers or
ownership; size alone is not a reason to create a package.

## Dependency direction

Let application code assemble reusable modules. Keep domain logic independent of UI, persistence, and transport details
where those details are not part of its job. Depend on narrow contracts across boundaries and avoid cycles. Put
integration code at the edge that knows both sides.

## Don't repeat behavior (DRY)

Search for an existing implementation before writing another. When the same rule or behavior appears in multiple places,
give it one owner so the copies cannot drift. Similar syntax is not enough reason to merge distinct use cases. If reuse
is turning a function into a collection of flags or unrelated branches, reconsider the boundary or use a more suitable
composition or pattern.

## Encapsulation

Expose only the operations consumers need; keep implementation details private. Use a module or closure with a focused
returned API when operations share state or invariants. Keep stateless operations as ordinary functions when that is
clearer. Prefer functions and scope-based encapsulation over classes unless a class solves a concrete problem.

## Explicit contracts and states

Make inputs, outputs, side effects, and failure behavior clear at module boundaries. Validate external data where it
enters the system. Model valid states explicitly, using types and exhaustive handling when they prevent impossible
combinations or missed cases. Do not hide a failed contract behind a silent fallback.

## Side effects at the edges

Keep calculations and domain decisions in functions that take data and return data when practical. Isolate network,
storage, clock, and other external effects at clear boundaries. This keeps the core behavior understandable and usable
from different entry points.

## Patterns as tools

Before extending a growing implementation, consider whether a Factory, Adapter, Facade, Decorator, Repository, Command,
State Machine, Strategy, Observer, or Pub/Sub pattern would clarify a real variation, boundary, or lifecycle. Use the
pattern only when it reduces complexity or improves a concrete extension path. Express it with functions and composition
when classes add no value.

## SOLID where useful

- **Single Responsibility:** Keep a module's reasons to change coherent.
- **Open/Closed:** Provide an extension point when real variants need one; do not prebuild speculative variants.
- **Liskov Substitution:** Implementations of the same contract must preserve its promised behavior.
- **Interface Segregation:** Give consumers the small contract they need.
- **Dependency Inversion:** Keep higher-level policy independent of concrete infrastructure by putting an appropriate
  contract between them.

Apply these ideas to TypeScript functions and modules as well as objects. Do not add class hierarchies or interfaces
merely to satisfy the acronym.

## Keep it simple (KISS and YAGNI)

Choose the simplest design that meets known requirements. Do not build speculative capabilities or large abstractions
for hypothetical use. Refactor when it makes the code easier to change; that is compatible with YAGNI. Verify required
behavior and callers before removing an abstraction that may still serve a real purpose.

## Boy Scout Rule

Leave code you work in clearer and better structured than you found it. Fix nearby problems when the improvement is safe
and related to the work. Keep larger or unrelated cleanup reviewable in a separate commit, and avoid turning a focused
change into an open-ended refactor.

## Intentional compatibility

Compatibility is a product requirement, not a default. Ask the user before preserving an old behavior, API, schema, data
shape, or code path unless the request already requires compatibility. If they have not confirmed it, proceed without a
compatibility layer. Unreleased apps do not need backward compatibility: replace the obsolete implementation and update
its callers, schema, and migration baseline together. Do not add shims, dual paths, or data rewrites for disposable
prototype state.

Keep one canonical implementation. Names such as `ThingV2`, `Phase2`, and `legacy` are a code smell when they merely
postpone cleanup. Use a versioned name when the version is part of a real external contract or required migration
record.
