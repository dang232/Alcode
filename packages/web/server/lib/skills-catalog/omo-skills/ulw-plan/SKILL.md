---
name: ulw-plan
description: Explore-first planning that writes one decision-complete work plan before coding. Activates ONLY on the user's explicit request for a plan before implementation; never self-activates on a bare run.
compatibility: alcode>=2.0
metadata:
  requires: goal-tool
---

# ulw-plan

Turn a vague or large request into ONE decision-complete work plan a worker
executes with zero further interview. Plan; never implement.

## Process

1. Explore the codebase first (read, search, trace callers). Ground every
   decision in what the code actually does.
2. Ask only the questions exploration cannot resolve. If intent is fuzzy,
   research best practice instead of interrogating.
3. Wait for explicit user approval of the approach before writing the plan.
4. Write the plan to `.omo/plans/<slug>.md`: goal, findings with file:line
   refs, ordered steps with verify-per-step, risks, stop line.
5. Hand off; implementation begins only when the user explicitly starts it.

## Rules

- Sticky plan mode: "do X" means "plan X" until the user starts execution.
- One plan, one file. Amend the file instead of scattering follow-ups.
