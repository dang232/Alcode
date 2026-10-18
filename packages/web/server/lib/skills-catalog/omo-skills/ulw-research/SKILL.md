---
name: ulw-research
description: Maximum-saturation research with a cooperating team, claim-graph gating, and a cited deliverable. Use when the user explicitly asks for research or a deep investigation.
compatibility: alcode>=2.0
metadata:
  requires: goal-tool, team-tools
---

# ulw-research

Answer a research question with saturating coverage and a cited, QA'd
deliverable. The lead coordinates; a team investigates in parallel.

## Process

1. Register the goal: the exact question, the decision it informs, the
   deliverable shape.
2. Decompose into independent investigation tracks; dispatch one member per
   track with a TASK prompt naming DELIVERABLE, SCOPE, VERIFY, STOP WHEN.
3. Gate claims: every non-obvious claim needs two independent sightings or
   one primary source; record the claim graph in the notepad.
4. Synthesize once: cited deliverable with file:line or URL refs, open
   questions labeled as such.
5. Tear down the team and record receipts.

## Rules

- Team tools are lead-only; members never receive lead lifecycle tools.
- Fan-out is safe only with disjoint write scopes.
- Outside-repo research names its sources; no source, no claim.
