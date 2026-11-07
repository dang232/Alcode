# Agent Quality Gate — Phase 2

Status: **PARTIAL**. The shared contract is extracted and proven non-regressive; the ordinary-agent
completion boundary is still **not** gated, which is Phase 2.2. Phase 2.1 added host-controlled trusted evidence capture for ordinary runs; see §15. §14 names exactly which acceptance criteria are unmet.

## 1. Repository identity

| Field | Value |
|---|---|
| Remote | `https://github.com/dang232/Alcode.git` |
| Package | `alcode-monorepo` 0.2.3 |
| Branch | `main` |
| Base HEAD | `f0c6b70cc8d76401c8c84c9c22376bcf62117957` |
| Working tree | 11 entries before this phase, all preserved; nothing committed |

## 2. Existing architecture discovered

There are **two** real gates, and neither covers ordinary agent runs.

**ULW validation-batch gate** — `packages/omo-engine/omo-codex/plugin/components/ulw-loop/src/`:
`checkpoint.ts` requires `ULW_LOOP_VALIDATION_BATCH_GATE_REQUIRED` and per-surface sections;
`quality-gate.ts:67` exposes `validateQualityGate(input, opts)` returning `UlwLoopQualityGate`.

**DAG evidence-first gate** — `packages/omo-engine/senpi-task/src/dag/verification.ts` (602 lines).
Its own header states the doctrine: *"A worker's assertion is never evidence; only a genuine
execution record counts."* It already owns, and this phase did not rebuild:

| Capability | Symbol |
|---|---|
| 9 statuses, only `passed` accepting | `DAG_VERIFICATION_STATUSES`, `isVerificationAccepting` |
| Durable per-attempt evidence | `DagVerificationRecord` (run/node/check/sourceRevision/coveredPaths/attempt) |
| Risk-aware check selection | `selectVerificationChecks(scope, available, extraRequired?)` → `{required, omitted}` |
| Fail-closed acceptance | `evaluateAcceptance(input)` → missing/stale/failed reasons |
| Freshness by fingerprint | `checkVerificationFreshness` |
| Trusted execution | `DagVerifyRunner` (argv, timeout kill, cwd lock, output cap, secret scrubbing) |

Per `src/dag/AGENTS.md` the DAG gate is already load-bearing: *"Without a configured runner the node
fails closed instead of completing unverified."*

**The gap.** Ordinary (non-DAG) completion never reaches any of it. It terminates at
`packages/omo-engine/senpi-task/src/manager/manager-outcome.ts:239`:

```ts
persistTerminal(taskId, owned, timestamp, { type: "complete", final_response: outcome.finalResponse, ... })
```

`final_response` is the child's own prose. The only verification an ordinary or DAG completion
receives today is `completion/dag-verification-directive.ts` — **prompt text appended to the model
payload** (`DAG_VERIFICATION_DIRECTIVE`, `ASTRA_DAG_VERIFICATION_DIRECTIVE`), which is precisely the
prompt convention this phase was asked to replace with product enforcement.

## 3. Ordinary lifecycle and the enforcement boundary

```
agent execution
  runner (InProcessRunner | RpcProcessRunner) settles
    → ManagedChildHandle.waitForOutcome()            manager/manager-outcome.ts
    → ownedRecord() / stoppedRunRecord()             ownership + epoch fencing
    → settleIsolationFor()                           clone merge, awaited before the terminal write
    → persistTerminal(taskId, owned, ts, {type:"complete", final_response})
        ← **EARLIEST RELIABLE ENFORCEMENT BOUNDARY**: one funnel, already fenced by run_epoch,
          already idempotent against duplicate outcomes, already ordered after merge
    → TaskRecordStore.save()                         durable terminal record
    → settleWaiters()                                waiters, DAG scheduler folding
    → completion notifier                            parent wake / buffer / queue
    → UI (task_output, DAG pane, session events)
```

`TaskStatus` is `pending|running|completed|error|cancelled|interrupted|lost`
(`state/types.ts:40-47`); `STOPPED_RUN_TERMINAL` in `manager-outcome.ts` already treats every
non-pending status as terminal, so the boundary already owns the terminal-transition decision.

