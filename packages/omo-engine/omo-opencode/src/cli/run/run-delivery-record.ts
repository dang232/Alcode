// run-delivery-record.ts — the durable delivery record for one product run. It writes through the
// engine's own store so schema, ids, epochs and the state directory stay owned by senpi-task. Its
// verification claim comes only from the engine's approval chain and gate (run-verification.ts);
// nothing in this file can invent one, and a storage failure never changes a run's exit code.

import { createTaskRecord } from "../../../../senpi-task/src/state/record"
import type { TaskId } from "../../../../senpi-task/src/state/id"
import type { TaskRecordInput } from "../../../../senpi-task/src/state/types"
import { createTaskRecordStore } from "../../../../senpi-task/src/store/index"
import { verifyRunChanges } from "./run-verification"
import { writeDeliverySnapshot } from "./run-delivery-snapshot"

export type RunDeliveryModel = {
  readonly providerID: string
  readonly modelID: string
}

export type RunDeliveryFacts = {
  readonly sessionId: string
  readonly directory: string
  readonly agent: string
  readonly model?: RunDeliveryModel
  readonly strategy: string
  readonly graphLevel: number
}

export type RunDeliveryOutcome = {
  readonly sessionId: string
  readonly exitCode: number
  readonly durationMs: number
  readonly changedPaths: readonly string[]
}

export type RunDeliveryWrite =
  | { readonly written: true; readonly taskId: string; readonly snapshotWritten?: boolean }
  | { readonly written: false; readonly reason: string }

const DELIVERY_RECORD_NAME = "product run"
const ERROR_MESSAGE_LIMIT = 512
const CHANGED_PATH_LIMIT = 200

function isTruthyFlag(value: string): boolean {
  return value === "1" || value === "on" || value === "true"
}

function isFalsyFlag(value: string): boolean {
  return value === "0" || value === "off" || value === "false"
}

export function shouldRecordRunDelivery(env: NodeJS.ProcessEnv): boolean {
  const explicit = (env.OMO_RUN_DELIVERY_RECORD ?? "").trim().toLowerCase()
  if (isFalsyFlag(explicit)) return false
  if (isTruthyFlag(explicit)) return true
  return (env.OMO_PRODUCT_RUN ?? "").trim() === "1"
}

export function buildRunDeliveryInput(facts: RunDeliveryFacts): TaskRecordInput {
  const model =
    facts.model === undefined ? "unspecified" : `${facts.model.providerID}/${facts.model.modelID}`
  return {
    name: DELIVERY_RECORD_NAME,
    task_summary: `${facts.strategy} run`,
    parent_session_id: facts.sessionId,
    root_session_id: facts.sessionId,
    depth: 0,
    execution_mode: "process",
    model,
    agent_type: facts.agent,
    notify_on_terminal: false,
  }
}

function messageOf(error: Error | string): string {
  const text = error instanceof Error ? error.message : error
  return text.slice(0, ERROR_MESSAGE_LIMIT)
}

export type RunDeliveryRecorderOptions = {
  readonly directory: string
}

type VerificationEventPayload = {
  verification: string
  evidenceFiles: number
  reason?: string
  code?: string
}

export type RunDeliveryRecorder = {
  readonly stateDir: string
  start(facts: RunDeliveryFacts): RunDeliveryWrite
  finish(outcome: RunDeliveryOutcome): Promise<RunDeliveryWrite>
  fail(error: Error | string): RunDeliveryWrite
}

