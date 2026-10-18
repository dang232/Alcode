---
name: dag-library
description: Stores a dependency-graph run definition once and re-runs it by name instead of redefining it every time. Use when the user wants to save a DAG, run a saved one, or repeat the same multi-agent graph on a schedule.
compatibility: alcode>=2.0
metadata:
  requires: dag-engine
---

# dag-library

Define once, re-run by name. The DAG engine owns scheduling and keyed
results; this skill owns the definition lifecycle.

## Process

1. Write the DAG definition: nodes (worker, inputs), edges (dependsOn),
   retry policy per node, what each node persists on completion.
2. Save it under a stable name with its version; versions are append-only —
   a change is a new version, never an edit that rewrites history.
3. Run by name; the engine admits a node once every dependency completed
   and delivers one aggregate per run.
4. On failure: the engine's journal names the failed node and its inputs;
   fix the definition (new version) or retry the node — never hand-edit a
   persisted result.

## Rules

- Definitions are plain data; the engine never executes embedded code.
- One failed node aborts only its dependents, never unrelated branches.
