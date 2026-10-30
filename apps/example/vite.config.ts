import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, lazyPlugins } from "vite-plus"

export default defineConfig({
  plugins: lazyPlugins(() => [
    tanstackStart({ router: { quoteStyle: "double", semicolons: false } }),
    react({ compiler: true })
  ])
})
