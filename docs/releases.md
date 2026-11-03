# Releases

Beachball manages package versions and changelogs. With a change to a package that isn't private, run `pnpm change` and
commit the change file it writes. Pull request CI checks for one with `pnpm check:change`.

The core, the adapters, the integrations, the CLI and `@better-apps/testing` share types, so they release together at
one version, as the `better-apps-platform` group in `beachball.config.js`. Features version on their own.

## How a release goes out

Releasing is the last job in [CI](../.github/workflows/ci.yml), through the shared
[beachball-publish-npm](https://github.com/betterapps-hq/pipelines/blob/main/.github/workflows/beachball-publish-npm.yml)
template. When a change merges with its change file and `verify` and `databases` pass on `main`, the `release` job runs
`beachball publish`, which:

1. bumps the versions and writes the changelogs from the change files, and deletes them;
2. publishes the new versions to npm, in dependency order, turning `workspace:` and `catalog:` ranges into versions;
3. commits the versions and changelogs, tags each version, and pushes the commit and tags to `main`.

That push starts CI again, which finds no change files and releases nothing. Private packages never publish: every
package is private until it's ready for its first release.

A failed run is rerun from the Actions tab. Check npm first: a version that already published can't be published again.

## Setup

- **The deploy key.** `main`'s ruleset requires a pull request from everyone but deploy keys, so the release job pushes
  with one. Add a deploy key with write access to the repository, and put its private key in the `npm` environment's
  `RELEASE_DEPLOY_KEY` secret. Until it exists, the release job skips with a notice.
- **The `npm` environment** deploys only from `main`, so only `main`'s runs read the key.
- **Each package's trusted publisher on npmjs.com** names repository `betterapps-hq/better-apps`, workflow `ci.yml` and
  environment `npm`, with npm publish allowed. npm takes a trusted publisher only for a package that exists, so a
  package's first version is published by hand.

## Releasing a package for the first time

1. Publish its first version by hand with npm's interactive sign-in, then add its trusted publisher on npmjs.com.
2. Remove `private` in a pull request with a change file. Once it merges, CI publishes the next version, and every one
   after it.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for account setup.
