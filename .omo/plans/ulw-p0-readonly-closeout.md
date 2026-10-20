# P0 plan: read-only ULW close-out repair

## Goal
Fresh read-only ULW tasks close end-to-end on their original goals. No probe
goals, no checkpoint spin, provider failures recorded as failures.

## Steps
1. Read engine hotspots: checkpoint.ts, steering.ts (revise_criterion),
   success-criteria-input.ts, evidence.ts gate region, quality-gate.ts,
   stop-resume-hook.ts, codex-hook.ts, cli flows for create-goals/steer.
   Note test precedent and fixtures layout.
2. Read nearest DOCUMENTATION.md for each module touched, plus the
   ulw-loop package README if present.
3. Trace the outbound tool_choice source in the managed OpenCode path
   (packages/web/server/lib/opencode or managed config). Record file:line,
   provider, model, options. Attempt no live provider call from here;
   record the failure state instead.
4. Design the criteria fix: detect read-only vs implementation vs mixed
   at goal seeding (brief markers and/or explicit task-kind input),
   seed matching criteria, keep implementation default byte-identical
   in behavior. Confirm whether revise_criterion already covers
   post-hoc correction and reuse it.
5. Design bounded recovery: where the repeat-checkpoint-no-state-change
   stop lives (controller vs hook vs CLI output contract). Smallest
   mechanism that names the blocker and refuses further identical
   retries. No auto probe goals anywhere in that path.
6. Implement criteria seeding + tests (vitest, #given/#when/#then,
   fixtures in test/fixtures). Keep files under 250 pure LOC.
7. Implement bounded recovery + tests.
8. Rebuild dist (npm run build in the component), re-prove MCP
   record-evidence round-trip against the rebuilt CLI.
9. Fresh read-only end-to-end in scratch repo: create, dispatch (real
   workers? dispatch spawns loop workers via CLI, check what dispatch
   does headless), record-evidence from results, checkpoint, complete.
   Assert no probe goals, unresolved criteria stay unresolved, ledger
   and goals.json agree, dag-pane service projection shows terminal
   state accurately.
10. Focused suites for touched files, typecheck, lint, node --check on
    server.js. Stage own touched files only. Draft commit message,
    no commit.
11. Self-review in notepad, cleanup receipts, final report.

## Open questions
- Where does task-kind knowledge exist at create-goals time, if anywhere.
- Which component is "the controller" for retry bounding.
- What dispatch does without a live agent runtime (acceptance step 9).