export function createRunDeliveryRecorder(options: RunDeliveryRecorderOptions): RunDeliveryRecorder {
  const store = createTaskRecordStore({ project_dir: options.directory })
  let taskId: TaskId | undefined
  let sessionId: string | undefined
  let lastExitCode: number | undefined

  const currentTaskId = (): TaskId | undefined => taskId

  const projectSnapshot = (id: TaskId): boolean => {
    if (sessionId === undefined) return false
    const stamped = store.load(id)
    if (stamped === null) return false
    store.appendEvent(id, { type: "run_snapshot_pending", payload: { sessionId } })
    const record: DeliverySnapshotRecord = {
      task_id: stamped.task_id,
      status: stamped.status,
      model: stamped.model,
    }
    if (stamped.child_session_id !== undefined) record.child_session_id = stamped.child_session_id
    if (stamped.name !== undefined) record.name = stamped.name
    if (stamped.task_summary !== undefined) record.task_summary = stamped.task_summary
    if (stamped.started_at !== undefined) record.started_at = stamped.started_at
    if (stamped.terminal_at !== undefined) record.terminal_at = stamped.terminal_at
    if (stamped.verification_status !== undefined) record.verification_status = stamped.verification_status
    if (lastExitCode !== undefined) record.exit_code = lastExitCode
    const snapshot = writeDeliverySnapshot({
      directory: options.directory,
      sessionId,
      updatedAt: new Date().toISOString(),
      record,
    })
    store.appendEvent(id, {
      type: "run_snapshot",
      payload: snapshot.written ? { path: snapshot.path } : { reason: snapshot.reason },
    })
    return snapshot.written
  }

  return {
    stateDir: store.stateDir,

    start(facts) {
      try {
        const record = createTaskRecord(buildRunDeliveryInput(facts))
        store.save(record)
        taskId = record.task_id
        sessionId = facts.sessionId
        store.transition(record.task_id, {
          type: "start",
          timestamp: new Date().toISOString(),
          child_session_id: facts.sessionId,
        })
        return { written: true, taskId: record.task_id }
      } catch (error) {
        return { written: false, reason: messageOf(error) }
      }
    },

    async finish(outcome) {
      const id = currentTaskId()
      if (id === undefined) return { written: false, reason: "record not started" }
      try {
        const timestamp = new Date().toISOString()
        // A non-zero exit IS the task outcome, not a note attached to a success:
        // the lifecycle says failed, and the exit code is recorded beside it.
        if (outcome.exitCode === 0) {
          store.transition(id, { type: "complete", timestamp, final_response: "completed" })
        } else {
          store.transition(id, {
            type: "fail",
            timestamp,
            error_message: `execution exited with code ${outcome.exitCode}`,
          })
        }
        store.appendEvent(id, {
          type: "run_delivery",
          payload: {
            exitCode: outcome.exitCode,
            durationMs: outcome.durationMs,
            changedFiles: outcome.changedPaths.slice(0, CHANGED_PATH_LIMIT),
          },
        })
        const verification = await verifyRunChanges({
          directory: options.directory,
          taskId: id,
          sessionId: outcome.sessionId,
          epoch: 0,
          changedPaths: outcome.changedPaths,
        })
        lastExitCode = outcome.exitCode
        store.mutate(id, (record) => ({ ...record, verification_status: verification.verification }))
        const verificationPayload: VerificationEventPayload = {
          verification: verification.verification,
          evidenceFiles: verification.evidencePaths.length,
        }
        if (verification.reason !== undefined) verificationPayload.reason = verification.reason
        if (verification.code !== undefined) verificationPayload.code = verification.code
        store.appendEvent(id, { type: "run_verification", payload: verificationPayload })
        return { written: true, taskId: id, snapshotWritten: projectSnapshot(id) }
      } catch (error) {
        return { written: false, reason: messageOf(error) }
      }
    },

    fail(error: Error | string) {
      const id = currentTaskId()
      if (id === undefined) return { written: false, reason: "record not started" }
      try {
        store.transition(id, {
          type: "fail",
          timestamp: new Date().toISOString(),
          error_message: messageOf(error),
        })
        store.appendEvent(id, { type: "run_delivery_failed", payload: { error: messageOf(error) } })
        return { written: true, taskId: id, snapshotWritten: projectSnapshot(id) }
      } catch (transitionError) {
        return { written: false, reason: messageOf(transitionError) }
      }
    },
  }
}
