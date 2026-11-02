# Releases

Beachball manages package versions and changelogs. With a change to a package that isn't private, run `pnpm change` and
commit the change file it writes. Pull request CI checks for one with `pnpm check:change`.

The core, the adapters, the integrations, the CLI and `@better-apps/testing` share types, so they release together at
one version, as the `better-apps-platform` group in `beachball.config.js`. Features version on their own.

## How a release goes out

The workflows call the shared templates in [betterapps-hq/pipelines](https://github.com/betterapps-hq/pipelines) at
`main`, so every run uses the latest release of each.

1. **A change merges with its change file.** After CI passes on `main`, [release.yml](../.github/workflows/release.yml)
   opens the release pull request, or updates the open one: one commit with the versions and changelogs `beachball bump`
   writes. It then turns on auto-merge, so the release merges once `main`'s checks pass.
2. **The release merges.** CI runs on `main` again, and [cd-npm.yml](../.github/workflows/cd-npm.yml) publishes every
   version npm doesn't have yet, in dependency order, through trusted publishing with provenance.
3. **A failed publish is retried** by running **CD npm** by hand on `main`, or rerunning the failed run. It publishes
   only a commit CI passed on as a push to `main`, and skips versions npm already has.

Private packages never publish. Every package is private until it's ready for its first release.

## Setup

- **The release GitHub App.** release.yml pushes and merges with a GitHub App's token, since what the job's own token
  pushes or merges starts no workflows. Set the repository variable `RELEASE_APP_CLIENT_ID` and the secret
  `RELEASE_APP_PRIVATE_KEY`. Until both exist, the release jobs skip with a notice.
- **The `npm` environment,** which publishing runs in, deploys only from `main`.
- **Each package's trusted publisher on npmjs.com** names repository `betterapps-hq/better-apps`, workflow `cd-npm.yml`
  and environment `npm`, with npm publish allowed. npm takes a trusted publisher only for a package that exists, so a
  package's first version is published by hand.

## Releasing a package for the first time

1. Review its API report and packed contents, then remove `private` in a pull request with a change file.
2. Once the release merges, publish that first version by hand with npm's interactive sign-in.
3. Add its trusted publisher on npmjs.com, as above. Later versions publish from CI.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for account setup.
