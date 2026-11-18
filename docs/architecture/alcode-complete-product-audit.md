# Alcode — Complete Product, Architecture & Implementation Audit

**Audit date:** 2026-11-05
**Repository:** `I:/migration/Alwork` (fork `dang232/Alcode`, upstream `openchamber/openchamber`)
**Branch:** `main` · **HEAD:** `f0c6b70cc8d76401c8c84c9c22376bcf62117957` · **Tag:** `v0.2.3`
**Companion document:** [`alcode-capability-inventory.md`](./alcode-capability-inventory.md) — the master capability table

> **Scope rule followed:** this was an investigation. No product code, test, config or changelog file was created, modified or deleted; nothing was committed or pushed. The only files added are these two documents.

> **Status update (2026-11-05, after Phases 1 and 1.1).** This audit is a point-in-time record and is kept as written. Two of its findings have since been closed in code:
> - **"Automatic freshness does not work"** (§1 finding 1, §6 Probe C) — the production host now passes `watcherEnabled: true` (`packages/web/server/index.js:679`), an explicit `=0`/`CODEGRAPH_NO_WATCHER` still wins, and a watcher-driven edit produces the next generation without manual action (7.6 s on 7,203 entries).
> - **"Generation numbers can repeat across restarts"** (§6.3, §10 item 1) — `adoptPublishedSeq` now adopts the stored number on a revision miss, so a rebuild mints the next generation (proven 1 → 2 cross-process).
>
> The watcher-updated graph is now content-equivalent to a clean full build of the same tree (7,274 shards, 517,916 node records, 0 duplicate identities, `IDS_EQUAL=true`). See [`code-graph-production-freshness.md`](./code-graph-production-freshness.md) §12. Everything else below, including the Phase-2 performance caveats, still stands as written.

---

## Evidence convention

| Tag | Meaning |
|---|---|
| **[SRC]** | Source inspection — the file and line were opened during this audit. |
| **[EXEC]** | A command was executed during this audit and its output captured. |
| **[CI]** | CI evidence from GitHub Actions for this repository. |
| **[RT]** | Runtime observation — a process, a journal file on disk, a live API. |
| **[HIST]** | Historical claim from earlier work; **not** reproduced in this audit. |

A capability is only `COMPLETE` when it was traced on its real execution path. Documentation, prompts and skills are never treated as implementation.

---

# 1. Executive summary

**Maturity verdict: a real, shipping product with an unusually strong project-intelligence core, sitting on top of a vendored agent engine it does not own — and whose autonomy and verification layers are real but not yet closed loops.**

Alcode is not a prototype. At `v0.2.3` it is a cross-platform engineering IDE that shipped **24 release assets across six desktop targets** plus a VS Code extension, built from roughly **9,900 first-party source files**. The release pipeline is proven green [CI]. The code graph is production-grade: it indexes automatically, persists to a repository-local store, restores warm, survives an interrupted build without corruption, and reports what it left out [EXEC]. The agent runtime it drives is not Alcode-written — `packages/omo-engine` is a vendored engine at `v5.1.23` [SRC] — and the code-modification loop is executed by OpenCode as a managed child process [SRC].

What is genuinely advanced: the **code-graph store design** (repo-local, atomic publish, generation/revision gating, honest completeness accounting), the **session-knowledge injection** (server-authored instruction entries so headless and scheduled sessions get the same context as UI sessions), and the **release and packaged-acceptance engineering** (six-target matrix, real denial tests, byte-exact artifact pinning).

What is not yet closed: **autonomy**. ULW has real journaling, run identity and fan-out guards, but its `UlwLoopItem` has no edge field — it is a bounded work queue with batches, not a dependency graph [SRC] — result synthesis is documented-only [SRC], and the ULW plan/ledger is not surfaced in the UI at all [SRC]. **Verification** is complete as tooling and used by CI, but no product code refuses to mark work complete without a passing check [SRC]. And the **freshness loop** has a visible gap: the native watcher is off in production, so a panel left open does not notice edits, while the manual Refresh that used to be the escape hatch has been removed [SRC][EXEC].

Ten most important findings, in order of consequence:

1. **Automatic indexing works; automatic *freshness* does not.** Indexing starts on read and persists repo-locally [EXEC], but production constructs the code-graph host without `watcherEnabled` (`packages/web/server/index.js:679`), so `isWatcherEnabled()` returns false [SRC]. The panel revalidates only on mount, directory change, window `focus` and `visibilitychange` (`CodeGraphPanel.tsx:694-701`) [SRC].
2. **The manual Refresh is genuinely gone, but "Retry" remains.** Both remaining `onRefresh` handlers render `t('codeGraph.retry')` — error banner and post-build failure — with no `Refresh` label or i18n key anywhere (`CodeGraphPanel.tsx:2148,2180`) [SRC].
3. **Alcode does not own file editing.** Edits execute in OpenCode; Alcode classifies tool names (`ui/src/lib/opencode/tools.ts`) and reduces session state (`sync/session-event-router.ts:36`). There is no Alcode patch applier [SRC].
4. **The code graph's correctness story is genuinely strong.** Policy exclusions no longer truncate a build, so the index persists and restores; killing a build mid-flight leaves the manifest byte-identical (sha256 unchanged) [EXEC].
5. **Project knowledge reaches agents by injection, not retrieval.** `session-knowledge` writes pinned notes/plans, the memory index, tool rules and the branch into OpenCode instruction entries for every sender (`session-knowledge/runtime.js:179`) [SRC]. The `alcode_memory` tool is complete but **ships dark** behind a flag (`agent-memory/feature-flag.js`) [SRC].
6. **ULW is a queue with batches, not a DAG.** `UlwLoopItem` has no edge field; dependency structure lives in validation batches (`validation-batch.ts::parseValidationBatches`) [SRC]. Its ledger is real and persisted; synthesis is the driving agent's job.
7. **Two DAG concepts coexist**: the engine's run journal (real, on disk, event-sequenced) [RT] and the ULW loop plan (CLI-only, not in the UI) [SRC]. Only the first is visible in the app.
8. **Verification is enforced in exactly one place.** Tooling is complete (tests, typecheck, lint, build), and the ULW **validation-batch final checkpoint refuses to close without a validated quality gate** (`checkpoint.ts:229` → `ULW_LOOP_VALIDATION_BATCH_GATE_REQUIRED`; `quality-gate.ts:67` enforces per-surface required sections). Outside ULW, ordinary agent completion has no gate and remains a prompt contract [SRC].
9. **CI gates pull requests only.** `oc-review.yml` ("pr checks") triggers on `pull_request` alone; `main` receives no test validation on push [CI].
10. **The Phase-2 performance story is partly historical.** No repository artifact supports 4,867 s → 849 s, 7.94 GB → 2.48 GB, or "~144 ms single-file"; the only indexing artifact contradicts the last one (see §7).