**Why this boundary.** It is the single place an ordinary run becomes `completed`; it is already
epoch-fenced (duplicate/late outcomes are dropped), already ordered after isolation merge, and
already the point where waiters and the notifier fan out. Enforcing later (notifier or UI) would
publish success first and reverse it — forbidden by §4 rule 3.

**What the boundary is still missing for enforcement.** There is no trusted evidence to read.
`TaskRunStats` carries aggregates only (`tool_calls` is a count); there is no per-command record
with command, exit code and revision. So a gate wired today would have nothing to accept.

## 4. Shared contract design

**Extracted** (`packages/omo-engine/senpi-task/src/verification/contract.ts`): the vocabulary and
the trusted-execution types — statuses, `isVerificationAccepting`, check categories,
`VerificationCheck`, `VerificationCommandResult`, `VerificationRunnerInput`, `VerificationRunner`,
`FAILURE_CLASSIFICATIONS`. `dag/verification.ts` imports these under its existing `DAG_*`/`Dag*`
names **and re-exports them**, so its public API is byte-identical for every current caller.

**Deliberately not extracted.** An earlier draft of this phase added `classifyTask`,
`requiredChecksFor` and `evaluateVerification` to the shared module. Reading `src/dag/AGENTS.md`
showed `selectVerificationChecks` already implements exactly that policy (including the docs-only
rule: *"docs-only change carries no executable behavior"*) and `evaluateAcceptance` already decides
acceptance fail-closed. Those functions were deleted rather than shipped: a second policy is a
second gate, which the mission forbids.

**Policy table — the existing engine, as it stands today:**

| Task class | Selected by | Required checks | Evidence rule |
|---|---|---|---|
| Code change | observed changed paths | `typecheck`, `lint`, plus `build`/`native`/`schema` when those surfaces changed | `passed` + matching revision + exit 0 |
| Docs-only | all changed paths documentation | none executable (unit/integration omitted with reason) | `NOT_REQUIRED` |
| Research / conversational | no changed paths | none | `NOT_REQUIRED` |
| Mixed | both | union | union |
| No change | no changed paths | none | `NOT_REQUIRED`, recorded as no-change |

Verdicts stay four-valued (`PASS`, `FAIL`, `INCOMPLETE`, `NOT_REQUIRED`); `evaluateAcceptance`
already refuses to collapse them.

## 5. Files changed

| File | Why |
|---|---|
| `senpi-task/src/verification/contract.ts` | **new** — shared vocabulary half of the contract |
| `senpi-task/src/dag/verification.ts` | definitions replaced by imports + aliased re-exports; no behavior change |

Nothing else. No dependencies added.

## 6. ULW compatibility

`ULW_LOOP_VALIDATION_BATCH_GATE_REQUIRED`, the required per-surface sections, and
`validateQualityGate` are untouched. The DAG acceptance path (`selectVerificationChecks`,
`evaluateAcceptance`, freshness, redaction) is untouched in behavior: only where the types are
declared moved. Its 30 verification tests pass unchanged (§7).

## 7. Tests

```
cd packages/omo-engine/senpi-task
bun test src/dag/verification.test.ts src/dag/scheduler-verification.test.ts
  → 30 pass, 0 fail, 78 expect() calls

bun test src/dag
  → 562 pass, 4 fail of 566 tests across 46 files (66.35s)
```

The package's `typecheck` script is `tsgo --noEmit`; **`tsgo` is not installed on this host**
(`bun: command not found: tsgo`), so the package typecheck did **not** run. That is reported as
unverified, not as a pass.

## 8. The 4 failures, attributed

| Test | Error | Verdict |
|---|---|---|
| `e2e-happy` ×2 | `Cannot find module .../omo-senpi/plugin/runtime/dag/sdk.js` | environment — unbuilt SDK artifact |
| `knowledge-lifecycle-production` ×2 | `Expected "test" / Received "development"` at `:328`; `Expected 0 / Received 1` at `:292` | environment — `NODE_ENV` differs under `bun test` |

