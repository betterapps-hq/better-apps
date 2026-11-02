# Public API baselines

API Extractor generates a report for every typed `exports` entry in every `better-apps` and `@better-apps/*` workspace,
including unreleased packages and secondary entry points. CSS and other untyped assets are excluded. No package list is
maintained by hand.

Run `pnpm api:update` after reviewing an intentional API change, then commit the changed `.api.md` files with the code.
`pnpm check:api` checks without accepting changes. Removed entry points leave an obsolete baseline that must be
explicitly removed after review. CI runs this through `pnpm verify`.

These reports show signature changes; they do not infer the appropriate semver release or detect behavioral breaks. API
Extractor warnings about forgotten exports appear in reports for review. Release tags are optional until a release tag
policy is adopted. Missing prose remains visible as `(undocumented)` rather than blocking baseline adoption. Internal
declarations are not promoted into public exports to satisfy the tool.

Extraction also writes documentation models and an entry-point index to `dist/api-models`. Each subpath has its own
model. A documentation renderer must preserve that package/subpath identity instead of treating models with the same
package name as distinct npm packages. Generated models are build artifacts; API reports are checked in.