---

# 2. Actual repository and commit state

| Field | Value | Evidence |
|---|---|---|
| Branch | `main` | [EXEC] `git branch --show-current` |
| HEAD | `f0c6b70cc8d76401c8c84c9c22376bcf62117957` (`release v0.2.3`) | [EXEC] `git rev-parse HEAD` |
| Tag at HEAD | `v0.2.3` | [EXEC] `git describe --tags` |
| Working tree at audit start | clean (0 entries) | [EXEC] `git status --porcelain \| wc -l` |
| Version | `0.2.3` across root + `ui`, `web`, `sdk`, `electron`, `vscode` | [EXEC] all six manifests |
| Recent commits | `f0c6b70cc` release v0.2.3 · `a85685912` merge PR #28 · `17603ad43` code-graph test race · `b69e1a082` omo-native bundle · `5508627fb` acceptance store path · `da2692b0c` sdk bundles · `5ed3017c5` refresh removal · `52a91ef3e` truncation fix | [EXEC] `git log --oneline` |
| Releases | `v0.2.3` run `41948797560` — 15/15 jobs success, 24 assets | [CI] |
| Uncommitted user changes | none present at start | [EXEC] |

**Version-line note.** `v2.x` tags exist in the clone but are **not** this product line (`git describe` on `main` was `v0.2.2-37-g…` before the release); they belong to the upstream lineage. Do not read them as the current Alcode version. [EXEC]

## 2.1 Packages

| Package | Version | Responsibility | Files [EXEC] |
|---|---|---|---|
| `packages/ui` | 0.2.3 | Shared React UI, state, sync, runtime contracts | 4,817 |
| `packages/omo-engine` | **5.1.23** | **Vendored upstream engine** (agent runtime, DAG, memory-core, code-graph) | 2,655 |
| `packages/electron` | 0.2.3 | Desktop shell; `main: ./dist-bundle/entry.mjs` | 1,153 |
| `packages/web` | 0.2.3 | Web surface, Alcode server, OpenCode lifecycle, CLI | 1,115 |
| `packages/vscode` | 0.2.3 | Extension host + webview | 154 |
| `packages/sdk` | 0.2.3 | Guest contract: manifest parse, iframe bridge | 110 |
| `packages/extensions` | — | App-owned extensions + build registry (not a Bun workspace) | 20 |
| `packages/mobile` | 1.13.2 | Capacitor shell bundling the mobile web surface | 0 tests |
| `packages/docs` | — | Product documentation (not a Bun workspace) | 0 tests |

## 2.2 Existing architecture documentation

`AGENTS.md` (root, always-on rules) · `docs/references/adr-stepA-*.md` (7 ADRs on acceptance-vs-execution, migration/rollback, omo compatibility, retry budget, session isolation, state ownership, worker lifecycle) · `docs/isolated-spaces/{DESIGN,STAGES,TESTING,LESSONS}.md` · `docs/ALCORE-IDE-MAP.md` · `docs/ALCODE-RENAME.md` · `DOCUMENTATION.md` in `packages/extensions`, `packages/extensions/dag-pane`, `packages/sdk`, `packages/vscode/src` · `packages/ui/src/sync/DOCUMENTATION.md` · `packages/web/server/lib/session-knowledge/DOCUMENTATION.md`. [SRC]

**No `docs/architecture/` directory existed before this audit.** [EXEC]

## 2.3 Technical debt markers

59 `TODO`/`FIXME` markers across `ui/src`, `web/server`, `omo-engine/*/src`, `electron/*.mjs` [EXEC]. Pre-existing lint warnings in `components/auth/SessionAuthGate.tsx` (exhaustive-deps) and a stale eslint-disable in `codeGraphApi.ts:61`; both non-blocking, exit 0 [EXEC].

---

# 3. Architecture map (as built)