None can be caused by relocating a `const`/type: the moved values are identical and are the same
array/function objects through the re-export. No test was deleted, skipped or weakened.

## 9. Runtime evidence for ordinary runs

**None. Not implemented.** No ordinary run has yet been gated, blocked, or recorded a verdict.
Claiming otherwise would be the exact failure this gate exists to prevent.

## 10. UI evidence

**None.** No UI state was added or observed. `CodeGraphPanel`-style surfaces were not touched.

## 11. Security and stale-evidence analysis

Already present in the reused engine, and the reason not to rebuild it:

- `command` is an **argv array**, never a shell string — no injection surface.
- Freshness is by `sourceRevision` + `coveredPaths` + attempt, not timestamps, so a passing record
  from an earlier tree is `stale` and never accepts (§3 "no stale passing evidence").
- `skipped` is not `passed` (`isVerificationAccepting` accepts only `passed`).
- Output is secret-scrubbed before it reaches a record (V20 tests).
- `uncertainEffect` marks a check a timeout may have half-executed, so a retry reconciles first.

The remaining trust question is the §3 one: a run must not supply its own policy. Because the
policy stays in the engine and is selected from host-observed change scope, an agent cannot
downgrade its own requirements by describing its task as simple.

## 12. Performance

Not measured, because no gate runs yet. Nothing in this phase is on a hot path: the only change is
where four `const`s and a set of types are declared.

## 13. Known limitations

1. **No enforcement.** Ordinary completion still publishes `completed` from `final_response`.
2. **No trusted evidence for ordinary runs** — the blocking prerequisite; see §14.
3. Package `typecheck` unverifiable on this host (`tsgo` absent).
4. The 4 environmental failures above remain in the DAG suite.

## 14. Verdict: PARTIAL

Acceptance criteria, honestly scored:

| # | Criterion | Status |
|---|---|---|
| 1 | Ordinary code-changing completion blocked until verification passes | **NOT MET** |
| 2 | Gate uses trusted execution evidence, not agent claims | NOT MET (vocabulary only) |
| 3 | Missing/failed/stale evidence cannot complete successfully | NOT MET (engine can, boundary does not call it) |
| 4 | Research/docs/no-change get appropriate policies | Engine already implements it; not wired to ordinary runs |
| 5 | Existing ULW validation-batch enforcement intact | **MET** — untouched; 30/30 DAG verification tests pass |
| 6 | Retry/cancellation/duplicate/concurrency/recovery safe | NOT MET for the new gate (nothing wired) |
| 7 | UI/API represent real gate state | NOT MET |
| 8 | Tests prove behavior at the completion boundary | NOT MET (no boundary tests exist yet) |
| 9 | No regression in existing workflows | **MET** for what changed (see §7, §8) |
| 10 | Report supports every PASS claim | **MET** — no PASS is claimed |

**Why it stopped here, and what unblocks it.** Enforcement cannot be honest without a trusted
evidence source for ordinary runs, and that source does not exist: `manager-outcome.ts` receives a
`final_response` and aggregate `run_stats`, never per-command results. Wiring `evaluateAcceptance`
into `persistTerminal` today would classify every code-changing run as `INCOMPLETE` and block all
of them, because no ordinary run can produce a record yet — turning the engine's subagent surface
off rather than making it trustworthy.

The ordered path, all reusing what §2 lists:

1. **Evidence capture (blocking).** Give an ordinary child a host-side way to run a check through
   the existing `VerificationRunner` and persist a `DagVerificationRecord`-shaped record under the
   run id with `sourceRevision` = current tree revision. Reuses the runner, redaction, and store —
   no second execution engine.
2. **Adapter.** Map a run's changed paths onto `DagChangeScope` and its records onto
   `DagAcceptanceInput`, then call `selectVerificationChecks` + `evaluateAcceptance` unchanged.
