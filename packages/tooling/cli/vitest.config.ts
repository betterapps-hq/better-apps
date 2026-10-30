import { defineConfig } from "vite-plus"
export default defineConfig({
  test: {
    fsModuleCachePath: "node_modules/.vitest-cache",
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Vendored upstream code is covered by Better Auth's own tests. bin.ts only hands the process to run().
      exclude: ["src/**/*.test.ts", "src/vendor/**", "src/bin.ts"],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 75 }
    }
  }
})
