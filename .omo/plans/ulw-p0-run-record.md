# Ultrawork Notepad — P0 read-only ULW close-out
Started: 2026-10-20T22:01:38.761Z
RUN_TMP: C:\Users\dangq\AppData\Local\Temp\ulw-p0-1JoOFO
Tier: HEAVY (goal domain model + engine hotspots + provider path; P0 care signal). No ulw-plan plan file exists for this work, so the reviewer gate does not trigger; self-review lands here.

## Plan (exhaustively detailed)
(see .omo/plans/ulw-p0-readonly-closeout.md)

## Success criteria + QA scenarios
(see registered goal)

## Now
bootstrap: goal registered; opening notepad

## Todo
(see todo list)

## Findings
- plan-goal-factory.ts:66 seeds happy/edge/regression for every goal regardless of task kind. Root cause of criterion mismatch.
- evidence.ts:198,215,224 throws ulw_loop_criteria_not_all_pass. The gate itself is strict by design.
- MCP server.js TOOLS lacked record-evidence; one-line mapping added + staged earlier this session, proven on scratch.
- AGENTS.md forbids git commands unless the user asks; this run needs git status/staging reads. Conflict noted: keep git use read-only plus staging of own touched files only, no commits/pushes/merges per user ban.
- Skills: openchamber-change-discipline and communication-style apply. No other project skill fits; DAG/panels untouched per directive.

## Learnings

## Design (recorded 2026-10-20)
### Criteria seeding
- New optional taskKind on goal seeds: "implementation" default. Current triple stays byte-identical when kind is absent.
- "readonly" seeds findings / supporting evidence / scope-limitations. "mixed" seeds readonly triple plus implementation triple (C001-C006).
- userModel enum gains "findings", "evidence", "limitations". Consumers checked: goal-status.ts:97 fallback only fires without explicit essential flags (factory sets them, safe); codex-goal-instruction.ts:109 renders the value as text (safe); criteriaFromInput/isModel validation accepts new values (safe); revise_criterion --user-model accepts new values (safe). Backward compatible: old data still validates.
- Plumbing: GoalSeedOptions.taskKind through makeGoal and seedDefaultSuccessCriteria, plan-crud create flow, create-goals --task-kind flag, MCP create-goals rides the generic camelCase-to-kebab mapping with no server change. create-goals tool description update names readonly for surveys.
- No brief sniffing: misclassification would weaken the gate, the wrong direction. Explicit kind only.
- revise_criterion already covers post-hoc repair of G003-G007 style goals. No change there.
### Bounded recovery
- New module checkpoint-retry-budget.ts beside checkpoint-continuation.ts. Counter files checkpoint-retry-<goalId>.json plus .stuck marker, outside the log, mirroring stop-resume-hook.ts consumeResumeBudget (cap, ledger-growth reset, fail-closed, path traversal guard).
- Signature: error code plus sorted unresolved criterion ids and statuses. Reset when ledger grows or the unresolved set changes. Cap 3 identical rejections.
- Wired in checkpoint-continuation.ts checkpoint() so library checkpointUlwLoop semantics and its tests stay untouched.
- Terminal code ulw_loop_checkpoint_retry_exhausted names criteria, gives per-criterion record-evidence commands, the steer revise_criterion repair, forbids probe goals, points at checkpoint --status blocked. Message lists reused worker results.
### tool_choice (section 4)
- Negative trace: no setter in packages/web/server/lib, packages/ui/src/lib/opencode, alcore-provider, or managed opencode lib. Capabilities snapshot tracks only toolCall bool and predates model 1.3. Cause sits upstream of this repo (managed core or provider gateway). No code change here; report the trace and the loop-side safety net (stop-resume RESUME_CAP plus stuck marker). No live provider claim.

## E2E (2026-10-20 scratch ulw-p0-e2e-session)
- create-goals --task-kind readonly via MCP: plan.taskKind readonly, goal.taskKind readonly, C001:findings/C002:evidence/C003:limitations pending.
- dispatch + record-child-result: worker settled on ORIGINAL goal, no probe goals (goal count stayed 2).
- record-evidence C001+C002 pass, then checkpoint complete SUCCEEDED with C003 still pending (limitations is non-essential, mirrors regression:false). Proves unverified-nonessential stays unresolved while applicable criteria close the goal.
- record-evidence C003 + checkpoint: goal_completed, all pass.
- Ledger: plan_created,goal_dispatched,child_completed,evidence_captured x2,goal_completed,goal_started,evidence_captured,goal_completed. G002 auto-advanced to in_progress (existing advance behavior).
- DAG GET /loop projection: run running, counts pending:0/running:3/completed:2, G001 completed + worker completed, G002 running, synthesis running. Accurate.
- QA scripts: RUN_TMP/e2e-closeout.mjs, e2e-projection.mjs (cleanup pending).

## Cleanup
- QA scripts removed: e2e-closeout.mjs, e2e-projection.mjs. Scratch loop state removed: ulw-p0-e2e session dir. dag-p0 snapshot dirs removed.
- No live processes held: all MCP server spawns awaited to exit; no tmux/browser/ports used.
- RUN_TMP removed after copying this record.

## Section 4 trace addendum (completion audit)
- Searched for tool_choice/toolChoice across: packages/web/server/lib, packages/ui/src/lib/opencode, packages/electron, packages/omo-engine/omo-codex, packages/omo-engine/omo-opencode, installed opencode-ai@1.19.0. All negative.
- Positive hit: managed upstream engine binary C:/Users/dangq/.opencode/bin/opencode.exe at byte offset 98666176, adjacent to mistral-chat / MistralChat.fromRequest provider-request strings. The setter lives in upstream provider-request code, outside this repo and off-limits to modify. No file:line exists in this repo; this is the complete trace, not a gap in effort.
- Recorded-failure path in-contract: record-child-failure persists goal failed plus workerSessionId plus failureReason plus child_failed entry (cli-dispatch-record.test.ts, green). Stalled runs are bounded by stop-resume-hook RESUME_CAP plus .stuck marker (stop-resume-hook.test.ts, green).
- No live provider claim: no succeeding request captured, none claimed.