3. **Enforce at `manager-outcome.ts:239`.** `PASS`/`NOT_REQUIRED` → `type: "complete"`;
   `FAIL` → terminal error carrying the reasons; `INCOMPLETE` → an explicit `verification_pending`
   state, never `completed`, with a bounded repair attempt.
4. **Boundary tests** (§8 of the mission): duplicate completion, concurrent completion,
   cancellation, restart, stale evidence, and no-false-success.
5. **Surface** the decision through the existing task/DAG records rather than a new panel.

## 15. Phase 2.1 — ordinary-agent trusted evidence capture

**What exists now.** `packages/omo-engine/senpi-task/src/verification/ordinary-capture.ts` gives the
host a single path from an ordinary child run to real, revision-bound verification evidence:

```
host resolves the run binding (runId, sessionId, epoch) from its OWN task record
  → observe changed files (host-observed, never the child's description)
  → selectVerificationChecks(scope, available)            existing policy, reused unchanged
  → runVerificationCommand(check, projectDir, attempt)    existing argv runner, timeout kill, scrubbing
  → deriveVerificationStatus(result)                      status comes FROM the execution
  → buildVerificationRecord({..., sourceRevision, workerAttempt: epoch})
  → store.writeVerification(runId, "run", checkId, attempt, serialized)
```

**Host trust boundary.** The model contributes no part of a record. `capture` accepts only a binding,
changed files and the candidate checks; there is **no parameter carrying a status, an exit code, or
output text**. A passing record exists only because `runVerificationCommand` returned exit 0, which
`deriveVerificationStatus` converts. Timeout, cancellation, a command that never started, and a
non-zero exit each degrade to their honest status. The child cannot address another run because the
binding is supplied by the host, not read from the child's request.

**Freshness.** Provenance, not timestamps, reusing `checkVerificationFreshness` and
`verificationAffectedByRepair`: a record names the source revision read immediately *before* execution,
and is rejected when the revision moved, when its covered paths intersect a later change, when the
record never genuinely started, or when the run epoch advanced. The record schema has no epoch field,
so the ordinary path binds the epoch through the existing `workerAttempt` field and rejects a
mismatch — no competing revision model was introduced.

**Persistence.** Records are written through the existing `VerificationRecordStore` port under the
established layout `verifications/<runId>/<nodeId>.<checkId>.<attempt>.json`, with the reserved `run`
segment DAG already uses for run-level checks. Two runs keep separate directories; a fresh reader
recovers the evidence.

**Tests — 12 pass, 0 fail (`bun test src/verification`).** Provenance: passing → `passed`/exit 0;
failing → `failed`/exit 3 and no passing record anywhere; timeout → `timed_out`; pre-cancelled → no
record at all. Freshness: fresh immediately after execution; stale after a revision change; rejected
on an epoch change; a covered path change is affected while an unrelated file is not. Persistence:
survives a fresh reader; two runs stay isolated by run id and session id. Policy: a docs-only change
requires no executable check and omits `unit-core` with a reason, while a code change requires it.

**DAG/ULW regression.** `bun test src/dag/verification.test.ts src/dag/scheduler-verification.test.ts`
→ **30 pass, 0 fail, 78 expect()**. ULW gate files were not touched.

**Not wired — read this as the honest boundary.** There is no child-facing entry point yet: nothing in
the ordinary child tool surface calls `capture`, so no real child run has produced evidence through
it. `persistTerminal` and `{type:"complete"}` are untouched, so **ordinary completion remains
ungated**. The runtime scenarios in Phase 2.1 §8 are therefore **NOT RUN** — the 12 tests exercise the
capture boundary directly, not a live child agent.

**Phase 2.1 verdict: PARTIAL.** Criteria met: host-only record creation, trusted runner reuse,
revision/epoch-bound freshness, durable isolated persistence, existing-policy reuse, and no DAG/ULW
regression. Criteria unmet: a child cannot yet *request* a check through a host-mediated surface, and
no real ordinary-child runtime scenario was observed.

