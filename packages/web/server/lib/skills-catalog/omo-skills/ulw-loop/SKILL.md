---
name: ulw-loop
description: Goal-like loop that decomposes work into systematic, evidence-bound steps with checkpoints. Use when the user wants a goal loop, durable checkpointed execution, or a run that must survive interruption.
compatibility: alcode>=2.0
metadata:
  requires: goal-tool
---

# ulw-loop

Decompose the request into a goal with checkable criteria, then work the loop
until every criterion passes with evidence.

## Process

1. `create_goal` with the full objective and binary PASS/FAIL per criterion.
2. Break the goal into ordered steps in the todo list; one step in progress
   at a time.
3. After each step, capture the evidence (command output, screenshot path,
   delegation record) and checkpoint it in the notepad.
4. A step that fails twice identically is surfaced to the user with what was
   tried; a timeout waits on best judgment, never a blind retry.
5. Close the goal only when every criterion passes and owned QA state is
   torn down with receipts.

## Rules

- The loop owns the goal state; the todo list is its live cursor.
- Evidence stays valid until an input changes; re-run what moved.
- Never mark done from inference — only from captured evidence.