```mermaid
flowchart TB
  subgraph Client
    R[Electron renderer / browser / VS Code webview / mobile web]
  end
  subgraph Shell
    EM[Electron main<br/>dist-bundle/entry.mjs]
  end
  subgraph Server["Alcode server (in-process with Electron main)"]
    API[HTTP + realtime routes]
    CG[code-graph host<br/>lib/code-graph/host.js]
    LC[OpenCode lifecycle<br/>lib/opencode/lifecycle.js:429]
    SK[session-knowledge<br/>instruction entries]
    AM[agent-memory (dark)<br/>alcode_memory tool]
    EXT[built-in extensions<br/>dag-pane service]
  end
  subgraph Children
    W[code-graph worker<br/>forked: shard-build-child / ipc-worker]
    OC[OpenCode runtime<br/>managed child process]
  end
  subgraph Stores
    ALG[repo .algraph store]
    DAGJ[~/.omo/agent/projects/id/senpi-task/dag<br/>events/*.jsonl + runs/*.json]
    MSG[message-search.sqlite<br/>node:sqlite / bun:sqlite builtin]
  end
  R -->|HTTP + WS| API
  EM --> API
  API --> CG
  API --> LC
  API --> SK
  API --> AM
  API --> EXT
  CG --> W
  LC --> OC
  W --> ALG
  EXT --> DAGJ
  SK -->|instruction entries| OC
  API --> MSG
```

**Verified topology facts**

- OpenCode is a **managed child process** of the Alcode server, spawned at `packages/web/server/lib/opencode/lifecycle.js:429`, with lifecycle bookkeeping in `managed-process-registry.js` / `managed-process-stop.js`. [SRC]
- The code-graph engine runs in a **forked worker**, `packages/web/server/lib/code-graph/host.js:59`, so a long index never blocks the server's status reads (the host caches progress on its side of the boundary — `stateByDirectory`). [SRC]
- Electron's entry is bundled (`dist-bundle/entry.mjs`), and per `AGENTS.md` the backend runs in-process, never as a sidecar. [SRC]
- Persistence is **file-based** with exactly one SQLite index (message search, using `node:sqlite`/`bun:sqlite` builtins — **no dependency added**). There is no application database for app state. [SRC]

---

# 4. Part 2 — The AI agent system

**Real execution path:** a tool call (`task`) resolves an agent (`agents/resolve-agent.ts:67`), applies its tool policy (`agents/agent-tool-policy.ts:16`), picks a model through the chain (`model-chain.ts:23`), and the manager spawns and tracks the run (`manager/manager.ts:272`) with depth guards (`manager/depth-policy.ts:14`). Teams fan out through `team/spawn-members.ts:53`; batch and DAG parallelism through `dag/scheduler.ts:243`. [SRC]

**Built-in agents exist as real definitions:** `BUILTIN_AGENT_DEFAULTS` and `BUILTIN_AGENTS` at `packages/omo-engine/senpi-task/src/agents/builtin/index.ts:29` [SRC]. Custom agents load from markdown and `omo.json` (`agents/loader.ts:18`, `agents/omo-config-agents.ts:18`) [SRC].

**Cancellation and persistence** are real: `tools/control/cancel.ts:68`, `store/record-store.ts:44` [SRC].

**Not established:**

- **Ask/approve tool-call gating** was not found in `senpi-task/src`. Interactive permission prompts appear to be owned by the OpenCode runtime rather than this engine. Marked `UNVERIFIED` — I did not trace the enforcement point. [SRC]
- **Context management / compaction** is described in `senpi-task/AGENTS.md` but no enforcement module was found in this tree; compaction is delegated to OpenCode. Marked `DOCUMENTED-ONLY` for the engine side. [SRC]

**Judgement.** The agent system is `COMPLETE` for definition, routing, policy, spawning, teams, DAG parallelism, guards and cancellation — but it is the **vendored engine's** system (`omo-engine` v5.1.23), not an Alcode-authored one. Treat it as a stable dependency, not as a place Alcode should diverge casually.

---

# 5. Part 3 — ULW and autonomous orchestration

**What is real and verified**

- **Journaling and run identity.** The live audit run itself was journaled to `~/.omo/agent/projects/Alwork-<id>/senpi-task/dag/events/<run>.jsonl` alongside `runs/<run>.json`, as it executed [RT]. Runs are durable and resumable by construction.
- **Fan-out is bounded** by `spawn-guard.ts::DEFAULT_FANOUT_LIMIT = 24`, with `cli-dispatch.test.ts` covering it [SRC].
- **Run identity is enforced**: `paths.ts::UlwLoopScope` / `resolveUlwLoopSessionIdFromEnv`, and unscoped use is refused [SRC].
- **Persistence across restarts**: `plan-commit.ts` revisions plus `plan-log.ts::reconcilePlan` [SRC].
- **Progress/completion/failure events** are `COMPLETE`: ledger kinds in `constants.ts`, commit in `plan-commit.ts`, read-back in `ledger.ts::readLedgerAt` [SRC].
- **A structured quality gate closes a validation batch.** `checkpoint.ts:229` throws `ULW_LOOP_VALIDATION_BATCH_GATE_REQUIRED` unless `--quality-gate-json` is supplied and `validateQualityGate` accepts it; the validator enforces per-surface required sections (`quality-gate.ts:67-84`, e.g. the `omo-senpi` surface has no `codeReview` lane). This is the one place in the product where completion is genuinely **refused** without a proof artifact. [SRC]

**What is not**

- **The ULW loop is a queue, not a dependency graph.** `domain-types.ts::UlwLoopItem` has **no edge field**; dependency structure lives in validation batches (`validation-batch.ts::parseValidationBatches`) [SRC]. Any statement that ULW "generates a DAG" describes the *engine's* runs, not the ULW plan.
- **Result synthesis is `DOCUMENTED-ONLY`.** `SKILL.md` says "synthesize in the final goal"; the code stores evidence strings [SRC]. Synthesis happens in the driving agent's reasoning, not in product code.
- **The ULW plan is invisible in the app.** The DAG pane consumes the engine snapshot (`omo.dag.updated`, `packages/extensions/dag-pane/service/main.js:12400`, dispatch `:13209`) [SRC], but the ULW plan/ledger is reachable only through the `--loop-status` CLI [SRC].
- **Recovery from interrupted runs is `PARTIAL`**: `stop-resume-hook.ts::runStopResumeHook` covers stops; mid-turn death is explicitly out of scope [SRC].

