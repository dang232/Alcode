---
name: hyperplan
description: Adversarial planning where a hostile team cross-critiques a plan before it is formalized. Use when planning needs maximum rigor or the user asks for adversarial review of a plan.
compatibility: alcode>=2.0
metadata:
  requires: goal-tool, team-tools
---

# hyperplan

Stress-test a plan with a team paid to break it, then formalize what
survives.

## Process

1. Draft the plan (goal, steps, assumptions per step).
2. Assign critics: one per assumption class (correctness, scope, failure
   modes, cost). Each critic's deliverable is a ranked break-list with
   file:line or scenario refs.
3. The plan survives only what no critic breaks; every break becomes a plan
   amendment or an accepted risk with its name on it.
4. Formalize the surviving plan to `.omo/plans/<slug>.md` and proceed under
   `ulw-plan` handoff rules.

## Rules

- Critics attack the plan, never each other; heat stays on the artifact.
- A criticism without a ref is a note, not a blocker.