**Next step (Phase 2.2 prerequisite).** Expose `capture` to the child through the narrowest existing
host-mediated channel that already carries a host-resolved run identity — the task/team send path is
the candidate, since it already refuses traffic across run boundaries — then run the nine runtime
scenarios against a real child before wiring `persistTerminal`.

## 16. Phase 2.1.1 — the child-facing request surface

**Entry point.** `verification/verify-tool.ts` defines the `verify` tool: an ordinary child calls
`verify` with no arguments and the host runs the required checks for that child's run.

**The control is the empty schema.** `VerifyParams = Type.Object({}, { additionalProperties: false })`.
A request has no field in which to express a `runId`, a `sessionId`, an `epoch`, a status, an exit
code, a command or a target record, so "the child cannot forge evidence" is enforced by the shape of
the interface rather than by a runtime check that could be bypassed. `additionalProperties: false`
rejects anything extra instead of ignoring it.

**Host-owned binding.** `createVerificationWorkerTool` takes `binding()` and `changedFiles()` as
callbacks the host supplies at construction. The tool resolves them at call time from host-owned task
state and passes them to the unchanged `ordinary-capture` path, so the trust properties from §15
hold unchanged: host-selected checks, the existing `runVerificationCommand`, status derived from the
real execution, durable revision-bound record. The child receives only the truthful outcome —
selected checks, omitted checks with reasons, each executed check's real status/exit/revision, and
`isError` when any check did not pass. If no live run owns the call, it refuses with
`verification_unavailable` and writes nothing.

**Tests — 18 pass, 0 fail (`bun test src/verification`), 61 expect().** The 6 new tool-boundary
tests prove: the schema is empty and closed; a call with no live run is refused and leaves no record;
a live binding produces a record owned by that run/session/epoch with the verified revision; two
children keep separate evidence (one passing, one failed); a failing check returns an error carrying
the real status and exit code; a documentation-only change selects nothing and writes nothing.

**What is still NOT connected — read this as the boundary.** The tool is **not yet registered in
`workerTools`** (`manager/manager.ts:262`), so no child process receives it and **no live ordinary
child has called it**. That registration is one array element, but it needs two pieces of host data
that the task record does not currently expose: a project/workspace directory for the run (neither
`TaskRecord` nor `state/types.ts` carries one) and a host-observed changed-file source (the isolation
merge delta exists only for isolated children). Wiring it with a guessed directory would run checks
in the wrong tree, which is worse than not running them.

**Phase 2.1.1 verdict: PARTIAL.** Met: child-facing request surface exists and is tested at its
boundary; identity is host-derived and cannot be supplied; the existing runner and policy are reused;
evidence stays host-authored, revision-bound and isolated. Not met: the tool is not registered with
the ordinary child runner, so the eleven live scenarios in §8 of the mission are **NOT RUN**.

**Next step.** Expose the run's workspace directory and a host-observed changed-file source on the
task record (isolation delta for isolated children, a host-side snapshot diff otherwise), then append
`createVerificationWorkerTool(...)` to the `workerTools` list next to `createWorkpoolWorkerTool`
and run the live scenarios.

## 17. Phase 2.1.2 — authoritative context, and why registration still stops short

**Workspace provenance solved.** `verification/worker-context.ts` resolves the run's directory from
`spawn_spec.cwd` on the persisted task record (`state/record-types.ts:43`), which is the directory
the worker was actually launched in — for an isolated child that is its clone. It is host-written at
spawn, so no guess and no new registry: the earlier "no authoritative directory" finding was wrong.
`resolveWorkerVerificationContext` returns `null` for a terminal run, a missing/empty `cwd`, or an
unusable epoch, so every unproven case fails closed. 7 tests.

**Unknown provenance now fails closed.** `verify-tool`'s `changedFiles()` may return `null`; the tool
then answers `verification_provenance_unknown` and writes no record, rather than treating an
unattributable change set as empty. Proven by test.

**Shared-workspace attribution still does not exist.** No file-write tracker, no per-run baseline
diff, no session change log — only isolated children have a worktree plus merge delta. So the honest
supported scope today is: directory resolvable for every run, changed files attributable for none.
Treating the repository's `git status` as a child's change set would misattribute the user's and
siblings' edits, which is exactly what the mission forbids.

