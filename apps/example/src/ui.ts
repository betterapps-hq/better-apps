import { createAlertManager } from "@buildkitgg/shadcn-alerts-manager"
import { createModalManager } from "@buildkitgg/shadcn-modals-manager"
import { createShadcnTheme, type ThemeInitScriptOptions } from "@buildkitgg/shadcn-theme"

const themeOptions = {
  defaultTheme: "system",
  storage: "localStorage",
  storageKey: "better-apps-example-theme"
} satisfies ThemeInitScriptOptions

/** Light, dark or the system's appearance, saved in the browser. The root route starts it in the browser. */
export const theme = createShadcnTheme(themeOptions)

/** The options the first-paint script reads the saved appearance with, the same as the theme's. */
export { themeOptions }

/** Confirmations and other dialogs, rendered once by the app shell. */
export const modals = createModalManager()

/** Alerts that stay until they're dismissed or their cause is fixed, such as a write the server refused. */
export const alerts = createAlertManager()
