# Paired examples

These examples use an illustrative application with a web app, an editor package, and background jobs. The names and commands are examples, not facts about the repository being documented. Verify and replace them with real code, paths, and behavior.

## Describe behavior instead of its migration

**Bad**

> The editor originally lived in `apps/web`. In phase two we moved its transforms into `packages/editor`. It now uses the new command bus, whereas it previously called the save API directly.

This asks the reader to reconstruct the present from a migration story. Phase labels and “new” age badly.

**Good**

> `apps/web` owns the editor route and persistence. `packages/editor` applies document commands and returns an updated document without importing app code. The route saves that result through the persistence service. Keeping command application independent of the app lets the same rules run in tests and background jobs.

The active guide explains the current flow and why the boundary matters. Preserve the migration rationale in a decision record only if its history has lasting value.

## Give a codemap instead of a package inventory

**Bad**

> This monorepo has 18 packages. Package 1 is `editor`, package 2 is `ui`, package 3 is `data` ... The complete list is below.

The count and ordering change without teaching a newcomer where a change belongs.

**Good**

> The web app assembles routes and connects them to services. The editor package owns document commands and validation; UI components render the resulting state. Start at the route for a user action, then search for its command name in `packages/editor`. Put rules that operate only on document data in the editor package so app and worker callers share them.

Use searchable landmarks and responsibilities. Leave the complete package list to the workspace manifest or directory tree.

## Explain how and why, not just a principle

**Bad**

> We follow separation of concerns. Keep code modular and reusable.

**Good**

> The HTTP handler authenticates the request and converts it to a `PublishDocument` command. The command handler checks publish rules and returns a result; the handler maps that result to an HTTP response. Keep HTTP types out of the command handler so the same publish rules can run from the job worker.

The good version gives a contributor a place to work and a reason to preserve the boundary.

## State a non-obvious invariant

**Bad**

> The packages are loosely coupled.

**Good**

> `packages/editor` does not import from `apps/web` or the database client. Its commands receive document data and return data or validation errors. This prevents request and persistence concerns from entering the edit rules, which are also used outside the web process.

The absence of a dependency is useful information when it constrains future changes. Verify the claim in imports and package configuration.

## Keep volatile details in their source

**Bad**

> Run all 14 checks: format, lint, types, unit, coverage, story interactions ... The first six run before push. See the table below for every script and its current flags.

**Good**

> Run `pnpm verify` before submitting a change. It runs the repository's required local checks; see the root `package.json` for the exact task graph. For a focused unit test, run `pnpm test -- <test-file>`. The full verification gate catches cross-package failures that a focused run can miss.

Document the entry command, where its definition lives, and why a contributor uses it. Verify that the example command is real; if it is not, use the repository's actual command.

## Use descriptive references

**Bad**

> After completing step 4, follow the third bullet in the next section. See package 7 for the implementation.

**Good**

> After [validating the payload](#validate-the-payload), send it to `PublishDocument`. The command implementation owns publish rules.

Number the steps of a runbook when order is necessary. Use heading links or names for cross-references so inserting a section does not break the instruction.

## Separate active guidance from records and plans

**Bad — active feature guide**

> We used to poll for job status every five seconds. In March we added events. We may move to streaming next quarter. The current dashboard subscribes to events.

**Good — active feature guide**

> The dashboard subscribes to job events and updates the status view from each event. A reconnect requests the latest status before resuming events, so missed notifications do not leave the view stale.

A decision record can explain why polling was replaced. A proposal can discuss streaming. The active guide tells the engineer how the dashboard behaves and why reconnect works this way.

## Keep precise operational instructions when they matter

**Bad**

> To fix a failed job, use the relevant tooling and try again.

**Good**

> Confirm the job is in `failed` state, then run `pnpm jobs:retry --id <job-id>`. Retry uses the same idempotency key, so an interrupted attempt cannot create a second document. If the job fails again, inspect its error in the worker logs before retrying.

An ordered procedure, exact command, and state condition are appropriate in a runbook. Check them against the current CLI and worker behavior. Record a version or date only when the procedure genuinely differs by version.