**Registration blocked by two missing dependencies, not by the interface.** `workerTools(taskId)` is
invoked **per task**, so a capture instance can be constructed inside it from the resolved context —
no factory change is needed (an earlier draft of this section claimed otherwise; that was wrong and is
corrected here). What is genuinely missing is (a) an `OrdinaryEvidenceStore` instance reachable from
the manager over `<stateDir>/verifications`, and (b) a revision source for the worker's tree, since
`capture` needs `currentRevision()` and no host-owned per-run revision exists for ordinary children yet.
Feeding either value from a stand-in would make every record stale or bind it to the wrong tree, so the
tool stays unregistered rather than half-wired into `manager.ts:262`.

**Phase 2.1.2 verdict: PARTIAL.** Met: authoritative workspace resolution (host-owned, fail-closed),
unknown-provenance refusal, trust boundary intact, 23/23 boundary tests, DAG 30/30. Not met: the tool
is not in the worker registry, and shared-workspace changed-file attribution is absent.

**Next step.** Add an `OrdinaryEvidenceStore` over `<stateDir>/verifications`, add a host-owned
per-run revision (the tree identity the check actually saw), then construct the capture inside
`workerTools(taskId)` from the resolved context and append `createVerificationWorkerTool(...)` to the
array at `manager/manager.ts:262`. Isolated children gain working verification at that point; shared
children keep failing closed until an attribution source exists.

## 18. Phase 2.1.3 — canonical store, host-owned revision, and the catalogue gap

**Canonical evidence store.** `verification/evidence-store.ts` implements the existing
`OrdinaryEvidenceStore` port over `<root>/<runId>/<nodeId>.<checkId>.<attempt>.json` — the same
layout and `serializeVerificationRecord` format the DAG gate writes, so the product keeps one
evidence format. Writes are temp+rename (a torn write cannot look like a record), a failed write
throws instead of reporting success, and a caller-supplied identifier containing a path separator is
rejected rather than normalized, so evidence cannot be written outside its run directory. Reads
return `null` on a miss and rethrow anything else.

**Host-owned revision.** `workspaceRevision(workspaceDir)` = the workspace's own `HEAD` plus a
sha256 fragment of `git status --porcelain` (tracked and untracked). It is resolved by the host from
the run's `spawn_spec.cwd`, so two workspaces at the same commit cannot collide, an edit between
verification and evaluation changes the revision (invalidating the evidence), and a directory that is
not a git tree throws rather than inventing a revision. **It does not cover ignored files**, and it
says nothing about which actor caused a change.

**Tests — 32 pass, 0 fail (`bun test src/verification`), 94 expect().** New: write-then-fresh-reader
durability; per-run isolation of listings and reads; missing record returns `null`; a separator in a
run/check id is rejected; an unwritable destination throws; revision stable on an unchanged tree,
changed by a file mutation, different across two workspaces at the same commit, and throwing outside a
git tree.

**The blocker that stopped registration — and it is not the one I expected.** `workerTools(taskId)`
is per task, so the capture *can* be built inside it (the factory claim in §17 was wrong and is
corrected there). What does not exist is a **catalogue of checks for ordinary runs**: the DAG supplies
`DagVerifyCheck`s from a compiled node definition, and nothing produces them for an ordinary child.
With an empty catalogue, `selectVerificationChecks(scope, [])` requires nothing, so the tool would
answer "0 required, 0 records" with `isError: false` — a green verification that ran nothing. That is
strictly worse than an absent tool, so registration waits for a catalogue rather than shipping it.

**Phase 2.1.3 verdict: PARTIAL.** Met: criteria 1-4 and 6-7 of the phase goal (store ownership and
isolation, revision semantics, fail-closed provenance, tests and gate). Not met: criterion 5 — the
tool is still not in `workerTools`, because registering it without a check source would fabricate a
passing verification.

