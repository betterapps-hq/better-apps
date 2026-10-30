import { defineConfig } from "vite-plus"
export default defineConfig(({ mode }) => ({
  test: {
    fsModuleCachePath: "node_modules/.vitest-cache",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // `vitest --mode servers` runs the tests against the database servers in test/compose.yaml too.
    env: mode === "servers" ? { BETTER_APPS_TEST_SERVERS: "1" } : {},
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 75 }
    }
  }
}))