**Is the visible DAG real or simulated?** **Real.** The pane subscribes to backend events, and the events exist on disk with sequence numbers [SRC][RT]. There is no synthesised DAG state in the UI layer that I could find.

**Can Alcode autonomously take a request through plan → implement → test → review → fix → verify?** Only with a **human or agent driving it**, and with these manual steps still required:

1. Launching ULW and choosing a task kind (`ulw-loop` CLI) — no UI entry point.
2. Providing the goal/decomposition contract (`references/define-goal.md`) — heuristic candidates, agent-authored goals.
3. Dispatching workers (the driver's `task` calls).
4. Synthesis of final results — no product code does it.
5. Judging whether verification passed — ULW's quality gate covers validation batches; ordinary runs fall back to the driver's judgement.
6. Recovering a run that died mid-turn.

---

# 6. Part 4 — Code Graph and project intelligence

## 6.1 Runtime probes executed in this audit

**Probe A — indexing is automatic and persists [EXEC].** A 13-file git fixture built with `createCodeGraphRuntime({ storeDir })`:

```
COLD ms=334 entries=13 nodes=65 edges=54 freshness=fresh truncated=false
STORE_AT_REPO=[".gitignore","proj-b6b39419--proj"]
WARM ms=123 entries=13 nodes=65 freshness=fresh
SPEEDUP=2.7x
```

Three facts follow: indexing starts from a read (no manual trigger), the store is written **repository-local** at `<repo>/.algraph/<scope>` even when a `storeDir` is supplied, and a second instance restores instead of rebuilding.

**Probe B — an interrupted build cannot corrupt the store [EXEC].** A real rebuild of `I:/migration/Alwork` was started and killed mid-flight; the manifest's size **and sha256 were unchanged** (`357dfb70c8e5551d`), with no `.tmp-` or lock residue. Publication is a rename (`snapshot-storage.js:88-90`).

**Probe C — the native watcher is off in production [SRC].** `packages/web/server/index.js:679` constructs `createCodeGraphHost({ storeDir })` with **no** `watcherEnabled`; `host.js` only exports `ALCODE_CODE_GRAPH_WATCHER=1` when it is explicitly true; `isWatcherEnabled()` then falls through to the env flag and returns false (`runtime.js:1052`). The runtime's own comment says *"Disabled (the default)"* (`runtime.js:1039-1043`).

**Probe D — freshness arrives on revalidate, not continuously [SRC].** `CodeGraphPanel.tsx:694-701` calls `revalidateIndex` on window `focus` and document `visibilitychange`; the only `setTimeout` (line 735) polls **during an active build**. `GIT_STATUS_TTL_MS = 1500` (`runtime.js:42`) keeps the re-check cheap.

## 6.2 Does the user still need to press Refresh?

**There is no Refresh button to press** — the affordance was removed and the remaining two handlers render **"Retry"** (`codeGraph.retry`) for error and post-failure states (`CodeGraphPanel.tsx:2148,2180`) [SRC].

**But the graph is not continuously fresh either.** With the watcher off, an edit made while the panel is open and focused is picked up on the next focus/visibility cycle, a directory change, or a remount. The product-facing consequence is: *no manual refresh, but no live update either* — the resolved model is "refresh on return", not "refresh in place".

**Restore-for-reuse when the source tree changed while Alcode was closed.** `persistEntry` only writes complete generations (`runtime.js:2634-2637`), and restore is gated on `storage.read(key, { projectId, worktreeId, revision, fingerprint })` (`runtime.js:2668`). A tree that moved while the app was closed produces a revision/fingerprint mismatch, which is a **miss → rebuild**. With a retained snapshot the rebuild is incremental (`runtime.js:2281`); without one it is cold. There is no partial-warm shortcut for a moved tree. [SRC]

## 6.3 Phase-2 historical numbers — labelled

| Claim | Label | Basis |
|---|---|---|
| Cold indexing **4,867 s → 849 s** | `HISTORICAL-UNREPRODUCED` | No artifact in the repository names these numbers. This audit measured a full build of the same scope at **~430 s** and a restore at **4.7 s** — same order, different figures, measured on today's code. |
| Peak RSS **7.94 GB → 2.48 GB** | `UNVERIFIABLE` | No RSS artifact; not measured in this audit. |
| Graph nodes **6.67 M → 519 k** | `SUPPORTED` (by today's run) | Today's real build produced `nodeCount 517,445`, `edgeCount 541,103` on 7,197 entries — the collapse is real and close to the claimed figure. |
| Warm restore **~9 s** | `SUPERSEDED` | Today: **4.7 s** from a separate process; 123 ms on the small fixture. |
| Synthetic single-file rebuild **~144 ms** | `CONTRADICTED` | The only durable indexing artifact, `.omo/cg-bench6000.log` (2026-11-02, gitignored), records `edit1 ms=27853 reanalyzed=5000 reused=0` — an edit that re-analysed the entire 5,000-file window. If a 144 ms case ever existed it was a different, narrower scenario than "edit one file in the full scope". |
| Engine suite **59/59**, served suites **95/95** | `UNVERIFIED` | Present suite counts differ (e.g. `packages/web` alone reports 481 test files); no run in this audit reproduced those two figures. |
| Sharding **test-only** | `INACCURATE` | Sharding is implemented in production code and **explicitly opt-in** (`runtime.js:559-560`, `ALCODE_CODE_GRAPH_SHARDED_BUILD>=1`); the cross-shard call-relationship loss is the real limitation. Status is `EXPERIMENTAL`, not test-only. |

**The 144 ms question, answered precisely.** The claim describes a *synthetic single-file incremental rebuild*. The one artifact that exists measures a **full-scope** edit on a 6,001-file synthetic repo, where the analyser re-processed all 5,000 files in 27.9 s. Those are not the same experiment, and the repository contains no artifact for the 144 ms variant. Any claim of sub-second incremental response should be treated as **unproven** until re-measured on a real large scope.

## 6.4 Status summary

The code graph is the strongest subsystem in the product: discovery, compiler integration, extraction, queries, incremental analysis, persistence, atomic publish, generation management, honest completeness, and agent-facing tools are all `COMPLETE`. The two real gaps are **continuous freshness** (`EXPERIMENTAL` watcher, default-off) and **cross-project relationships** (`PARTIAL`).

---

# 7. Part 5 — Project memory and engineering knowledge

There are **four overlapping memory surfaces** [SRC]:

| Surface | What it is | Reaches the agent? |
|---|---|---|
| `packages/web/server/lib/agent-memory/` | Store behind the `alcode_memory` tool (`memory.list/read/save/delete`, `actions.js:249-252`); registered at `agent-tool/runtime.js:586`; project scope derived from the **session directory**, never the model | Only when enabled — the feature **ships dark** (`feature-flag.js`: *"complete but not released… With the flag unset there is no tool, no routes, no session index and no settings row"*) |
| `packages/omo-engine/memory-core/src/project-knowledge/` | Records with `record`/`retrieve`/`supersede`/`validator`/`budget`, 12 test files including relevance, supersede, project-switch and hostile-input | **No agent tool wraps it.** Exposed through the Alcode control API (`alcode-control/project-knowledge.js:69`, gated at `:207`) |
| `packages/web/server/lib/session-knowledge/` | Injects per-session context as OpenCode instruction entries: pinned notes/plans, **the memory index**, managed-tool rules, and the working branch (`runtime.js:179`) | **Yes** — for every sender (`POST /api/session-knowledge/sync`), including server-built scheduled/agent prompts |
| omo plugin memory under `~/.omo` | Agent-level memory used by the omo plugin | Outside Alcode's product surface |

**Does Alcode understand *why* code exists, or only structural relationships?** Both, but in different places and with a separation that is real: the **code graph** answers "what relates to what" structurally, while **project knowledge** is the only surface that can carry intent — decisions, invariants, rationale. The `project-knowledge` module even carries a `validator.ts` for claims. What is missing is the bridge: the agent receives an **index** of memories at session start, but no tool or automatic retrieval that pulls the *right* record when it is working on the relevant file. So intent knowledge exists, is tested, and is only weakly connected to the moment of work. [SRC]

**Overlap to resolve.** `agent-memory` and `project-knowledge` are two record stores with different reachability (tool vs control API) and different scoping (session directory vs project/directory). The honest statement: four surfaces, one of which reaches the agent automatically; consolidation is a product decision, not a bug fix.

---

# 8. Part 6 — Editing and code modification

**The load-bearing fact: Alcode does not own file editing.** OpenCode executes every edit as a managed child process (`lifecycle.js:429`). In Alcode:

- `packages/ui/src/lib/opencode/tools.ts` is a **classifier of OpenCode tool names** (`isFileChangeTool`, `patchInputFiles`), not an editor. [SRC]
- `applyPatch` at `packages/ui/src/sync/session-event-router.ts:36` is a **session-state reducer**, not a filesystem patch applier. [SRC]
- `DiffView.tsx:744` renders git/session diffs for review; `client.ts:1641` fetches a turn diff. [SRC]

**Consequence for safety.** Whether an agent can modify a large project without overwriting unrelated user changes is decided by **OpenCode's edit semantics**, not by anything in this repository. I found no Alcode-side conflict detector, no pre-write snapshot of user files, and no ownership guard. Marked `UNVERIFIED` for the combined system and `MISSING` for an Alcode-owned protection layer. Any claim that Alcode guarantees user-change preservation cannot be supported from this codebase. [SRC]

---

# 9. Part 7 — Testing, verification and debugging

**Verification is a real workflow with real tooling, and it is not an enforced gate.**

- Tooling `COMPLETE`: `scripts/run-isolated-tests.mjs` (per-package isolation), `bun run type-check`, oxlint (`oxlint.config.ts` + `oxlint.anti-slop.config.ts`), root `build`, and `scripts/check-changed.mjs` which composes type-check + lint + knip + an anti-slop ratchet [SRC][EXEC].
- CI uses it on pull requests (`oc-review.yml`, jobs `tests`, `type-check`, `lint`, `build`) [CI].
- **Enforcement: `PARTIAL` — real, but confined to ULW.** The ULW validation-batch final checkpoint **does** refuse completion without a supplied, validated quality gate (`checkpoint.ts:229`, `quality-gate.ts:67`). Everywhere else — ordinary agent runs, the run/complete path outside ULW — completion is a prompt/skill contract (the ultrawork directive, the `review-work` skill) plus CI. The packaged acceptance is the other enforced proof, and it is CI-only [CI].
- Automatic repair `PARTIAL` — `chunkLoadRecovery.ts:31` self-reloads a failed chunk load; there is no code-fix loop in product code [SRC].
- Test generation `MISSING`; flake detection/bisect `MISSING` [SRC].

**Can Alcode independently prove an implementation works before declaring a task complete?** It can *run* the proof (suites, typecheck, lint, build, packaged acceptance) — that machinery is solid. It cannot *enforce* that the proof ran, and it has no mechanism to reject a completion that skipped it. [SRC]

---

# 10. Part 8 — UI/UX and developer experience

**Present and real:** onboarding (`onboarding/ChooserScreen.tsx`, `LocalSetupScreen.tsx`, `RemoteConnectionForm.tsx`, `RecoveryScreen.tsx`, plus desktop recovery with tests) [SRC]; chat and tool cards; session auth gate with behaviour tests; code-graph panel; DAG/run/activity/code views in the dag-pane extension; diff and hunk review; settings with search; providers/models; usage and cost; terminal. [SRC]

**Where UI claims and backend state diverge — the audit's core UI findings:**

1. **Freshness.** The panel offers no Refresh and does not update in place; the resolved truth is "updates when you come back". A user watching files change will believe the graph is stale *and* have no button to fix it. [SRC][EXEC]
2. **ULW visibility.** Engine DAG runs are visible; the ULW plan/ledger that actually drives long autonomous work is not surfaced at all — CLI only. [SRC]
3. **Hermetic status vocabulary.** Two different orchestration concepts (engine runs vs ULW loop) share no unified status model in the UI, which is why "run" can mean two things to a user. [SRC]

**First five minutes.** A new user gets a chooser (local vs remote), a local setup path, and provider/auth configuration — a real onboarding flow rather than a blank chat. The load-bearing risk is not the first five minutes but the first *long* task: the moment the user asks for autonomous work, the controls and progress for it live in a CLI surface they were never shown. [SRC]

*Accessibility was not assessed in this audit (see §17).*

---

# 11. Part 9 — Providers, models, tools and extensibility

Routing is `COMPLETE` and has real structure: `server/lib/routing/runtime.js:357`, `feature-routes-runtime.js:291`, and a UI-side model chooser `ui/lib/routing/autoModel.ts:11`; discovery at `model-discovery.js:1` and `routes.js:445`; compatibility at `ui/lib/opencode/compatibility.ts:16`. [SRC]

Auth and credentials are `COMPLETE`: `opencode/auth.js:176`, `web/src/api/clientAuth.ts:57`, and the Alcore personal key path `alcore-provider/personal-key.js:1`. Usage/cost accounting is `COMPLETE` (`session-stats.ts:39`, `quota/routes.js:93`, `usage/usageGroups.ts:34`). MCP is `COMPLETE` (`client.ts:2052`, `useMcpStore.ts:34`). The guest extension contract is `COMPLETE` (`sdk/src/host.ts:305`, `parse.ts:600`, `extensions/registry.json`, `guests/builtins.js:30`). [SRC]

**Gaps:** OpenCode plugins are `PARTIAL` (server `/api/config/plugins` handler not fully opened); local models are `PARTIAL` — the surface lists Ollama Cloud but there is **no dedicated local runtime**. [SRC]

**Can it select the right model and workflow per task?** It can select a model by task kind (`autoModel.ts`, `feature-routes`), and it can select an *engine* workflow (batch/DAG/team). It cannot select a **ULW workflow** — workflow selection is a `--task-kind` heuristic with no picker. [SRC]

---

# 12. Part 10 — Architecture, performance and reliability

**Strengths, verified:** clear process separation (server in-process with Electron; OpenCode as a managed child; code-graph in a forked worker) [SRC]; the host caches progress across the worker boundary so status reads never block behind a build [SRC]; atomic store publication with a single-writer lease [SRC][EXEC]; managed-process registry with stop semantics [SRC]; startup/shutdown and renderer recovery modules [SRC].

**Bottlenecks and fragile interfaces, by evidence:**

- **Cold indexing is the dominant cost** — ~430 s for a 7,197-entry real scope [EXEC]. Warm restore (4.7 s) is what makes it tolerable, so any regression in restore correctness becomes a minutes-long user-visible stall.
- **No post-merge validation** — a broken `main` is only discovered by the next PR or release [CI].
- **File-based persistence at scale** — 7,268 shards plus a 294 KB manifest for one scope [EXEC]; no pruning control is exposed.
- **Two orchestration stacks** (engine DAG, ULW loop) with different persistence, different failure semantics and different visibility [SRC].
- **Vendored engine dependency** — `omo-engine` at 5.1.23 is a large surface that must be upgraded deliberately; divergence is expensive [SRC].

**Windows/Linux/macOS:** the release pipeline builds and publishes all six targets [CI], and the packaged acceptance runs on each [CI]. Local Windows runs show environment-specific test failures (symlink `EPERM` in Linux packaging tests) that do not indicate product defects [EXEC].

---

# 13. Part 11 — Tests, CI and existing evidence

**Suites [EXEC]:** ui 1,004 test files · web 479 · electron 53 · vscode 69 · sdk 23 · extensions 8 · mobile 0 · docs 0. (Counted twice with the same `find` predicate, excluding `node_modules`/`dist`.)

**CI reality [CI]:**

| Workflow | Trigger | What it gates |
|---|---|---|
| `oc-review.yml` ("pr checks") | **`pull_request` only** | `tests`, `type-check`, `lint`, `build` |
| `code-graph-packaged.yml` | `pull_request` + manual | Packaged acceptance on 6 targets |
| `release.yml` | `push: tags v*` | All platform builds, npm, mobile, finalize |
| `docs-source.yml`, `nix-hashes.yml`, `vscode-extension.yml` | `push` | Docs/nix/extension packaging |
| `stale.yml` | schedule | Housekeeping (currently failing) |

**The gap that matters:** nothing runs the test suite on a push to `main`. `gh run list --branch main` returns only label/docs/nix/housekeeping runs [CI].

**Known-flaky class [EXEC]:** the code-graph server suite is load-sensitive. Four directory-level runs produced **1 pass / 3 fail, a different test each time** (`runtime.contract.test.js`, `runtime.freshness.test.js` ×2, `runtime.partial-publish.test.js`), and each passes when run alone. Example: *"a burst of writes coalesces to exactly one background sync"* uses a 100 ms debounce, which a loaded host can span, producing a second generation (`expected 3 to be 2`). This is honest flakiness in the tests, not a product regression, and it can turn `tests` red for reasons unrelated to a change.

**Mock-only tests:** `packages/ui/src/stores/useConfigStore.test.ts:148,203` exercise mocked stores rather than a real server; treat them as contract-of-the-mock, not integration evidence. [SRC]

**Missing critical tests:** mobile (0), docs (0), and any enforced verification-gate test at the product level.

---

# 14. Part 12 — Capability inventory

The full master table lives in [`alcode-capability-inventory.md`](./alcode-capability-inventory.md), with `Subsystem · Capability · Status · Runtime integration · Evidence · Limitations` for every row across 11 sections.

Status distribution across that inventory (counted from the tables):

| Status | Rows | Where they cluster |
|---|---|---|
| `COMPLETE` | ~95 | code graph, providers/routing/auth, agent engine, release/CI |
| `PARTIAL` | ~45 | ULW, architecture/reliability, editing, plugins/local models |
| `EXPERIMENTAL` | 3 | native file watching, code-graph sharding, benchmarks |
| `DOCUMENTED-ONLY` | 2 | ULW result synthesis, engine context budgeting |
| `MISSING` | 5 | Alcode patch applier, ask/approve in senpi-task (unverified), test generation, mobile tests, post-merge CI |
| `UNVERIFIED` | 4 | editing safety guarantee, accessibility, plugin server handler, local model runtime |

---

# 15. Part 13 — The real product gaps

**1. What can Alcode genuinely do today?**
Ship as a cross-platform IDE (web, desktop ×6, VS Code, mobile web) that drives agent sessions against real repositories, indexes the project into a queryable code graph automatically, shows DAG-visualised agent runs with live events, reviews diffs, runs terminals, and manages providers, credentials, usage and extensions. [SRC][CI][EXEC]

**2. Strongest competitive advantages.**
(a) The code-graph store: repo-local, atomic, generation/revision-gated, honest about exclusions, fast warm restore — this is better engineering than most editors' indexers. (b) Six-target packaged acceptance with real denial tests and byte-exact artifact pinning. (c) Server-authored session knowledge so headless/scheduled sessions get the same context as UI ones.

**3. Already unusually advanced.**
Session-knowledge injection; agent-memory as a first-class tool (even dark); the anti-slop/lint/knip gate; the code-graph completeness contract; the release pipeline.

**4. Incomplete major features.**
ULW synthesis and UI surfacing; verification enforcement; project-knowledge retrieval at the moment of work; local model runtime; plugin management depth.

**5. Duplicated systems.**
Two memory stores (`agent-memory` vs `project-knowledge`) plus an injection layer; two orchestration stacks (engine DAG vs ULW loop); two DAG visualisation vocabularies.

**6. Where runtime differs from intended architecture.**
The intended story is "automatic, always-fresh project intelligence". The runtime reality is "index on read, refresh on focus". The intended story for autonomy is a pipeline; the runtime reality is a queue plus an agent doing synthesis by hand.

**7. What prevents autonomous task completion?**
Outside ULW there is no enforced verification gate, so an agent can declare done unproven; ULW synthesis is agent-only; recovery from mid-turn death is out of scope; workflow selection is a heuristic.

**8. What prevents understanding an entire project?**
Cross-project relationships are `PARTIAL`; the graph is structural only; intent knowledge is injected as an index, not retrieved against the file being edited.

**9. What prevents reliable self-verification?**
The gate exists in one path only (ULW validation batches); ordinary runs are unchecked, and CI runs on PRs but not on `main`. The machinery to prove work is present — the obligation to invoke it is not generalised.

**10. Five biggest architectural risks.**
(i) Cold-index cost with restore as the only mitigation; (ii) vendored-engine upgrade risk; (iii) no post-merge gate; (iv) file-based persistence growth without pruning; (v) two orchestration models drifting apart.

**11. What should we absolutely NOT rebuild.**
The code-graph runtime/store; the DAG/senpi-task engine and its journal; the OpenCode lifecycle and managed-process registry; the sync/state layer; the SDK guest contract; the release pipeline and packaged acceptance; the extension host.

**12. What to optimize before adding features?**
Freshness (watcher default or explicit in-place revalidate), restore reliability, and the verification gate — in that order.

---

# 16. Part 14 — Prioritized gap analysis

Ranked by user impact × engineering impact × differentiation × risk × cost × dependency.

## Critical blockers

| # | Finding | Extend (not rebuild) | Why now |
|---|---|---|---|
| C1 | **No continuous freshness; no manual refresh either.** The watcher is default-off and the Refresh button is gone. | `code-graph/runtime.js` `isWatcherEnabled` + `host.js` + `packages/web/server/index.js:679` | A user edits a file, the graph silently waits for a focus cycle, and there is no button. This is a visible correctness-of-experience gap created by two individually-reasonable changes. |
| C2 | **No enforced verification gate outside ULW.** | `omo-engine/.../ulw-loop/src/checkpoint.ts` + `quality-gate.ts` (the existing gate to generalise), then `scripts/check-changed.mjs` and the run/completion path | The hardest part already exists — ULW refuses to close a validation batch without a validated quality gate. Generalising that contract is far cheaper than inventing one. |
| C3 | **Nothing validates a push to `main`.** | `.github/workflows/oc-review.yml` (add a `push: branches: [main]` path reusing the same jobs) | Cheapest possible risk removal; the jobs already exist. |

## High-priority gaps

| # | Finding | Extend |
|---|---|---|
| H1 | ULW plan/ledger invisible in the UI; synthesis manual | `packages/extensions/dag-pane` + `omo-engine/ulw-loop` ledger reader |
| H2 | Project knowledge not retrieved at the moment of work | `session-knowledge` injection + `project-knowledge/retrieve.ts` |
| H3 | Two memory stores with different reachability | `agent-memory` + `memory-core/project-knowledge` unification decision |
| H4 | Editing safety depends entirely on OpenCode | decide whether Alcode needs an ownership/conflict layer |
| H5 | Code-graph suite load-flakiness | the tests themselves (injected clock / configurable debounce) |

## Important improvements

I1 Cross-project graph relationships. I2 Store pruning control. I3 Mobile and docs tests. I4 Local model runtime. I5 Plugin management depth. I6 Accessibility pass. I7 Flake detection tooling. I8 Surface the graph's excluded files and restore provenance in the panel.

## Long-term research

R1 Retrieval-augmented code understanding (graph + intent knowledge fused at edit time). R2 True dependency DAG for ULW (with edges). R3 Autonomous repair loop. R4 Cross-repository intelligence.

## Already complete — do not rebuild

The code-graph runtime and store, the engine DAG/journal, the OpenCode lifecycle and managed-process registry, the sync/state layer, the SDK guest contract, the extension host, the release pipeline and packaged acceptance, provider routing/auth/usage, and session-knowledge injection.

## Dependencies between recommendations

```
C1 (freshness) ─┐
C3 (main gate) ─┼─> H5 (flake-free suite) ─> C2 (verification gate can be trusted)
C2 (gate) ──────┴─> R3 (autonomous repair needs a trustworthy gate)
H3 (memory decision) ─> H2 (retrieval) ─> R1 (fused understanding)
H1 (ULW surface) ─> R2 (real DAG) ─> autonomy
```

Order of work: **C1 → C3 → H5 → C2 → H3 → H2 → H1 → H4**.

---

# 17. What this audit could not verify

- **Peak RSS (7.94 GB → 2.48 GB).** Not measured; no artifact found. `UNVERIFIABLE`.
- **The 144 ms single-file incremental figure.** Contradicted by the only artifact; the exact experiment it described no longer exists in the repository. `CONTRADICTED`.
- **Ask/approve tool-call gating.** Not located in `senpi-task`; the enforcement point may live in the OpenCode runtime, which is outside this repository.
- **User-change safety during agent edits.** Depends on OpenCode edit semantics; no Alcode-side guarantee found.
- **Accessibility.** Not assessed.
- **Mobile runtime behaviour.** `packages/mobile` has no tests; only the Capacitor shell was inspected.
- **Engine suite `/95` counts** from the historical report — not reproduced.
- **Plugin server handler** (`/api/config/plugins`) — not opened.
- **Full citation sweep.** Roughly 150 file:line citations underpin the inventory. About ten load-bearing ones were re-opened by the auditor and corrected where wrong (the editing delegation, `isFileChangeTool`'s real path, the memory wiring, the process topology, sharding, the watcher default, the refresh handlers, suite counts, CI triggers, session-knowledge injection). The remainder carry the audit lanes' inspection. In that sample **two citations were materially wrong** (an ambiguous `tools.ts:95` and an overstated `File watching: COMPLETE`), so treat any single citation here as strong evidence of the *capability*, and re-open the exact line before relying on it in a design decision.

# Appendix — commands executed for evidence

```bash
git branch --show-current; git rev-parse HEAD; git describe --tags; git status --porcelain
git log --oneline -8; git tag --list 'v0.2*'
grep -rn "onRefresh|codeGraph.refresh|toolbar.refresh" packages/ui/src/components/code-graph
sed -n '1030,1075p' packages/web/server/lib/code-graph/runtime.js          # isWatcherEnabled
sed -n '30,75p'   packages/web/server/lib/code-graph/host.js               # watcher env export
grep -n "createCodeGraphHost(" packages/web/server/index.js                # :679 no watcherEnabled
grep -n "revalidateIndex|visibilitychange|focus" packages/ui/src/components/code-graph/CodeGraphPanel.tsx
bun C:/.../ulw-audit/probe-2a.mjs                                          # cold/warm + repo-local store
find packages -name '*.test.*' | wc -l                                     # per-package counts
gh run list -R dang232/Alcode --branch main --limit 8
gh run list -R dang232/Alcode --workflow release.yml --limit 2
sed -n '1,20p' .github/workflows/oc-review.yml                             # pull_request only
cat .omo/cg-bench6000.log                                                  # the only indexing artifact
grep -rn "alcode_memory" packages/web/server/lib/agent-tool/runtime.js     # :586
head -n 14 packages/web/server/lib/agent-memory/feature-flag.js            # ships dark
head -n 14 packages/web/server/lib/session-knowledge/runtime.js            # instruction entries
grep -n "shards" packages/web/server/lib/code-graph/runtime.js             # :559 opt-in only
```

**Non-destruction receipt.** `git status --porcelain` before: 0 entries. After: only `docs/architecture/` with the two new files. No source, test, config or changelog file touched; nothing committed or pushed. [EXEC]
