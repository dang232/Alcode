/**
 * graph-telemetry.ts - auditable graph telemetry for the agent run path.
 *
 * The run path records that a graph query happened, never what it
 * contained. Events carry only ids, counts, and reason codes: the query
 * kind, the revision generation, freshness and coverage codes, per-query
 * names, item and unresolved counts, and whether the result reached the
 * agent. Source text, prompts, and tokens never enter an event, so the
 * trail is safe to persist and ship.
 */

export type GraphTelemetryEventType = "graph-preflight" | "graph-tool" | "graph-post-edit"

export interface GraphTelemetryEvent {
  readonly type: GraphTelemetryEventType
  readonly level: number
  readonly reasonCode: string
  readonly generation?: string
  readonly freshness?: string
  readonly coverage?: string
  readonly queries: readonly string[]
  readonly itemCount: number
  readonly unresolvedCount: number
  readonly included: boolean
  readonly at: string
}

export interface GraphTelemetryOptions {
  readonly sink?: (event: GraphTelemetryEvent) => void
  readonly env?: Record<string, string | undefined>
}

export interface GraphTelemetryRecorder {
  record(event: Omit<GraphTelemetryEvent, "at">): GraphTelemetryEvent
  events(): readonly GraphTelemetryEvent[]
}

export const GRAPH_TELEMETRY_DISABLED_ENV = "OMO_GRAPH_TELEMETRY"

export function isGraphTelemetryEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[GRAPH_TELEMETRY_DISABLED_ENV] !== "0"
}

/**
 * An append-only recorder for graph telemetry. `OMO_GRAPH_TELEMETRY=0`
 * disables recording: `record` still stamps and returns the event so
 * callers keep one code path, but nothing is stored and the sink never
 * fires. `events` returns a copy, so readers cannot rewrite the trail.
 */
export function createGraphTelemetry(options: GraphTelemetryOptions = {}): GraphTelemetryRecorder {
  const env = options.env ?? process.env
  const enabled = isGraphTelemetryEnabled(env)
  const stored: GraphTelemetryEvent[] = []
  return {
    record(event: Omit<GraphTelemetryEvent, "at">): GraphTelemetryEvent {
      const stamped: GraphTelemetryEvent = {
        ...event,
        queries: [...event.queries],
        at: new Date().toISOString(),
      }
      if (!enabled) return stamped
      stored.push(stamped)
      options.sink?.(stamped)
      return stamped
    },
    events(): readonly GraphTelemetryEvent[] {
      return [...stored]
    },
  }
}
