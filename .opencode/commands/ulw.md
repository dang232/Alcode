---
description: Drive the OmO engine workflows — native run, loop status, worker jobs, driver resume, skills catalog, DAG pane, tab stats
---

You are working in the OpenChamber repository.

Goal: carry out the maintainer's engine request end to end using the OmO engine workflows on this merge line, not the wrapper fallbacks.

Focus, if any: $ARGUMENTS

Route the request to the workflow it belongs to, then run that workflow's own checks:

- **Native run** — `packages/web/server/lib/opencode/omo-bridge-runtime.js` runs native by gate decision. `OMO_NATIVE_RUN=0` restores the wrapper for rollback comparison only; a forced failure must surface the exact degraded message with 0 spawns, never a silent downgrade.
- **Loop status** — read-only `--loop-status` path (`{ok, sessionId, plan, ledgerTail}`, clamp-500-default-50). Corrupt ledgers degrade to plan null + empty tail with exit 0; never add execution, session, or spend to the reads path.
- **Worker jobs** — `packages/web/server/lib/opencode/omo-invoker-worker.ts`. Foreign session ids are refused fail-closed.
- **Loop session driver** — stop halts, resume completes from the ledger. Ownership (parent_session_id AND host_pid) is still enforced.
- **Skills catalog** — `packages/web/server/lib/opencode/skill-routes.js`: list engine skills, install landing SKILL.md on disk, ambiguous names refused. OpenCode-config skills stay untouched.
- **DAG pane** — bundled built-in, desktop-only gate on the new id. Never extend to web/VSCode/mobile; never migrate old folder installs.
- **Tab stats** — `packages/ui/src/lib/engine/engineSessionStats.ts` plus `EngineUsageSection.tsx`: populated, loading, degraded, and unreachable states, never blank.

Constraints: fixture-only QA, zero keyed spend, no engine behavior changes beyond what the request needs. Report the exact invocation per surface and stop at the first FAIL with the lane and repro.
