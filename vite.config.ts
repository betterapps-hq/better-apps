import { defineConfig } from "vite-plus"
import base from "./internal/oxlint-config/base.ts"

// Lint and format run once from the workspace root; packages keep their own Vitest configs.
export default defineConfig({
  defaultPackage: "./apps/example",
  fmt: {
    printWidth: 120,
    semi: false,
    trailingComma: "none",
    proseWrap: "always",
    sortImports: { enabled: true, newlinesBetween: false, sortSpecifiers: true },
    sortPackageJson: false,
    ignorePatterns: [
      // Generated from Playbook or installed by the skills CLI.
      "best-practices/**",
      ".agents/skills/**",
      ".claude/skills/**",
      "AGENTS.md",
      "CLAUDE.md",
      ".github/copilot-instructions.md",
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "pnpm-lock.yaml",
      "api-reports/*.api.md",
      "**/src/vendor/**",
      "**/routeTree.gen.ts"
    ]
  },
  lint: {
    extends: [base],
    ignorePatterns: [
      ".agents/skills/**",
      ".claude/skills/**",
      "**/src/vendor/**",
      "apps/example/src/routeTree.gen.ts",
      "apps/example/src/db/better-apps-schema.ts"
    ],
    options: { typeAware: true, typeCheck: true },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // Type-aware rules the code doesn't pass yet; turning one on means fixing its errors first.
      "typescript/unbound-method": "off",
      "typescript/no-floating-promises": "off",
      "typescript/no-base-to-string": "off",
      "typescript/no-useless-default-assignment": "off",
      "typescript/restrict-template-expressions": "off",
      "typescript/require-array-sort-compare": "off",
      "typescript/no-misused-spread": "off",
      "typescript/await-thenable": "off"
    }
  },
  staged: {
    // Lint-ignored files such as the generated schema can be the only staged scripts.
    "*.{ts,tsx,js,jsx,mjs,cjs}": "vp lint --fix --no-error-on-unmatched-pattern",
    "*.{ts,tsx,js,jsx,mjs,cjs,json,jsonc,md,yml,yaml}": "vp fmt --no-error-on-unmatched-pattern"
  }
})
