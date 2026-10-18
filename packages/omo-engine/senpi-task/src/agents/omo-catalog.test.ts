import { describe, expect, test } from "bun:test"

import { BUILTIN_AGENT_DEFAULTS } from "./builtin/index"
import { catalogAvailability, OMO_AGENT_CATALOG, omoCatalogEntry } from "./omo-catalog"

describe("omo agent catalog", () => {
  test("every entry has a stable id, description, source, and edition", () => {
    expect(OMO_AGENT_CATALOG.length).toBeGreaterThan(0)
    for (const entry of OMO_AGENT_CATALOG) {
      expect(entry.id.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.source).toBe("omo-compatible")
      expect(["senpi", "opencode"]).toContain(entry.edition)
    }
  })

  test("ids are unique across agents and categories", () => {
    const ids = OMO_AGENT_CATALOG.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("every senpi builtin ships as an agent entry by reference", () => {
    for (const definition of BUILTIN_AGENT_DEFAULTS) {
      const entry = omoCatalogEntry(definition.name)
      expect(entry?.kind).toBe("agent")
      expect(entry?.edition).toBe("senpi")
      expect(entry?.definition).toBe(definition)
    }
  })

  test("category entries are a distinct kind with no model gate", () => {
    for (const id of ["quick", "architect", "deep-low", "deep-high"]) {
      const entry = omoCatalogEntry(id)
      expect(entry?.kind).toBe("category")
      expect(entry?.definition).toBeUndefined()
      expect(entry?.requiresModels).toBeUndefined()
    }
  })

  test("opencode-edition entries require the opencode engine capability", () => {
    const entry = omoCatalogEntry("oracle")
    expect(entry?.edition).toBe("opencode")
    expect(entry?.definition).toBeUndefined()
    expect(catalogAvailability(entry!, { models: new Set(), capabilities: new Set() }).available).toBe(false)
    expect(
      catalogAvailability(entry!, { models: new Set(), capabilities: new Set(["opencode-engine"]) }),
    ).toEqual({ available: true })
  })

  test("ungated categories carry no model requirement", () => {
    const entry = omoCatalogEntry("architect")
    expect(entry?.requiresModels).toBeUndefined()
    expect(
      catalogAvailability(entry!, { models: new Set(), capabilities: new Set() }),
    ).toEqual({ available: true })
  })

  test("unknown id resolves undefined, never a fake entry", () => {
    expect(omoCatalogEntry("no-such-agent")).toBeUndefined()
  })

  test("every entry documents its fallback candidates", () => {
    for (const entry of OMO_AGENT_CATALOG) {
      for (const candidate of entry.fallback ?? []) {
        expect(candidate.length).toBeGreaterThan(0)
      }
    }
    expect(omoCatalogEntry("librarian")?.fallback?.[0]).toBe("librarian")
    expect(omoCatalogEntry("librarian")?.fallback).toContain("explore")
    expect(omoCatalogEntry("quick")?.fallback).toEqual(["explore"])
  })
})
