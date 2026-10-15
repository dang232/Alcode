// Engine loop-status surface (reads-only) — ported from the T2 loop-status
// slice (migration commit 69809e1) onto the resolved bridge. The Engine tab
// page (EnginePage.tsx) on this line is a full React settings surface, so
// the slice's framework-free renderer lives here instead of replacing that
// page: same view-model + HTML renderer, same graceful empty state (plan
// null, empty tail), still unit-testable without a browser runner.
//
// Ledger content is treated as data, never executed: every dynamic string
// is HTML-escaped before rendering.

export interface EngineLoopPlanView {
  title: string | null;
  status: string | null;
  goal: string | null;
  totalSteps: number | null;
  completedSteps: number | null;
}

export interface EngineLoopStatusInput {
  sessionId: string | null;
  plan: EngineLoopPlanView | null;
  ledgerTail: Array<Record<string, unknown>>;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function text(value: string | null): string {
  return value === null ? "" : escapeHtml(value);
}

function count(value: number | null): string {
  return value === null ? "" : escapeHtml(String(value));
}

/** Render the Engine tab loop-status panel as an HTML fragment. */
export function renderEngineLoopStatusHtml(input: EngineLoopStatusInput): string {
  const session = input.sessionId === null ? "" : escapeHtml(input.sessionId);
  const planBlock =
    input.plan === null
      ? '<p class="engine-empty-plan">No loop plan yet.</p>'
      : `<dl class="engine-plan-summary">` +
        `<dt>Title</dt><dd class="engine-plan-title">${text(input.plan.title)}</dd>` +
        `<dt>Status</dt><dd class="engine-plan-status">${text(input.plan.status)}</dd>` +
        `<dt>Goal</dt><dd class="engine-plan-goal">${text(input.plan.goal)}</dd>` +
        `<dt>Steps</dt><dd class="engine-plan-steps">${count(input.plan.completedSteps)}/${count(input.plan.totalSteps)}</dd>` +
        `</dl>`;
  const ledgerBlock =
    input.ledgerTail.length === 0
      ? '<p class="engine-empty-ledger">No ledger entries yet.</p>'
      : `<ul class="engine-ledger-tail">` +
        input.ledgerTail
          .map((entry) => `<li class="engine-ledger-entry"><code>${escapeHtml(JSON.stringify(entry))}</code></li>`)
          .join("") +
        `</ul>`;
  return (
    `<section class="engine-loop-status">` +
    `<h2 class="engine-loop-heading">Loop status</h2>` +
    `<p class="engine-loop-session">${session}</p>` +
    planBlock +
    ledgerBlock +
    `<p class="engine-reads-only">Reads-only view: this tab never runs the loop.</p>` +
    `</section>`
  );
}
