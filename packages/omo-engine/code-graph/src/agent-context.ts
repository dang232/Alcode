import type { CompletenessReason, CompletenessStatus, QueryEnvelope, QueryItem, QueryTotals, ShownOf } from "./queries.ts";

export type GraphContextLevel = 0 | 1 | 2 | 3;
export type GraphContextOp = "status" | "context" | "search" | "trace" | "impact" | "tests";

export interface GraphContextSubject {
  readonly kind: "file" | "symbol" | "changes" | "query";
  readonly id: string;
  readonly reason?: string;
}

export interface GraphContextCorrelation {
  readonly projectId: string;
  readonly worktreeId: string;
  readonly revision?: string;
  readonly generation?: string;
  readonly sessionId?: string;
  readonly runId?: string;
}

export interface GraphContextStatus {
  readonly freshness: "fresh" | "stale";
  readonly coverage: "indexed" | "partial" | "unindexed";
  readonly generation?: string;
  readonly revision?: string;
  readonly queryServable: boolean;
  readonly reasons: readonly string[];
}

export interface GraphContextBudget {
  readonly maxBytes: number;
  readonly bytes: number;
  readonly estimatedTokens: number;
  readonly truncatedBy: "none" | "bytes" | "items";
}

export interface GraphContextUnresolved {
  readonly kind: string;
  readonly id: string;
  readonly reason: string;
}

export interface GraphContextEnvelope {
  readonly op: GraphContextOp;
  readonly level: GraphContextLevel;
  readonly subjects: readonly GraphContextSubject[];
  readonly correlation: GraphContextCorrelation;
  readonly status: GraphContextStatus;
  readonly items: readonly QueryItem[];
  readonly totals: QueryTotals;
  readonly shown: ShownOf;
  readonly completeness: { readonly status: CompletenessStatus; readonly reasons: readonly CompletenessReason[] };
  readonly unresolved: readonly GraphContextUnresolved[];
  readonly budget: GraphContextBudget;
  readonly reasonCodes: readonly string[];
  readonly unanswered: readonly string[];
  readonly unavailable?: { readonly code: string; readonly message: string };
}

export const AGENT_CONTEXT_DEFAULT_MAX_BYTES = 8192;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

function textBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function normalizeMaxBytes(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return AGENT_CONTEXT_DEFAULT_MAX_BYTES;
  const floored = Math.floor(value);
  if (floored < 1) return AGENT_CONTEXT_DEFAULT_MAX_BYTES;
  return floored;
}

function omittedFor(items: readonly QueryItem[], totals: QueryTotals): number {
  const hidden = typeof totals.hidden === "number" ? totals.hidden : 0;
  const over = totals.displayed - items.length;
  return (over > 0 ? over : 0) + (hidden > 0 ? hidden : 0);
}

function decideUnanswered(args: {
  readonly unavailable: { readonly code: string; readonly message: string } | undefined;
  readonly queryServable: boolean;
  readonly freshness: "fresh" | "stale";
  readonly completeness: CompletenessStatus;
  readonly unresolvedCount: number;
  readonly items: readonly QueryItem[];
}): readonly string[] {
  if (args.unavailable !== undefined || args.queryServable === false) return ["GRAPH_UNAVAILABLE"];
  if (args.freshness === "stale") return ["GRAPH_STALE"];
  if (args.completeness !== "complete") return ["ANALYSIS_INCOMPLETE"];
  if (args.unresolvedCount > 0) return ["UNRESOLVED_RELATIONSHIP"];
  if (args.items.length === 0) return ["NO_RELATIONSHIP"];
  if (args.items.some((item) => item.verdict === "confirmed")) return ["VERIFIED_RELATIONSHIP"];
  // Rows exist but every one is a lower-confidence inference: that is neither
  // "no relationship" nor an unresolved edge, so it gets its own flag.
  return ["INFERRED_RELATIONSHIP"];
}

function formatList(values: readonly string[]): string {
  return `[${values.join(", ")}]`;
}

function formatItemLine(item: QueryItem): string {
  const name = item.name ?? "-";
  const verdict = item.verdict ?? "inferred";
  return `- ${item.id} ${item.file}:${item.line} name=${name} verdict=${verdict} confidence=${item.confidence}`;
}

