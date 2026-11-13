import { describe, expect, it } from "bun:test"

import { deliveryRunOf, deliveryStateOf } from "./run-delivery-snapshot"

const SESSION = "ses_matrix_0001"

const cases = [
  { label: "successful delivery", status: "completed", exitCode: 0, verification: "verified", state: "completed" },
  { label: "non-zero execution exit", status: "completed", exitCode: 2, verification: "unverified", state: "failed" },
  { label: "verification failure", status: "completed", exitCode: 0, verification: "blocked", state: "completed" },
  { label: "verification unavailable", status: "completed", exitCode: 0, verification: undefined, state: "completed" },
  { label: "cancellation", status: "cancelled", exitCode: undefined, verification: undefined, state: "cancelled" },
  { label: "timeout (interrupted)", status: "interrupted", exitCode: undefined, verification: undefined, state: "cancelled" },
  { label: "lost run", status: "lost", exitCode: undefined, verification: undefined, state: "failed" },
  { label: "engine error", status: "error", exitCode: 1, verification: "blocked", state: "failed" },
  { label: "still running", status: "running", exitCode: undefined, verification: undefined, state: "running" },
]

describe("delivery lifecycle matrix", () => {
  for (const entry of cases) {
    it(`${entry.label} maps to ${entry.state} with verification kept separate`, () => {
      const record: DeliverySnapshotRecord = {
        task_id: "st_01a1d800",
        status: entry.status,
        child_session_id: SESSION,
      }
      if (entry.exitCode !== undefined) record.exit_code = entry.exitCode
      if (entry.verification !== undefined) record.verification_status = entry.verification

      expect(deliveryStateOf(record)).toBe(entry.state)

      const run = deliveryRunOf(record, SESSION)
      const node = run.nodes[0]
      expect(node.state).toBe(entry.state)
      expect(node.verification_status).toBe(entry.verification)
      expect(node.exit_code).toBe(entry.exitCode)
    })
  }

  it("never derives verified from a successful exit", () => {
    const run = deliveryRunOf({ task_id: "st_01a1d801", status: "completed", child_session_id: SESSION, exit_code: 0 }, SESSION)
    expect(run.nodes[0].verification_status).toBeUndefined()
  })

  it("never derives success from a verified claim alone", () => {
    expect(deliveryStateOf({ task_id: "st_01a1d802", status: "error", child_session_id: SESSION, verification_status: "verified" })).toBe("failed")
  })
})
