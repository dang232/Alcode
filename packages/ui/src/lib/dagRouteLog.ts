// Last composer route decision, reported to the DAG pane's flow trace.
//
// routeMessage calls recordDagRouteDecision at every return (shell,
// command, prompt) with the evaluated trigger plus the resolved command
// when one matched. The record travels two ways: a console.debug line for
// devtools, and a fire-and-forget POST to the pane service's /debug/route
// through the existing guest-service proxy route (the same /api/guests/:id
// family files.ts already uses from shared UI). The proxy spawns the
// service on demand, so reporting works before the pane ever opens — unlike
// guest storage, which needs a live frame, or localStorage, which the
// opaque-origin guest sandbox cannot read. Reporting never throws and never
// blocks the send: on runtimes without the guest route it degrades to the
// debug line alone.
import { runtimeFetch } from "@/lib/runtime-fetch"

export const DAG_PANE_GUEST_ID = 'openchamber-builtin-dag-pane'
export const DAG_ROUTE_SAMPLE_MAX = 60

export type DagRouteDecision = 'captured-to-/ulw' | 'plain-prompt' | 'shell' | 'slash-command'

export type DagRouteReport = {
  decision: DagRouteDecision
  /** First 60 chars of the sent content: enough to see the trigger, nothing more. */
  sample: string
  sessionId: string
  /** Resolved command name once the slash path matched; null while routing or on prompts. */
  command?: string | null
  arguments?: string | null
}

export const dagRouteSample = (content: string): string => content.slice(0, DAG_ROUTE_SAMPLE_MAX)

/** Wire body of POST /debug/route: the decision plus the resolved command when one matched. */
export type DagRoutePostBody = {
  decision: DagRouteDecision
  sample: string
  sessionId: string
  command?: string
  arguments?: string
}

export const recordDagRouteDecision = async (report: DagRouteReport): Promise<void> => {
  console.debug('[dag] route decision:', report.decision, JSON.stringify(report.sample))
  const routeBody: DagRoutePostBody = {
    decision: report.decision,
    sample: report.sample,
    sessionId: report.sessionId,
  }
  if (report.command != null) routeBody.command = report.command
  if (report.arguments != null) routeBody.arguments = report.arguments
  try {
    await runtimeFetch(`/api/guests/${DAG_PANE_GUEST_ID}/service/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'POST',
        path: '/debug/route',
        body: JSON.stringify(routeBody),
      }),
    })
  } catch {
    // Diagnostics only: a missing route or offline runtime must not fail the send.
  }
}
