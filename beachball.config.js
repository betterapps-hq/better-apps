// @ts-check

/**
 * Beachball manages versioning and changelogs for the workspace packages. Contributors run `pnpm change`; release.yml
 * opens the release pull request and cd-npm.yml publishes the versions it merges.
 *
 * @type {import("beachball").BeachballConfig}
 */
module.exports = {
  branch: "origin/main",
  access: "public",
  // The core and the packages built on its types release together at one version. Features don't join.
  groups: [
    {
      name: "better-apps-platform",
      include: [
        "packages/core/better-apps",
        "packages/adapters/database-drizzle",
        "packages/adapters/identity-better-auth",
        "packages/adapters/identity-clerk",
        "packages/adapters/identity-workos",
        "packages/integrations/react",
        "packages/integrations/tanstack-start",
        "packages/tooling/cli",
        "packages/tooling/testing"
      ],
      disallowedChangeTypes: null
    }
  ],
  ignorePatterns: ["**/*.test.{ts,tsx}", "**/test/**", "**/*.md", "**/tsconfig*.json", "**/vitest.config.ts"]
}
