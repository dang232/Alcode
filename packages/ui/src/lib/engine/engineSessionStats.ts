import { z } from "zod";

import { OpencodeApiError } from "@/lib/opencode/client";
import { fetchUsageStats } from "@/lib/opencode/session-stats";

/**
 * Engine tab session-usage source: the compact 7-day summary the Engine
 * settings placement reads. The full report (models, tools, activity) stays
 * owned by the usage page — this module takes only the six numbers the tab
 * renders, so the tab can never drift into a second session panel.
 *
 * Failure taxonomy mirrors `engineStatus`: a failed read is `unreachable`,
 * an off-shape payload is `malformed`. Neither ever reads as a zeroed
 * report (ui-api-decoupling: failure is distinct from empty).
 */

const engineSessionSummarySchema = z.object({
  sessions: z.number(),
  prompts: z.number(),
  steps: z.number(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    reasoning: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    total: z.number(),
  }),
  cost: z.number(),
});

export type EngineSessionSummary = z.infer<typeof engineSessionSummarySchema>;

export type EngineSessionStatsResult =
  | { ok: true; summary: EngineSessionSummary }
  | { ok: false; error: "unreachable" | "malformed" };

export interface EngineSessionStatsQuery {
  from?: number;
  to?: number;
  timezone?: string;
}

/**
 * Default window: local midnight six days ago through now, in the viewer's
 * zone — the same "7 days means today plus the six calendar days before it"
 * rule the usage page's `rangeStart('7d', …)` applies, kept here so the
 * Engine placement owns its contract instead of importing view helpers.
 */
export function defaultEngineSessionStatsQuery(now: Date = new Date()): Required<Pick<EngineSessionStatsQuery, "from" | "timezone">> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - 6);
  return {
    from: start.getTime(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

export async function fetchEngineSessionStats(query: EngineSessionStatsQuery = {}): Promise<EngineSessionStatsResult> {
  const defaults = defaultEngineSessionStatsQuery();
  let summary: EngineSessionSummary;
  try {
    const stats = await fetchUsageStats({
      from: query.from ?? defaults.from,
      to: query.to,
      timezone: query.timezone ?? defaults.timezone,
    });
    summary = {
      sessions: stats.sessions,
      prompts: stats.prompts,
      steps: stats.steps,
      tokens: stats.tokens,
      cost: stats.cost,
    };
  } catch (error) {
    // The usage boundary throws normalized errors on transport/server
    // failures; anything else is the projection hitting an off-shape wire
    // body before our own guard runs.
    return { ok: false, error: error instanceof OpencodeApiError ? "unreachable" : "malformed" };
  }
  // Parsed at this boundary: off-shape numbers never become trusted tab state.
  const parsed = engineSessionSummarySchema.safeParse(summary);
  if (!parsed.success) return { ok: false, error: "malformed" };
  return { ok: true, summary: parsed.data };
}
