import { describe, expect, test } from "bun:test"

import { createPlannerEvidenceHook } from "./planner-evidence-hook"
import type { PlannerEvidence } from "../../cli/run/plan-evidence"

const block = "---\nPlan evidence (untrusted code-graph and memory):\nauthoritative constraints:\n- [pk-1] claim (source: a.ts)"

function evidence(text: string | undefined): PlannerEvidence {
  return { status: "available", text, bytes: text?.length ?? 0, diagnostics: { knowledgeRecords: 1 } } as unknown as PlannerEvidence
}

describe("planner evidence host hook", () => {
  test("#given an enabled feature and a user message #when the system transform runs #then the evidence block is appended", async () => {
    const notes: string[] = []
    const hook = createPlannerEvidenceHook({
      env: {},
      directory: () => "I:/repo",
      readLastUserText: async () => "fix the scheduler gate",
      buildEvidence: async (input) => {
        expect(input.message).toBe("fix the scheduler gate")
        expect(input.directory).toBe("I:/repo")
        return evidence(block)
      },
    })

    await hook.handler({ sessionID: "ses-1" }, { note: (text) => notes.push(text) })

    expect(notes).toEqual([block])
  })

  test("#given OMO_PLAN_EVIDENCE=0 #when the transform runs #then nothing is read and nothing is appended", async () => {
    const notes: string[] = []
    let read = false
    const hook = createPlannerEvidenceHook({
      env: { OMO_PLAN_EVIDENCE: "0" },
      directory: () => "I:/repo",
      readLastUserText: async () => {
        read = true
        return "fix"
      },
      buildEvidence: async () => evidence(block),
    })

    await hook.handler({ sessionID: "ses-1" }, { note: (text) => notes.push(text) })

    expect(read).toBe(false)
    expect(notes).toEqual([])
  })

  test("#given no user text #when the transform runs #then no evidence is requested", async () => {
    const notes: string[] = []
    let built = false
    const hook = createPlannerEvidenceHook({
      env: {},
      directory: () => "I:/repo",
      readLastUserText: async () => undefined,
      buildEvidence: async () => {
        built = true
        return evidence(block)
      },
    })

    await hook.handler({ sessionID: "ses-1" }, { note: (text) => notes.push(text) })

    expect(built).toBe(false)
    expect(notes).toEqual([])
  })

  test("#given the message read throws #when the transform runs #then the turn continues with no block", async () => {
    const notes: string[] = []
    const hook = createPlannerEvidenceHook({
      env: {},
      directory: () => "I:/repo",
      readLastUserText: async () => {
        throw new Error("client unavailable")
      },
      buildEvidence: async () => evidence(block),
    })

    await hook.handler({ sessionID: "ses-1" }, { note: (text) => notes.push(text) })

    expect(notes).toEqual([])
  })

  test("#given evidence building throws #when the transform runs #then the turn continues with no block", async () => {
    const notes: string[] = []
    const hook = createPlannerEvidenceHook({
      env: {},
      directory: () => "I:/repo",
      readLastUserText: async () => "fix",
      buildEvidence: async () => {
        throw new Error("graph unavailable")
      },
    })

    await hook.handler({ sessionID: "ses-1" }, { note: (text) => notes.push(text) })

    expect(notes).toEqual([])
  })

  test("#given evidence with no text #when the transform runs #then no empty note is appended", async () => {
    const notes: string[] = []
    const hook = createPlannerEvidenceHook({
      env: {},
      directory: () => "I:/repo",
      readLastUserText: async () => "fix",
      buildEvidence: async () => evidence(undefined),
    })

    await hook.handler({ sessionID: "ses-1" }, { note: (text) => notes.push(text) })

    expect(notes).toEqual([])
  })
})