**Next step.** Define where ordinary check catalogues come from (a per-project check file, or the
package `scripts` of the workspace), make the tool answer `verification_no_checks_configured` when
the catalogue is empty, then register inside `workerTools(taskId)`.

## 19. Phase 2.1.4 — the catalogue contract and the empty-catalogue guard

**The one distinction that matters.** `verification/catalogue.ts` separates "no catalogue configured"
(`status: "none"` → `verification_no_checks_configured`) from "a valid catalogue with nothing
applicable to these changes" (a legitimate `NOT_REQUIRED`, e.g. a documentation-only edit). Collapsing
them is how a verification system starts reporting green having run nothing. `invalid` and
`unsupported` are separate statuses that map to `verification_catalogue_invalid` and
`verification_unsupported_project`, and an invalid explicit configuration never falls back to
inferred checks.

**Guard shipped and proven.** `verify-tool` resolves the catalogue before capture: an empty
`available()` returns `verification_no_checks_configured` with `isError: true`, zero records and
**no directory created on disk**. It never reaches `ordinary-capture`, where an empty selection would
have looked like a legitimate "nothing to run". Ordering note: provenance is resolved first, so a run
with both unattributable changes and no catalogue reports `verification_provenance_unknown` — both
fail closed and write nothing.

**Tests — 39 pass, 0 fail (`bun test src/verification`), 117 expect().** New: empty catalogue is a
configuration error with no record and no directory; empty catalogue plus unattributable changes still
writes nothing; configured catalogue plus unattributable changes reports the provenance code (the two
codes stay distinguishable); configured catalogue plus a docs-only change is a non-error with nothing
run; configured catalogue plus a code change executes the real check and leaves a durable record.

