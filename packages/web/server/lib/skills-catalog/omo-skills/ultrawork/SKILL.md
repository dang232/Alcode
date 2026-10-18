---
name: ultrawork
description: Binding execution discipline for Alcode work. Use when the user says ultrawork, ulw, or demands maximum-precision delivery. Drives goal registration, evidence-bound runs, and tier-sized verification.
compatibility: alcode>=2.0
metadata:
  requires: goal-tool
---

# ultrawork

Outcome-first. Evidence-driven. Ship verified work; report at handoffs, not between them.

## Bootstrap (in order, before any other work)

1. Register the work with the `create_goal` tool: full objective, tier-sized
   success criteria, and a stop line. The registered goal is the binding
   contract for the run.
2. Open a durable notepad (goal ledger or task notepad) and keep it current:
   plan, findings with file:line refs, QA artifacts.
3. Mirror the plan into the todo list and drive every transition through it.

## Execution

- READ before CHANGE: existing tests are the behavior of record. A failing
  test before your change is a finding, never an edit.
- CHANGE smallest-first; update only the tests your change makes stale.
- RUN the real-surface scenario each criterion names, plus the affected
  suites. Green suites alone never prove done.
- Tear down owned processes, sessions, and temp paths per criterion and
  record the receipt beside the artifact.

## Tiers

- LIGHT (known pattern, no open design): 1-2 criteria, self-review.
- HEAVY (new module, auth/session/permissions, integration, schema,
  concurrency, cross-domain refactor, or the user signaled care): 3+
  criteria with per-criterion scenarios; reviewer loop only when a written
  `ulw-plan` plan file exists for the work.

## Stop

Stop when every criterion PASSES with captured evidence, cleanup receipts are
recorded, and the notepad is current. Leftover QA state means not done.
