/**
 * Read-only bridge to the CLI-owned ulw-loop plan store.
 *
 * `omo-agent-toolkit ulw-loop create-goals` opens a run at
 * `<repoRoot>/.omo/ulw-loop/<sessionId>/goals.json`. The native tools keep
 * their own run store, so a caller holding that session id used to reach
 * `ulw_dispatch` and get `Unknown ULW run`.
 *
 * This module reads the plan just far enough to adopt it as a native run
 * keyed by the same session id. Native code never writes these files: the
 * plan stays CLI-owned, and the adopted run is the native record of the
 * dispatches and receipts that follow.
 */

import nodeFs from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import type { UlwStore } from "./store.ts"

const UlwLoopPlanFile = z.object({
  brief: z.string().optional(),
  goals: z.array(z.object({ id: z.string().trim().min(1) })).min(1),
})

/** A CLI plan reduced to the facts the native store needs. */
export type UlwLoopPlanRef = {
  readonly sessionId: string
  readonly brief: string
  readonly goalIds: readonly string[]
}

/**
 * Mirrors the CLI's scope normalization so the same caller value addresses
 * the same directory: path separators become `-`, unsupported characters
 * become `-`, and leading dots or runs of dashes are removed. A reference
 * that normalizes to nothing cannot name a plan.
 */
function normalizeSessionId(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const segments = trimmed
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  const candidate = (segments.length > 0 ? segments.join("-") : trimmed)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/^[.-]+|[.-]+$/g, "")
  return candidate.length > 0 ? candidate : null
}

/**
 * Reads the plan a session id names, or `undefined` when no readable plan
 * exists. Corrupt or unreadable plans stay misses: dispatch must not turn
 * an unreadable file into a partial run.
 */
export function readUlwLoopPlan(directory: string, runRef: string): UlwLoopPlanRef | undefined {
  const sessionId = normalizeSessionId(runRef)
  if (sessionId === null) return undefined
  const planPath = join(directory, ".omo", "ulw-loop", sessionId, "goals.json")
  let raw: string
  try {
    raw = nodeFs.readFileSync(planPath, "utf8")
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  const plan = UlwLoopPlanFile.safeParse(parsed)
  if (!plan.success) return undefined
  const brief = plan.data.brief?.trim() || `ULW plan ${sessionId}`
  return { sessionId, brief, goalIds: plan.data.goals.map((goal) => goal.id) }
}

/**
 * Opens the native run that mirrors a CLI plan, if the reference names one.
 * The plan session id becomes the native run id, so every later call that
 * carries the id `create-goals` returned addresses the same run. An
 * existing run wins; adopting is idempotent.
 */
export function adoptUlwLoopPlanRun(store: UlwStore, directory: string, runRef: string): string | undefined {
  const plan = readUlwLoopPlan(directory, runRef)
  if (plan === undefined) return undefined
  if (store.getRun(plan.sessionId) !== undefined) return plan.sessionId
  store.createRun({ id: plan.sessionId, brief: plan.brief, sessionScope: plan.sessionId })
  return plan.sessionId
}
