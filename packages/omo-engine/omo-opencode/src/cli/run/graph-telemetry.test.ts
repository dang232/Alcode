import { describe, expect, test } from "bun:test"

import {
  createGraphTelemetry,
  type GraphTelemetryEvent,
} from "./graph-telemetry"

function baseEvent(): Omit<GraphTelemetryEvent, "at"> {
  return {
    type: "graph-post-edit",
    level: 2,
    reasonCode: "POST_EDIT_IMPACT",
    generation: "gen-9",
    freshness: "fresh",
    coverage: "indexed",
    queries: ["impact", "findTests"],
    itemCount: 3,
    unresolvedCount: 1,
    included: true,
  }
}

describe("graph telemetry", () => {
  test("#given a graph event #when recorded #then the stored shape carries ids counts and codes plus a timestamp", () => {
    const telemetry = createGraphTelemetry({ env: {} })

    const recorded = telemetry.record(baseEvent())
    const stored = telemetry.events()

    expect(typeof recorded.at).toBe("string")
    expect(Number.isNaN(Date.parse(recorded.at))).toBe(false)
    expect(stored.length).toBe(1)
    expect(stored[0]).toEqual(recorded)
    expect(stored[0]).toMatchObject({
      type: "graph-post-edit",
      level: 2,
      reasonCode: "POST_EDIT_IMPACT",
      queries: ["impact", "findTests"],
      itemCount: 3,
      unresolvedCount: 1,
      included: true,
    })
  })

  test("#given the disable switch #when recorded #then the event still returns but nothing is stored and the sink never fires", () => {
    const seen: GraphTelemetryEvent[] = []
    const telemetry = createGraphTelemetry({
      env: { OMO_GRAPH_TELEMETRY: "0" },
      sink: (event) => {
        seen.push(event)
      },
    })

    const recorded = telemetry.record(baseEvent())

    expect(typeof recorded.at).toBe("string")
    expect(telemetry.events()).toEqual([])
    expect(seen).toEqual([])
  })

  test("#given a recorded event #when serialized #then no source text prompt or token can leak", () => {
    const telemetry = createGraphTelemetry({ env: {} })
    const prompt = "sentinel-prompt-body-fix-add-in-math"
    const source = "sentinel-source-text-return-a-plus-b"

    const recorded = telemetry.record({ ...baseEvent(), reasonCode: "GRAPH_STALE" })
    const body = JSON.stringify(recorded)

    expect(body).not.toContain(prompt)
    expect(body).not.toContain(source)
    // The shape is closed: only the auditable fields exist, so a future
    // free-text field cannot slip in unnoticed.
    expect(Object.keys(recorded).sort()).toEqual(
      [
        "at",
        "coverage",
        "freshness",
        "generation",
        "included",
        "itemCount",
        "level",
        "queries",
        "reasonCode",
        "type",
        "unresolvedCount",
      ].sort(),
    )
  })

  test("#given stored events #when the reader mutates the copy #then the trail is unchanged", () => {
    const telemetry = createGraphTelemetry({ env: {} })
    telemetry.record(baseEvent())

    const copy = telemetry.events() as GraphTelemetryEvent[]
    copy.push({ ...baseEvent(), at: "forged" })
    copy.length = 0

    expect(telemetry.events().length).toBe(1)
  })

  test("#given a sink #when several events record #then they arrive in order", () => {
    const seen: GraphTelemetryEvent[] = []
    const telemetry = createGraphTelemetry({
      env: {},
      sink: (event) => {
        seen.push(event)
      },
    })

    telemetry.record({ ...baseEvent(), type: "graph-preflight" })
    telemetry.record({ ...baseEvent(), type: "graph-tool" })

    expect(seen.map((event) => event.type)).toEqual(["graph-preflight", "graph-tool"])
    expect(telemetry.events().map((event) => event.type)).toEqual(["graph-preflight", "graph-tool"])
  })
})