function renderText(envelope: GraphContextEnvelope, omittedItems: number): string {
  const c = envelope.correlation;
  const s = envelope.status;
  const lines: string[] = [];
  lines.push(`CODE GRAPH CONTEXT op=${envelope.op} level=${envelope.level}`);
  lines.push(
    `correlation: project=${c.projectId} worktree=${c.worktreeId} generation=${c.generation ?? "none"} revision=${c.revision ?? "none"} session=${c.sessionId ?? "none"} run=${c.runId ?? "none"}`,
  );
  lines.push(
    `status: freshness=${s.freshness} coverage=${s.coverage} queryServable=${s.queryServable ? "true" : "false"} generation=${s.generation ?? "none"} revision=${s.revision ?? "none"} reasons=${formatList(s.reasons)}`,
  );
  lines.push(`unanswered: ${envelope.unanswered.length > 0 ? envelope.unanswered.join(",") : "none"}`);
  lines.push(`omittedItems: ${omittedItems}`);
  lines.push(
    `subjects: ${envelope.subjects.length > 0 ? envelope.subjects.map((sub) => `${sub.kind}:${sub.id}`).join(",") : "none"}`,
  );
  lines.push(
    `totals: displayed=${envelope.totals.displayed} known=${envelope.totals.known === null ? "null" : envelope.totals.known} hidden=${envelope.totals.hidden === null ? "null" : envelope.totals.hidden}`,
  );
  lines.push(
    `completeness: status=${envelope.completeness.status} reasons=${formatList(envelope.completeness.reasons)}`,
  );
  lines.push(
    `budget: maxBytes=${envelope.budget.maxBytes} bytes=${envelope.budget.bytes} estimatedTokens=${envelope.budget.estimatedTokens} truncatedBy=${envelope.budget.truncatedBy}`,
  );
  lines.push(
    `reasonCodes: ${envelope.reasonCodes.length > 0 ? envelope.reasonCodes.join(",") : "none"}`,
  );
  if (envelope.unavailable !== undefined) {
    lines.push(`unavailable: code=${envelope.unavailable.code} message=${envelope.unavailable.message}`);
  }
  if (envelope.unresolved.length > 0) {
    lines.push(`unresolved: ${envelope.unresolved.map((u) => `${u.kind}:${u.id}:${u.reason}`).join(" | ")}`);
  } else {
    lines.push(`unresolved: none`);
  }
  if (envelope.items.length > 0) {
    lines.push(`items: ${envelope.items.length}`);
    for (const item of envelope.items) lines.push(formatItemLine(item));
  } else {
    lines.push(`items: 0`);
  }
  return lines.join("\n");
}

export function renderAgentContext(envelope: GraphContextEnvelope): { text: string; omittedItems: number } {
  const omittedItems = omittedFor(envelope.items, envelope.totals);
  return { text: renderText(envelope, omittedItems), omittedItems };
}

