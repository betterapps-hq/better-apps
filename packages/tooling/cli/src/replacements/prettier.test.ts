import { describe, expect, it } from "vitest"
import prettier, { createFormatter } from "./prettier.js"

const missing = Object.assign(new Error("Cannot find package 'prettier' imported from cli"), {
  code: "ERR_MODULE_NOT_FOUND"
})

describe("prettier replacement", () => {
  it("formats with prettier when it's installed", async () => {
    expect(await prettier.format("const a=1", { parser: "typescript" })).toBe("const a = 1;\n")
  })

  it("returns the code unformatted when prettier isn't installed", async () => {
    const formatter = createFormatter(() => Promise.reject(missing))
    expect(await formatter.format("const a=1", { parser: "typescript" })).toBe("const a=1")
  })

  it("reports other failures to load prettier", async () => {
    const formatter = createFormatter(() => Promise.reject(new Error("prettier is broken")))
    await expect(formatter.format("const a=1", { parser: "typescript" })).rejects.toThrow("prettier is broken")
  })
})
