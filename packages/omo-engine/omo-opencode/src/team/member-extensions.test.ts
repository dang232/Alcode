import { describe, expect, test } from "bun:test"

import { assembleMemberExtensions } from "./member-extensions"

describe("assembleMemberExtensions", () => {
  test("#given an entry and inherited extensions #when assembled #then the entry leads deduplicated", () => {
    // when
    const assembled = assembleMemberExtensions("/entry.js", ["/provider.js", "/entry.js", "/other.js"])

    // then
    expect(assembled).toEqual(["/entry.js", "/provider.js", "/other.js"])
  })

  test("#given no inherited extensions #when assembled #then only the entry remains", () => {
    // when / then
    expect(assembleMemberExtensions("/entry.js")).toEqual(["/entry.js"])
  })
})
