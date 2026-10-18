---
name: mass-ulw
description: Dependency-ordered fan-out that drives many work items through staged waves with retry and recovery. Use when the user asks for mass execution, a DAG of tasks, or fan-out where some tasks wait on others.
compatibility: alcode>=2.0
metadata:
  requires: goal-tool, team-tools
---

# mass-ulw

Define every phase's stages up front, run independent items in parallel,
gate dependents on their dependencies, recover per-item without losing the
wave.

## Process

1. Write the wave plan first: items, each item's dependencies, the stage
   order, what each stage delivers.
2. Dispatch independent items together (parallel `task` batch or cooperating
   team); keep write scopes disjoint per worker.
3. Gate each wave on its dependencies: a stage starts only when its inputs
   are terminal (completed, failed, or recorded inconclusive — never on
   silence).
4. Recover per item: retry, amend, or narrow-and-respawn; one item's failure
   aborts only its subtree.
5. Aggregate once per wave; record per-item PASS/FAIL with evidence.

## Rules

- Dependency order is declared before dispatch, not discovered mid-run.
- Silence is not terminal: end the turn and let completions wake the run.
