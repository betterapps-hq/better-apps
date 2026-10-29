// Stands in for `prettier` in vendored code. Prettier is an optional peer dependency, so when the app doesn't have it,
// the generated code is returned unformatted.
type Prettier = Pick<typeof import("prettier"), "format">

export function createFormatter(load: () => Promise<Prettier>) {
  return {
    async format(code: string, options: { parser: string }): Promise<string> {
      let prettier: Prettier
      try {
        prettier = await load()
      } catch (error) {
        const { code: errorCode, message } = error as { code?: unknown; message?: unknown }
        if (errorCode === "ERR_MODULE_NOT_FOUND" && String(message).includes("'prettier'")) {
          return code
        }
        throw error
      }
      return prettier.format(code, options)
    }
  }
}

export default createFormatter(() => import("prettier"))