**Still not registered, and the reason is unchanged.** Discovery that auto-trusts `package.json`
scripts is exactly what this phase forbids ("do not treat package scripts as trusted merely because
they appear in a manifest"), and no allowlisted catalogue source exists yet. The tool stays out of
`workerTools(taskId)` until a catalogue can be supplied that is both discovered and approved.

**Phase 2.1.4 verdict: PARTIAL.** The FAIL-deciding criterion is satisfied — an empty catalogue can no
longer pass — but registration and the discovery layers (explicit config, manifest discovery with an
approval boundary) are not built.

## 20. Phase 2.1.5 — approval bound to an exact command, and candidates that are never permissions

**Approval fingerprint.** `verification/approval.ts` derives a sha256 over the ordered, delimiter-
escaped fields that decide what a command actually is: config version, workspace identity, check id,
package scope, working directory, timeout, and the argv array length-prefixed element by element. The
consequence is the whole point: change the executable, an argument, the cwd, the timeout or the
workspace and the fingerprint changes, so the old approval simply stops matching. There is no
invalidation step that can be forgotten, and approval cannot transfer to another workspace even when
the configuration file is identical. Length-prefixing matters: `["a","b"]` and `["a b"]` fingerprint
differently, which a naive join would have collapsed.

**Candidates are proposals, never permissions.** `classifyCandidates(candidates, approvals)` returns
`none` (nothing discovered), `approval_required` (discovered, none approved) or `approved` (matching
approval present). With no approval record, discovery alone can never produce `approved` — the
difference between "we found something to run" and "we may run it". A candidate carries the
fingerprint an approval *would* bind to, which is what makes "approve this exact thing" possible
without making it automatic.

**Distinct result codes.** `approvalRequiredCatalogue(pending)` yields
`verification_approval_required`, added alongside `verification_no_checks_configured`,
`verification_catalogue_invalid`, `verification_unsupported_project` and
`verification_provenance_unknown`. Five states, five codes, none of them a pass.

**Tests — 52 pass, 0 fail (`bun test src/verification`), 133 expect().** New: stable fingerprint for
an identical command; changed argument, changed executable, changed cwd and changed timeout each
break the earlier approval; the same command in another workspace is not approved; the argv collision
case (`["a","b"]` vs `["a b"]`) differs; an approved exact command is approved; a discovered candidate
with no approval is `approval_required` and does not execute; a foreign-workspace approval leaves the
candidate unapproved; no candidates yields `none` rather than `approval_required`; the
approval-required code is distinct from the no-checks code.

**Still not registered.** The approval model is proven, but the explicit configuration schema, the
manifest discovery that produces candidates, and the host approval UI/persistence are not built, so
nothing yet produces a real candidate for a real workspace. Registration stays blocked on that chain.

**Phase 2.1.5 verdict: PARTIAL.** None of the three FAIL conditions is reachable now: package scripts
cannot execute without a matching approval, approval cannot cross workspaces, and empty/invalid
catalogues still cannot produce evidence.

## 21. Phase 2.1.6 — configuration, discovery, persistent approval, and resolution

**Where the configuration lives.** `.alcode/verification.json`, at the project root, version 1. Not
`opencode.json`: that file belongs to OpenCode, and an Alcode capability reading it would let a
configuration Alcode does not own decide what Alcode trusts. The schema declares, per check: `id`,
`name`, `category`, `command` (argv array), `cwd`, `packageScope`, `timeoutMs`, `required`,
`appliesTo`.

**Validation is strict and terminal.** Rejected: absolute cwds, drive-qualified cwds, any `..`
segment, empty argv, a shell string smuggled in as one argv element, malformed and duplicate ids,
unknown categories, unknown fields at root and check level, an unsupported version, and timeouts
outside 1 s–30 min. Paths are resolved against the caller-supplied project root, never
`process.cwd()`, so validation and execution cannot describe different trees. An invalid
configuration returns `verification_catalogue_invalid` and **never** falls through to manifest
discovery — proven by a test that puts runnable package scripts beside a deliberately invalid
config and still gets `invalid`.

**Discovery proposes, never authorizes.** `discovery.ts` reads the root manifest and one level of
`workspaces/*` directories, and emits a candidate per `test`/`typecheck`/`lint`/`build` script that
is relevant to the host-observed changed files. Nothing is spawned: the fixture's scripts write a
marker file, and the marker is absent after discovery runs. Unsupported layouts (no root manifest)
return `verification_unsupported_project`; a manifest with no relevant script returns `none`.

**Approval is persistent, workspace-bound, and self-verifying.** Records live at
`.alcode/approvals/<workspaceId>/<fingerprint>.json` and carry the approver, timestamp, status
(`approved`/`revoked`), config version, and the exact command. A record is accepted only when its own
fields still hash to its own fingerprint, so hand-editing a file to widen an approval fails. A
record copied into another workspace's directory fails on the stored `workspaceId`. A corrupt or
unreadable record makes the whole read fail closed, and that surfaces as a catalogue error rather
than as "no approvals exist".

**Resolution precedence.** Explicit configuration → (only if absent) manifest discovery → resolve a
matching approval per candidate → select only approved checks. A corrupt approval store yields
`verification_catalogue_invalid`; unapproved candidates yield `verification_approval_required`; no
approved check is ever handed onward as an executable check.

**Tests — 101 in `src/verification`, 0 fail.** New this phase: 20 configuration tests (every
rejection path plus absent/invalid/valid loading against a real tree), 7 discovery tests, 11
approval-store tests (persistence, revocation, argument and cwd invalidation, corrupt record,
hand-edited record, cross-workspace copy, missing approver), 10 resolution tests including the
no-fallback rule and the post-approval configuration mutation.

**Not done, and it is the reason the phase verdict is PARTIAL.** There is no user-facing approval
interaction: a person cannot yet see a candidate's exact argv, cwd and package and approve it. The
persistence API exists and is proven; the authorized *interaction* does not. Consequently the
verification tool is still **not registered** in `workerTools(taskId)` — registering it now would
expose a tool that can only ever answer `approval_required`, which this mission defines as FAIL.
No real ordinary child has invoked it: every live scenario is **NOT RUN**.

**Phase 2.1.6 verdict: PARTIAL.** None of the three FAIL conditions is reachable: no manifest script
can execute without a matching approval, approval cannot cross workspaces, and no empty or invalid
catalogue produces evidence.