export function buildAgentContext(input: {
  op: GraphContextOp;
  level: GraphContextLevel;
  envelope?: QueryEnvelope;
  subjects: readonly GraphContextSubject[];
  correlation: GraphContextCorrelation;
  status?: Partial<GraphContextStatus>;
  reasonCodes?: readonly string[];
  maxBytes?: number;
  unresolved?: readonly GraphContextUnresolved[];
}): GraphContextEnvelope {
  const maxBytes = normalizeMaxBytes(input.maxBytes);
  const source = input.envelope;
  const fullItems: readonly QueryItem[] = source?.items ?? [];
  const totals: QueryTotals = source?.totals ?? {
    displayed: fullItems.length,
    known: fullItems.length,
    hidden: 0,
  };
  const shown: ShownOf = source?.shownOf ?? {};
  const completenessStatus: CompletenessStatus = source?.completeness ?? "complete";
  const completenessReasons: readonly CompletenessReason[] =
    source?.completenessReason !== undefined ? [source.completenessReason] : [];

  const mappedUnresolved: GraphContextUnresolved[] = [];
  if (source !== undefined) {
    source.unresolved.forEach((reason, index) => {
      mappedUnresolved.push({ kind: "unresolved", id: `query-unresolved-${index}`, reason });
    });
    source.unsupported.forEach((reason, index) => {
      mappedUnresolved.push({ kind: "unsupported", id: `query-unsupported-${index}`, reason });
    });
  }
  const unresolved: readonly GraphContextUnresolved[] = [
    ...(input.unresolved ?? []),
    ...mappedUnresolved,
  ];

  const freshness = input.status?.freshness ?? source?.freshness ?? "fresh";
  const coverage = input.status?.coverage ?? source?.coverage ?? "indexed";
  const revision = input.status?.revision ?? source?.revision ?? input.correlation.revision;
  const generation = input.status?.generation ?? input.correlation.generation;
  const queryServable = input.status?.queryServable ?? (source !== undefined);
  const reasons: readonly string[] =
    input.status?.reasons ?? (source === undefined ? ["no-envelope"] : []);

  let unavailable: { readonly code: string; readonly message: string } | undefined;
  if (source === undefined) {
    unavailable = {
      code: "GRAPH_UNAVAILABLE",
      message: reasons.length > 0
        ? `no query envelope provided (${reasons.join("; ")})`
        : "no query envelope provided",
    };
  } else if (queryServable === false) {
    unavailable = {
      code: "GRAPH_UNAVAILABLE",
      message: reasons.length > 0 ? reasons.join("; ") : "query not servable",
    };
  }

  const unanswered = decideUnanswered({
    unavailable,
    queryServable,
    freshness,
    completeness: completenessStatus,
    unresolvedCount: unresolved.length,
    items: fullItems,
  });

  const reasonCodes: readonly string[] = input.reasonCodes ?? [];
  const sourceTruncated = source?.truncated === true || completenessStatus === "truncated";

  // Budget truncation: drop items from the end until the rendered text fits.
  // Totals stay at the source counts so omittedItems remains honest.
  let kept: readonly QueryItem[] = fullItems;
  let truncatedByBudget = false;
  const measure = (candidate: readonly QueryItem[]): number => {
    const probe: GraphContextEnvelope = {
      op: input.op,
      level: input.level,
      subjects: input.subjects,
      correlation: input.correlation,
      status: { freshness, coverage, generation, revision, queryServable, reasons },
      items: candidate,
      totals,
      shown,
      completeness: { status: completenessStatus, reasons: completenessReasons },
      unresolved,
      budget: { maxBytes, bytes: 0, estimatedTokens: 0, truncatedBy: "none" },
      reasonCodes,
      unanswered,
      ...(unavailable !== undefined ? { unavailable } : {}),
    };
    return textBytes(renderText(probe, omittedFor(candidate, totals)));
  };
  if (measure(kept) > maxBytes) {
    let next = kept.slice(0, kept.length > 0 ? kept.length - 1 : 0);
    while (next.length > 0 && measure(next) > maxBytes) next = next.slice(0, next.length - 1);
    // When even zero items exceed maxBytes the header alone is over budget;
    // keep zero items and still report the byte truncation honestly.
    if (next.length === 0 && measure(next) > maxBytes) {
      kept = [];
      truncatedByBudget = fullItems.length > 0 || measure(fullItems) > maxBytes;
    } else {
      truncatedByBudget = next.length < fullItems.length;
      kept = next;
    }
    if (fullItems.length === 0 && measure(fullItems) > maxBytes) truncatedByBudget = true;
  }
  const truncatedBy: "none" | "bytes" | "items" = truncatedByBudget
    ? "bytes"
    : sourceTruncated
      ? "items"
      : "none";

  // Fixpoint for the self-describing budget line: the printed bytes/tokens
  // must match the final text length, and digit-width changes converge fast.
  let budget: GraphContextBudget = { maxBytes, bytes: 0, estimatedTokens: 0, truncatedBy };
  let envelope: GraphContextEnvelope = {
    op: input.op,
    level: input.level,
    subjects: input.subjects,
    correlation: input.correlation,
    status: { freshness, coverage, generation, revision, queryServable, reasons },
    items: kept,
    totals,
    shown,
    completeness: { status: completenessStatus, reasons: completenessReasons },
    unresolved,
    budget,
    reasonCodes,
    unanswered,
    ...(unavailable !== undefined ? { unavailable } : {}),
  };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const text = renderText(envelope, omittedFor(envelope.items, envelope.totals));
    const bytes = textBytes(text);
    const estimatedTokens = estimateTokens(text);
    if (budget.bytes === bytes && budget.estimatedTokens === estimatedTokens) break;
    budget = { maxBytes, bytes, estimatedTokens, truncatedBy };
    envelope = { ...envelope, budget };
  }
  return envelope;
}
