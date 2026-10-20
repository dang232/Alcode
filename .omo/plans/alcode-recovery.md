# Alcode recovery plan — OpenCode-native OmO workflow

## Phase 0 — Preserve (DONE)
- Recorded: main, 73243ade7, clean tree, 13/13 files present.
- No user edits to preserve; no blockers. No git writes at any point.

## Phase 1 — Model routing & agent identity
1. `.../agents/omo-native-catalog.js`: read headModelForStaticEntry + pinning — verify by noting exact lines.
2. `managed-config-file.js` + `agent-model-requirements.ts` + omo-opencode resolver: trace catalog→config→resolver→child — verify by path diagram in notepad.
3. Regression tests (6 cases: preferred ok / fallback same-agent / none eligible / explicit override / identity+perms preserved / no general substitution) — verify by failing-first run.
4. Fix: dispatch-time resolution via OpenCode-native resolver; regen bundle from source — verify by tests green + bundle diff sane.

## Phase 2 — tool_choice provider error
1. Trace failure to request builder; capture provider/model/reasoning/choice — verify by captured options in notepad.
2. Capability-aware fix in correct layer (≤1 safe retry, no dup tool exec) — verify by auto-only fixture + normal-model tests green.

## Phase 3 — Native ULW
1. Audit 6 files listed in objective — verify by seam map in notepad.
2. Real native controls via run/session/task interface; CLI recovery-only; real child IDs/events in DAG; working plugin tools/hooks — verify by read-only native live run.
3. Shell transcript stays for user commands only — verify by transcript inspection.

## Phase 4 — CI workflows
1. Move secrets.* out of job-level ifs (3 files), guarded steps via env — verify by parse + Actions summaries green core.

## Phase 5 — Acceptance
1. Focused suites → type-check → lint → tests → build — verify by outputs.
2. Live A-D via HTTP/CLI + user GUI cards (record tool constraint).

## Report
Per-issue root cause, file:line, changes, test output, live evidence,
identity/model notes, native-vs-CLI note, restart needs. No commits.

## Reframe (2026-10-19 ultrawork directive — supersedes symptom patches)
- Foreground-only mitigation REVERTED (ulwWorkflow.ts restored).
  Background delegation is required behavior; the fix restores the
  native path instead of routing around it.
- Evidence (C1 table) lives in the run notepad
  (C:/Users/dangq/AppData/Local/Temp/ulw-20261019-regression.md);
  this plan names gates only, never restates evidence.
- A/B protocol (test-only, reversible; needs stage+restart auth):
  1. Patch managed-config-file.js: omit mcp.servers.ulw when
     ALCODE_AB_OMIT_ULW_MCP=1 (both write paths). Done = patch
     applied, nothing else touched.
  2. Stage + restart app. Done = deployed opencode.managed.json
     read-back shows NO ulw entry.
  3. Run B (old route): same provider/model/variant/prompt/workspace/
     agent, fresh session, `ulw analyze this repo` shape. Done = five
     comparisons recorded (dispatch, background results, continuation,
     request options, tool_choice repro).
  4. Unset, restart, run A (new route), compare. Done = pair recorded.
  5. Revert patch + restart. Done = tree shows no AB residue.
- Restore seam: materialized omo-native plugin (empty setup) must load
  the omo-opencode plugin-setup chain (single source; runtime.js only
  materializes). CLI stays recovery-only.
- Acceptance gate (live `ulw analyze this repo`, same provider/model):
  background dispatch native, correct identities, real results,
  continuation clean (or captured cause shown fixed), synthesis gated,
  terminal states consistent, card+DAG truthful, reopen redispatch-free,
  CLI fallback functional but unused. Done = 8/8 recorded PASS.
