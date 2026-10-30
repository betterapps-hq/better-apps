import { testIdentity } from "@better-apps/testing"
import type { Actor } from "better-apps"
import { describe, expect, it } from "vite-plus/test"
import { checkMentions, mentionToken, parseMentions, replaceMentions, suggestMentions } from "./index.js"

const identity = testIdentity([
  { id: "ada", name: "Ada Lovelace", orgId: "acme" },
  { id: "amy", name: "Amy Admin", orgId: "acme" },
  { id: "bob", name: "Bob Babbage", orgId: "acme" },
  { id: "gus", name: "Gus Globex", orgId: "globex" }
])

// Everyone but Amy may be mentioned.
const scope = {
  identity,
  orgId: "acme",
  allowed: (actors: readonly Actor[]) => actors.filter((actor) => actor.userId !== "amy")
}

describe("mention tokens", () => {
  it("parse each mentioned user once, in order, and skip escaped tokens", () => {
    const text = `${mentionToken("bob")} and ${mentionToken("ada")}, again ${mentionToken("bob")}, not \\@[user:x]`
    expect(parseMentions(text)).toEqual(["bob", "ada"])
  })

  it("turn into names, with Former user for users without one", () => {
    const names = (id: string) => (id === "ada" ? "Ada" : undefined)
    expect(replaceMentions(`${mentionToken("ada")} ${mentionToken("zed")} \\@[x]`, names)).toBe(
      "@Ada @Former user @[x]"
    )
  })
})

describe("checkMentions", () => {
  it("keeps users who may be mentioned, drops the rest and those outside the organization, and skips the author", async () => {
    expect(await checkMentions(scope, ["ada", "amy", "gus", "bob"], "bob")).toEqual({
      allowed: ["ada"],
      dropped: ["amy", "gus"]
    })
    expect(await checkMentions(scope, ["bob"], "bob")).toEqual({ allowed: [], dropped: [] })
  })
})

describe("suggestMentions", () => {
  it("searches the organization's members and keeps only users who may be mentioned", async () => {
    expect((await suggestMentions(scope, "a")).map((user) => user.id)).toEqual(["ada", "bob"])
    expect((await suggestMentions(scope, "a", 1)).map((user) => user.id)).toEqual(["ada"])
    expect(await suggestMentions({ ...scope, identity: { ...identity, searchUsers: undefined } }, "a")).toEqual([])
  })
})
