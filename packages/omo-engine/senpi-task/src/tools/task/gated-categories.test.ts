import { describe, expect, test } from "bun:test"

import { listTaskCategories } from "./categories"

function entryFor(name: string, config: Parameters<typeof listTaskCategories>[0]) {
  return listTaskCategories(config).find((entry) => entry.name === name)
}

describe("ungated category listing", () => {
  describe("#given a builtin-only category", () => {
    test("#when the categories are listed #then architect carries its plain description with no model annotation", () => {
      // given / when
      const entry = entryFor("architect", {})

      // then
      expect(entry?.description).toContain("Fable 5")
      expect(entry?.description).not.toContain("requires")
    })

    test("#when the categories are listed #then ultrabrain carries its plain description with no model annotation", () => {
      // given / when
      const entry = entryFor("ultrabrain", {})

      // then
      expect(entry?.description).toBeDefined()
      expect(entry?.description).not.toContain("requires")
    })

    test("#when the categories are listed #then each deep lane carries its plain description with no model annotation", () => {
      // given / when
      const low = entryFor("deep-low", {})
      const high = entryFor("deep-high", {})

      // then
      expect(low?.description).toBeDefined()
      expect(low?.description).not.toContain("requires")
      expect(high?.description).toBeDefined()
      expect(high?.description).not.toContain("requires")
    })
  })

  describe("#given a category configured in omo.json", () => {
    test("#when the categories are listed #then an explicit model override lists the builtin description verbatim", () => {
      // given / when
      const entry = entryFor("architect", { categories: { architect: { model: "kimi-coding/k3" } } })

      // then
      expect(entry?.description).toContain("Fable 5")
      expect(entry?.description).not.toContain("requires")
    })

    test("#when omo.json only overrides the description #then the user text is listed verbatim", () => {
      // given / when
      const entry = entryFor("architect", { categories: { architect: { description: "House architect" } } })

      // then
      expect(entry?.description).toBe("House architect")
    })
  })

  describe("#given an ungated builtin category", () => {
    test("#when the categories are listed #then no annotation is added", () => {
      // given / when
      const entry = entryFor("quick", {})

      // then
      expect(entry?.description).toBeDefined()
      expect(entry?.description).not.toContain("requires")
    })
  })
})
