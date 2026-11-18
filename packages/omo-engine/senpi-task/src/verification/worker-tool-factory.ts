// Host-owned construction of the ordinary worker's verification tool.
//
// The child receives a live ToolDefinition whose closures were built by the host: the binding is
// re-resolved from the host's own task record on every call, the change set is re-snapshotted from
// the host's own baseline, and the catalogue is re-resolved from the host's own tree. Nothing the
// child sends can name a run, widen a change set, or approve a check — the request schema is empty,
// so ownership is something the host already knows, never something the caller is trusted with.
import { approvalAuthorityFor, type ApprovalAuthority } from "./approval-authority"
import { readApprovals, type ApprovalRead } from "./approval-store"
import { createFileEvidenceStore, workspaceRevision } from "./evidence-store"
import { createOrdinaryVerificationCapture, type OrdinaryVerificationCapture } from "./ordinary-capture"
import { resolveCatalogue } from "./resolution"
import { changedPathsSince, type WorkspaceBaseline } from "./run-provenance"
import { createVerificationWorkerTool, type VerifyTool } from "./verify-tool"
import { resolveWorkerVerificationContext, type WorkerContextSource } from "./worker-context"

export type WorkerVerificationHost = {
  // The host-pinned identity of the run this tool serves; mirrored into every evidence record.
  readonly taskId: string
  // The persisted spawn_spec.cwd: the directory the worker was actually launched in.
  readonly projectRoot: string
  // Host state, never the workspace: an injected root wins, otherwise the host default.
  readonly authority?: ApprovalAuthority
  // The approval snapshot the host already read for this spawn. Supplying it keeps the tool and the
  // completion gate on ONE read, so a mid-run write cannot reach one without the other.
  readonly approvals?: ApprovalRead
  // <store.stateDir>/verifications: the evidence tree this tool writes into.
  readonly evidenceRoot: string
  readonly record: () => WorkerContextSource | undefined
  // Null when the host could not attribute changes (a tree it could not snapshot): the tool then
  // fails closed as verification_provenance_unknown instead of guessing a change set.
  readonly baseline: WorkspaceBaseline | null
  readonly isCancelled: () => boolean
}

// The workspace identity an ordinary run is approved under. One run per spawn_spec.cwd, so the
// single root identity is both sufficient and tighter than a name the child could influence.
const ORDINARY_WORKSPACE_ID = "."

// One tool per child: the capture behind it is serialized so at most one verification runs at a
// time against this tool's evidence path, however the child interleaves its own calls.
export function createWorkerVerificationTool(host: WorkerVerificationHost): VerifyTool {
  const changedFiles = (): readonly string[] | null =>
    host.baseline === null ? null : changedPathsSince(host.projectRoot, host.baseline)
  // Approval authority is read ONCE, before the child can act. The store lives in the project tree
  // the child can write, so re-reading it at call time would let the worker mint its own approval
  // mid-run and then execute the command it just authorized; a snapshot taken at spawn cannot be
  // influenced by the run it authorizes. A human approving later applies to the next spawn.
  const authority = host.authority ?? approvalAuthorityFor(host.projectRoot)
  const approvals = host.approvals ?? readApprovals(authority, ORDINARY_WORKSPACE_ID)
  const capture = createOrdinaryVerificationCapture({
    store: createFileEvidenceStore(host.evidenceRoot),
    projectDir: host.projectRoot,
    currentRevision: () => workspaceRevision(host.projectRoot),
    isCancelled: host.isCancelled,
  })
  // Chain calls through a single promise so a second concurrent execute awaits the first instead
  // of interleaving over the same evidence path. The tail swallows only the chain's own copy:
  // every caller still receives its own result or its own rejection.
  let tail: Promise<unknown> = Promise.resolve()
  const serialized: OrdinaryVerificationCapture = {
    capture: (input) => {
      const run = tail.then(() => capture.capture(input))
      tail = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    },
  }
  return createVerificationWorkerTool({
    capture: serialized,
    binding: () => {
      const record = host.record()
      if (record === undefined) return null
      return resolveWorkerVerificationContext(record)?.binding ?? null
    },
    changedFiles,
    catalogue: () =>
      resolveCatalogue({
        projectRoot: host.projectRoot,
        workspaceId: ORDINARY_WORKSPACE_ID,
        // Evaluated per call from the same attribution function above, so the catalogue always
        // reflects the tree the child changed since the host's baseline - never a stale set.
        changedFiles: changedFiles(),
        authority,
        approvals,
      }),
  })
}
