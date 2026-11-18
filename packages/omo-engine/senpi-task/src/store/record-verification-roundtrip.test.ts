import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskRecord } from "../state"
import type { TaskRecord } from "../state"
import { parseTaskRecord } from "./record-parse"
import { createTaskRecordStore } from "./record-store"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-task-verification-roundtrip-"))
  cleanupRoots.push(directory)
  return directory
}

function completedRecord(taskId: string): TaskRecord {
  const base = createTaskRecord({
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 0,
    execution_mode: "in-process",
    model: "anthropic/claude-opus-4",
    notify_on_terminal: false,
  })
  return {
    ...base,
    task_id: taskId,
    status: "completed",
    updated_at: "2026-01-01T00:01:00.000Z",
    terminal_at: "2026-01-01T00:01:00.000Z",
  }
}

describe("record store verification claim round-trip", () => {
  test("#given a completed record carrying the gate claim #when saved and reloaded through the store #then the claim survives intact", () => {
    // given: the manager stamps verification_status after the terminal write, so the record on disk
    // carries the claim. The spread keeps the extra field while staying assignable to TaskRecord.
    const project = tempProject()
    const writer = createTaskRecordStore({ project_dir: project })
    const persisted = { ...completedRecord("st_00000031"), verification_status: "verified" as const }

    // when
    writer.save(persisted)
    const loaded = createTaskRecordStore({ project_dir: project }).load("st_00000031")

    // then: the real parse path must return the claim the write path persisted.
    expect(loaded).toMatchObject({ verification_status: "verified" })
  })

  test("#given a legacy completed record without a claim #when reloaded through the store #then the field stays absent and never becomes a value", () => {
    // given: a record written before the completion gate existed
    const project = tempProject()
    const writer = createTaskRecordStore({ project_dir: project })

    // when
    writer.save(completedRecord("st_00000032"))
    const loaded = createTaskRecordStore({ project_dir: project }).load("st_00000032")

    // then: the record still loads, and absence is preserved as absence. Inventing "unverified" or
    // "verified" here would turn no evidence into a claim.
    expect(loaded?.status).toBe("completed")
    expect(loaded).not.toHaveProperty("verification_status")
  })

  test("#given a stamped record #when the store rewrites it for an unrelated fact #then the claim is not erased", () => {
    // given: a copied/stamped record whose later mutation re-reads through the parser before writing
    const project = tempProject()
    const writer = createTaskRecordStore({ project_dir: project })
    writer.save({ ...completedRecord("st_00000033"), verification_status: "verified" as const })

    // when
    writer.mutate("st_00000033", (fresh) => ({ ...fresh, updated_at: "2026-01-01T00:02:00.000Z" }))
    const loaded = createTaskRecordStore({ project_dir: project }).load("st_00000033")

    // then: the rewrite preserves the claim it read, so a later bookkeeping write cannot drop it.
    expect(loaded).toMatchObject({
      verification_status: "verified",
      updated_at: "2026-01-01T00:02:00.000Z",
    })
  })

  test.each([
    { label: "a non-string value", value: 42, error: /verification_status is not a string/ },
    { label: "an unknown status", value: "trusted", error: /verification_status has an invalid value/ },
  ])(
    "#given a persisted claim with $label #when parsed #then the corrupted record is rejected instead of coerced",
    ({ value, error }) => {
      // given
      const raw: unknown = JSON.parse(JSON.stringify({ ...completedRecord("st_00000034"), verification_status: value }))

      // when / then
      expect(() => parseTaskRecord(raw, "record.json")).toThrow(error)
    },
  )
})
