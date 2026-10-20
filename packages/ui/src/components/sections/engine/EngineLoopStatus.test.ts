// Engine loop-status surface: structure and escaping assertions only.
// No prose pinning: tests assert hooks, entry counts, and escaped output.
// Ported from the T2 loop-status slice (migration commit 69809e1); only the
// import path changed (renderer lives in EngineLoopStatus.ts on this line).
import { describe, expect, test } from "bun:test";
import { renderEngineLoopStatusHtml } from "./EngineLoopStatus.ts";

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("renderEngineLoopStatusHtml", () => {
  test("empty state exposes plan and ledger hooks with zero entries", () => {
    const html = renderEngineLoopStatusHtml({ sessionId: null, plan: null, ledgerTail: [] });
    expect(count(html, "engine-empty-plan")).toBeGreaterThan(0);
    expect(count(html, "engine-empty-ledger")).toBeGreaterThan(0);
    expect(count(html, "engine-ledger-entry")).toBe(0);
    expect(count(html, "engine-plan-summary")).toBe(0);
  });

  test("populated state renders the summary plus one hook per entry", () => {
    const html = renderEngineLoopStatusHtml({
      sessionId: "s-9",
      plan: { title: "T", status: "running", goal: "G", totalSteps: 2, completedSteps: 1 },
      ledgerTail: [{ seq: 1 }, { seq: 2 }],
    });
    expect(count(html, "engine-plan-summary")).toBe(1);
    expect(count(html, "engine-ledger-entry")).toBe(2);
    expect(count(html, "engine-empty-plan")).toBe(0);
    expect(count(html, "engine-empty-ledger")).toBe(0);
  });

  test("ledger payload is treated as data and escaped, never executed", () => {
    const html = renderEngineLoopStatusHtml({
      sessionId: '"><img src=x>',
      plan: null,
      ledgerTail: [{ note: "<script>alert(1)</script>" }],
    });
    expect(html.includes("<script>")).toBe(false);
    expect(html.includes("<img")).toBe(false);
    expect(html.includes("&lt;script&gt;")).toBe(true);
  });
});
