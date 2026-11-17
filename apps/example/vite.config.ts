import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, lazyPlugins } from "vite-plus"

export default defineConfig({
  // `@buildkitgg/shadcn` is generated inside this app, but the hoisted Buildkit packages built on it sit at the repo
  // root, where they can't find it. Resolve it from the app for everyone.
  resolve: { dedupe: ["@buildkitgg/shadcn"] },
  // The generated components import their own CSS, which Node can't load, so server rendering bundles them and the
  // Buildkit packages built on them.
  ssr: { noExternal: [/^@buildkitgg\/shadcn/] },
  plugins: lazyPlugins(() => [
    tanstackStart({ router: { quoteStyle: "double", semicolons: false } }),
    react({ compiler: true })
  ])
})
