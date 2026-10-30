import { afterEach, describe, expect, it } from "vite-plus/test"
import { configureBackends, getBackend } from "./backends.js"

declare module "./backends.js" {
  interface Backends {
    storage?: { adapter: string } | undefined
    realtime?: { adapter: string } | undefined
  }
}

afterEach(() => configureBackends({ storage: undefined, realtime: undefined }))

describe("configureBackends", () => {
  it("leaves capabilities on their defaults until configured", () => {
    expect(getBackend("storage")).toBeUndefined()
  })

  it("merges each call into the current choice", () => {
    configureBackends({ storage: { adapter: "memory" } })
    configureBackends({ realtime: { adapter: "local" } })

    expect(getBackend("storage")).toEqual({ adapter: "memory" })
    expect(getBackend("realtime")).toEqual({ adapter: "local" })
  })

  it("puts a capability set to undefined back on its default", () => {
    configureBackends({ storage: { adapter: "memory" } })
    configureBackends({ storage: undefined })

    expect(getBackend("storage")).toBeUndefined()
  })
})
