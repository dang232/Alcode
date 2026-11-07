# Alcode Capability Inventory

**Audit date:** 2026-11-05
**Repository:** `I:/migration/Alwork` — branch `main`, HEAD `f0c6b70cc8d76401c8c84c9c22376bcf62117957`, tag `v0.2.3`
**Companion document:** [`alcode-complete-product-audit.md`](./alcode-complete-product-audit.md)

This file is the master table. Every row answers: does this capability exist, is it reachable at runtime, what proves it, and what is missing. A function or a UI label existing is **not** evidence of `COMPLETE` — the row must be reachable on its real execution path.

## Status legend

| Status | Meaning |
|---|---|
| `COMPLETE` | Implemented and traced end to end on its intended runtime path. |
| `PARTIAL` | Implemented, but an important behaviour is missing or only conditionally reachable. |
| `EXPERIMENTAL` | Works only under an explicit opt-in, a feature flag, or in test conditions. |
| `DOCUMENTED-ONLY` | Described in docs/prompts/skills; no implementation found. |
| `MISSING` | No implementation found. |
| `UNVERIFIED` | Implementation appears to exist but the evidence is insufficient to place it. |

## Evidence tag legend

Every claim in both documents is tagged with how it was established:

- **[SRC]** — source inspection (file:line opened during this audit).
- **[EXEC]** — command executed during this audit, output captured.
- **[CI]** — CI evidence from GitHub Actions for this repository.
- **[RT]** — runtime observation (process, journal file, live API).
- **[HIST]** — historical claim from earlier work, not reproduced here.

---

## 1. Repository and platform

| Capability | Status | Runtime integration | Evidence | Limitations |
|---|---|---|---|---|
| Monorepo with shared UI across web/desktop/VS Code/mobile | `COMPLETE` | Bun workspace; `packages/ui` consumed by every surface | `package.json`, `packages/*/package.json` [SRC] | `packages/mobile` and `packages/docs` are outside the Bun workspace |
| Desktop shell (Electron) | `COMPLETE` | `packages/electron/package.json` `main: ./dist-bundle/entry.mjs`; backend runs in-process | [SRC] | Bundled entry; source is pre-bundle |
| Web surface + Alcode server | `COMPLETE` | `packages/web/server/index.js` | [SRC] | — |
| VS Code extension | `COMPLETE` | `packages/vscode/src/ChatViewProvider.ts:157` | [SRC] | 154 source files, 69 test files |
| Hosted mobile shell (Capacitor) | `PARTIAL` | `packages/mobile` @1.13.2 bundles the mobile web surface | [SRC] | **0 test files** |
| Guest SDK contract for third-party panels | `COMPLETE` | `packages/sdk/src/host.ts:305`, `packages/sdk/src/parse.ts:600` | [SRC] | Docs in `packages/sdk/API.md` |
| Built-in app-owned extensions | `COMPLETE` | `packages/extensions/registry.json`, `packages/web/server/lib/guests/builtins.js:30` | [SRC] | — |
| Release pipeline (6 desktop targets + VS Code) | `COMPLETE` | `.github/workflows/release.yml` on `push: tags v*` | [CI] v0.2.3 run `41948797560`: 15/15 jobs success, 24 assets published | `publish-npm` and `mobile-release` are gated off by unset repo vars |

**Scale [EXEC]:** first-party source files (excluding `node_modules`/`dist`): `ui` 4,817 · `omo-engine` 2,655 · `electron` 1,153 · `web` 1,115 · `vscode` 154 · `sdk` 110 · `extensions` 20. TODO/FIXME markers: 59.

---

## 2. AI agent system

| Capability | Status | Runtime integration | Evidence | Limitations |
|---|---|---|---|---|
| Built-in agents | `COMPLETE` | Registry consumed by the task tool | `packages/omo-engine/senpi-task/src/agents/builtin/index.ts:29` (`BUILTIN_AGENT_DEFAULTS`, `BUILTIN_AGENTS`) [SRC] | — |
| Custom agents (markdown / omo.json) | `COMPLETE` | `agents/loader.ts:18`, `agents/omo-config-agents.ts:18` [SRC] | — |
| Primary / subagent split | `COMPLETE` | `tools/task/tool.ts:17` [SRC] | — |
| Agent selection and routing | `COMPLETE` | `agents/resolve-agent.ts:67` [SRC] | — |
| Model selection and fallback | `COMPLETE` | `model-chain.ts:23` [SRC] | — |
| Tool allow/deny policy | `COMPLETE` | `agents/agent-tool-policy.ts:16` [SRC] | — |
| Ask/approve tool-call gating | `UNVERIFIED` | Not found in `senpi-task/src`; permission prompts likely owned by the OpenCode runtime | Lane report + grep [SRC] | Not traced to an enforcement point |
| Spawning and lifecycle | `COMPLETE` | `manager/manager.ts:272` [SRC] | — |
| Multi-agent teams | `COMPLETE` | `team/spawn-members.ts:53` [SRC] | — |
| Parallel execution (batch + DAG) | `COMPLETE` | `dag/scheduler.ts:243` [SRC] | — |
| Recursion / duplicate-task guards | `COMPLETE` | `manager/depth-policy.ts:14` [SRC] | — |
| Cancellation | `COMPLETE` | `tools/control/cancel.ts:68` [SRC] | — |
| Conversation / execution persistence | `COMPLETE` | `store/record-store.ts:44` [SRC] | — |
| Context management (budget/compaction) | `DOCUMENTED-ONLY` | Described in `senpi-task/AGENTS.md` (session-suspend) | No enforcement module found [SRC] | Compaction is delegated to OpenCode |

---

## 3. ULW and autonomous orchestration

| Capability | Status | Runtime integration | Evidence | Limitations |
|---|---|---|---|---|
| ULW activation | `PARTIAL` | `cli.ts::main`, `cli-commands.ts::ulwLoopCommand` | Agent-driven CLI; **no daemon** [SRC] | Requires a driving agent |
| Workflow selection | `PARTIAL` | `cli-subcommands.ts --task-kind`, `plan-goal-factory.ts` | Heuristic [SRC] | No user-facing workflow picker |
| Planning / decomposition | `PARTIAL` | `plan-goal-factory.ts::deriveGoalCandidates` + `references/define-goal.md` | [SRC] | Heuristic + agent contract |
| DAG generation and dependencies | `PARTIAL` | `validation-batch.ts::parseValidationBatches` | `domain-types.ts::UlwLoopItem` has **no edge field** [SRC] | ULW is a queue with batches, not a true DAG |
| Subagent dispatch | `PARTIAL` | `dispatch.ts::recordGoalDispatched` | Spawn is the driver's `task` call [SRC] | — |
| Worker lifecycle bookkeeping | `PARTIAL` | `dispatch.ts` (`workerSessionId`, `attempt`, `dispatchedRole`) | [SRC] | Supervision by the driver agent |
| Progress / completion / failure events | `COMPLETE` | `constants.ts` ledger kinds, `plan-commit.ts::commit`, `ledger.ts::readLedgerAt` | [SRC] | — |
| Result synthesis | `DOCUMENTED-ONLY` | `SKILL.md` "synthesize in the final goal" | Code only stores evidence strings [SRC] | Synthesis is the agent's job |
| Validation-batch quality gate (completion refused without it) | `COMPLETE` | `checkpoint.ts:229` throws `ULW_LOOP_VALIDATION_BATCH_GATE_REQUIRED`; `quality-gate.ts:67-84` validates per-surface required sections | [SRC] | Applies to ULW validation batches only |
| Retry / replan | `PARTIAL` | `plan-crud.ts::startNextUlwLoop`, `checkpoint-retry-budget.ts` | [SRC] | Steering internals partly untraced |
| Concurrency / fan-out limit | `COMPLETE` | `spawn-guard.ts::DEFAULT_FANOUT_LIMIT` = 24 | `cli-dispatch.test.ts` [SRC] | — |
| Run identity | `COMPLETE` | `paths.ts::UlwLoopScope` / `resolveUlwLoopSessionIdFromEnv` | Unscoped use refused [SRC] | — |
| Persistence across restarts | `COMPLETE` | `plan-commit.ts` revisions, `plan-log.ts::reconcilePlan` | [SRC] | — |
| Recovery from interrupted runs | `PARTIAL` | `stop-resume-hook.ts::runStopResumeHook` | Mid-turn death explicitly out of scope [SRC] | — |
| UI synchronization | `PARTIAL` | Engine snapshot consumed by DAG pane; **ULW plan/ledger not consumed by UI** | `--loop-status` CLI only [SRC] | ULW state is not visible in the app |
| Engine DAG journaling (real, not synthesized) | `COMPLETE` | `~/.omo/agent/projects/<id>/senpi-task/dag/events/<run>.jsonl` + `runs/<run>.json` | [RT] live run `dag_ddb22b4c…` files present | — |
| DAG pane reflects backend events | `COMPLETE` | `packages/extensions/dag-pane/service/main.js:12400` (`omo.dag.updated`), dispatch `:13209` | [SRC] | — |

---

## 4. Code Graph and project intelligence

| Capability | Status | Runtime integration | Evidence | Limitations |
|---|---|---|---|---|
| Source discovery / traversal | `COMPLETE` | `runtime.js:148` [SRC] | — |
| TypeScript compiler integration | `COMPLETE` | `packages/omo-engine/code-graph/src/extract.ts:385`; compiler staged per platform | [SRC] + packaged acceptance [CI] | — |
| AST extraction and node/call-edge generation | `COMPLETE` | `extract.ts:86`, `:411` [SRC] | — |
| Cross-file relationships | `COMPLETE` | `extract.ts:11` [SRC] | — |
| Cross-project relationships | `PARTIAL` | `extract.ts:2722` [SRC] | — |
| Search / context / trace / impact / tests | `COMPLETE` | `queries.ts:726` [SRC] | — |
| Confidence labelling | `COMPLETE` | `extract.ts:302` [SRC] | — |
| Incremental indexing | `COMPLETE` | `lifecycle.ts:423` [SRC] | — |
| Persistence (repo-local store) | `COMPLETE` | `snapshot-storage.js:199`; store at `<repo>/.algraph/<scope>` | [EXEC] fixture wrote `.algraph/[".gitignore","proj-…--proj"]` | — |
| Warm restore | `COMPLETE` | `runtime.js:2653` | [EXEC] fixture: cold 334 ms → warm 123 ms; real repo: build ~430 s → restore **4.7 s** | — |
| Automatic indexing without a manual trigger | `COMPLETE` | Indexing starts on read | [EXEC] `readIndex()` built 13 entries on first call, published a manifest | — |
| Interrupted-index recovery | `COMPLETE` | `snapshot-storage.js:6` (atomic rename; torn store = miss) | [EXEC] killing a build left the manifest **byte-identical** (sha256 unchanged) | — |
| Truncation / completeness safeguards | `COMPLETE` | `queries.ts:138`; `runtime.js` policy-exclusion layer | [EXEC] `truncated=false` with `truncationReason="gitignore"` | — |
| File watching (native) | `COMPLETE` | `runtime.js` `isWatcherEnabled()`; the production host passes `watcherEnabled: true` (`packages/web/server/index.js:679`) | [SRC] + [EXEC] 16/16 startup-contract tests; on by default with explicit `ALCODE_CODE_GRAPH_WATCHER=0` / `CODEGRAPH_NO_WATCHER=1` opt-outs | Where recursive `fs.watch` is unsupported the watcher does not start and the panel truthfully reports "Not watching for changes" |
| Automatic synchronization after edits | `COMPLETE` | watcher → per-scope debounce → invalidate → single-flight rebuild; focus/visibility revalidate remains as the fallback | [EXEC] real monorepo: one edit produced the next generation in 7.6 s (Phase 1.1) and 17.3 s (Phase 1); 10/10 filesystem scenarios equal a clean build | A burst coalesces into one generation, so an edit is not instant on a large scope |
| Generation identity across restarts | `COMPLETE` | `runtime.js` `adoptPublishedSeq` adopts the stored number on a revision miss | [EXEC] 6/6 `runtime.generation-monotonic.test.js`; cross-process 1 → 2 (was 1 → 1) | A torn or absent manifest adopts nothing and starts from 1 by design |
| Branch switching under a live watcher | `COMPLETE` | revision gate re-scopes on checkout | [EXEC] 6/6 `runtime.branch-switch.test.js` (changed, deleted, renamed, mid-build, rapid, return) | Verified through process transitions, not a human clicking in the app |
| Non-source change filtering | `COMPLETE` | revision gate is computed over the indexed entry set | [EXEC] `.md` and `.tmp` writes produced **0** rebuilds; a `.ts` write produced **+1** | No extra filter layer was added; the existing rule already covers ignored/generated files |
| Rename / deletion handling | `COMPLETE` | `extract.ts:2863` [SRC] | — |
| Branch switching | `COMPLETE` | `runtime.js:1946` [SRC] | — |
| Generation management | `COMPLETE` | `runtime.js:2450` [SRC] | — |
| Sharding | `EXPERIMENTAL` | `shard-build-child.js`; opt-in via `ALCODE_CODE_GRAPH_SHARDED_BUILD>=1` | `runtime.js:559-560` [SRC] | Cross-shard call relationships lost |
| Delta publishing | `PARTIAL` | `runtime.js:1992` [SRC] | — |
| UI visualization | `COMPLETE` | `CodeGraphPanel.tsx:723` [SRC] | No manual refresh affordance left (see audit §6) |
| Agent-facing code-graph tools | `COMPLETE` | `packages/omo-engine/omo-opencode/src/tools/code-graph/args.ts:10` [SRC] | — |

---

## 5. Project memory and engineering knowledge

| Capability | Status | Runtime integration | Evidence | Limitations |
|---|---|---|---|---|
| Agent memory store (`memory.save/read/list/delete`) | `COMPLETE` **but ships dark** | `packages/web/server/lib/agent-memory/actions.js:249-252`; tool `alcode_memory` at `packages/web/server/lib/agent-tool/runtime.js:586` | [SRC] | `agent-memory/feature-flag.js`: *"feature is complete but not released… With the flag unset there is no tool, no routes, no session index and no settings row"* |
| Project knowledge records (record/retrieve/supersede/validate/budget) | `COMPLETE` | `packages/omo-engine/memory-core/src/project-knowledge/` (12 test files incl. relevance, supersede, project-switch, hostile-input) | [SRC] | Exposed through the Alcode control API (`alcode-control/project-knowledge.js:69`, gated by `isEnabled` at `:207`); **no agent tool wraps it** |
| Knowledge injected into agent context | `COMPLETE` | `packages/web/server/lib/session-knowledge/runtime.js:179` `buildKnowledgeEntries` → OpenCode instruction entries | [SRC] Injects pinned notes/plans, the **memory index**, tool rules and the working branch for every sender (UI and server-built prompts) | Retrieval-on-demand is not wired; the agent sees an index, not records |
| Source-linked claims / verified-vs-generated distinction | `PARTIAL` | `memory-core/src/project-knowledge/validator.ts` | [SRC] | Not surfaced in the UI |
| Git-backed persistence | `PARTIAL` | Files under the data dir / repo-local stores | [SRC] | No git commit per knowledge change |
| Overlapping memory systems | — | `agent-memory` (server, tool-facing, dark) · `memory-core/project-knowledge` (control API) · `session-knowledge` (injection) · omo plugin memory under `~/.omo` | [SRC] | Four related surfaces; only `session-knowledge` reaches the agent automatically |

---

## 6. Editing and code modification

| Capability | Status | Runtime integration | Evidence | Limitations |
|---|---|---|---|---|
| File read/write/edit | `COMPLETE` (delegated) | Executed by the **OpenCode agent runtime**, not Alcode | `packages/ui/src/lib/opencode/tools.ts` classifies tool names; `packages/web/server/lib/opencode/lifecycle.js:429` spawns OpenCode [SRC] | Alcode owns no editor |
| Multi-file modification | `PARTIAL` (delegated) | `patch` tool handled by OpenCode | [SRC] | — |
| Patch application in Alcode | `MISSING` | — | No file-level patch applier in Alcode; `session-event-router.ts:36` `applyPatch` is a **session-state reducer** [SRC] | Entirely dependent on OpenCode semantics |
| Diff generation | `COMPLETE` | `client.ts:1641` (`getSessionTurnDiff`), `DiffView.tsx:744` | [SRC] | — |
| Change tracking | `PARTIAL` | Turn/file diffs rendered (`MobileChangesSurface.tsx:473`) | [SRC] | No Alcode-owned change journal besides the ulw-loop ledger |
| Conflict detection | `PARTIAL` | — | [SRC] | No first-party conflict resolver found |
| Terminal integration | `COMPLETE` | `TerminalViewport.tsx` | [SRC] | — |
| Undo / rollback / checkpointing | `PARTIAL` | OpenCode revert + git | [SRC] | Not an Alcode-owned checkpoint system |
| Git integration (branch/worktree) | `COMPLETE` | Worktree + git route modules | [SRC] | — |
| Protection of unrelated user changes | `UNVERIFIED` | Depends on OpenCode's edit semantics | No Alcode-side guard found [SRC] | Cannot be asserted from this repository alone |

---

## 7. Testing, verification and debugging

| Capability | Status | Runtime integration | Evidence | Limitations |
|---|---|---|---|---|
| Test execution | `COMPLETE` | `scripts/run-isolated-tests.mjs:31,47`; root `test` script | [SRC] + [EXEC] | Per-package isolation |
| Type checking | `COMPLETE` | `packages/ui/package.json:14`, `scripts/check-changed.mjs:114` | [EXEC] `bun run type-check` clean | — |
| Linting | `COMPLETE` | `oxlint.config.ts:1`, `oxlint.anti-slop.config.ts:1` | [EXEC] gate "All checks passed" | — |
| Build validation | `COMPLETE` | root `build` script; `vite.diag.config.ts:39` | [EXEC] release:prepare exit 0 | — |
| Failure analysis | `PARTIAL` | `diagnostics/capture.ts:113`, `diagnostics/server-journal.js:1` | [SRC] | — |
| Automatic repair | `PARTIAL` | `chunkLoadRecovery.ts:31` (self-reload only) | [SRC] | No code-fix loop in product code |
| Regression detection | `PARTIAL` | — | [SRC] | No flake/bisect tooling |
| Test generation | `MISSING` | — | Searched `scripts/**`, `packages/*/src/**` [SRC] | — |
| Runtime debugging / breakpoints | `PARTIAL` | Browser panel + diagnostics | [SRC] | No first-party debugger |
| Verification as an enforced completion gate | `PARTIAL` | **Enforced in ULW only:** `packages/omo-engine/omo-codex/plugin/components/ulw-loop/src/checkpoint.ts:229` (`ULW_LOOP_VALIDATION_BATCH_GATE_REQUIRED`) + `quality-gate.ts:67` | [SRC] | Outside ULW, completion is a prompt contract; no product-wide gate |
| Packaged acceptance across 6 targets | `COMPLETE` | `.github/workflows/code-graph-packaged.yml:106-111` | [CI] all 6 targets success on v0.2.3 | — |

---

## 8. UI/UX

| Capability | Status | Runtime integration | Evidence | Limitations |
|---|---|---|---|---|
| First-run / onboarding | `COMPLETE` | `packages/ui/src/components/onboarding/` (`ChooserScreen`, `LocalSetupScreen`, `RemoteConnectionForm`, `RecoveryScreen`) + tests | [SRC] | — |
| Chat and agent interaction | `COMPLETE` | `packages/ui/src/components/chat/` | [SRC] | — |
| Session auth gate | `COMPLETE` | `components/auth/SessionAuthGate.tsx` + behaviour tests | [SRC] | Carries the repo's pre-existing lint warnings |
| Code Graph panel | `COMPLETE` | `CodeGraphPanel.tsx` | [SRC] | No manual refresh; freshness arrives on focus/visibility |
| DAG / run visualization | `COMPLETE` | dag-pane extension, `omo.dag.updated` | [SRC] + [RT] | Shows engine runs; **ULW plan state not shown** |
| Diff and review | `COMPLETE` | `DiffView.tsx`, hunk tests | [SRC] | — |
| Settings | `COMPLETE` | settings surfaces + search | [SRC] | — |
| Model/provider management | `COMPLETE` | `settings/providers`, `useConfigStore.ts:36` | [SRC] | — |
| Token and cost visibility | `COMPLETE` | `session-stats.ts:39`, `usage/usageGroups.ts:34` | [SRC] | — |
| Accessibility | `UNVERIFIED` | — | Not assessed in this audit | Needs a dedicated pass |

---

## 9. Providers, models and extensibility

| Capability | Status | Runtime integration | Evidence | Limitations |
|---|---|---|---|---|
| Provider integrations | `COMPLETE` | `openai/…` via `client.ts:1939`, `integration-catalog.ts:49`, `server/lib/opencode/providers.js:239` | [SRC] | — |
| Model discovery | `COMPLETE` | `model-discovery.js:1`, `routes.js:445` | [SRC] | — |
| Model routing and fallback | `COMPLETE` | `server/lib/routing/runtime.js:357`, `feature-routes-runtime.js:291`, `ui/lib/routing/autoModel.ts:11` | [SRC] | — |
| API compatibility layer | `COMPLETE` | `client.ts:1390`, `compatibility.ts:16`, `model.ts:87` | [SRC] | — |
| Tool calling | `COMPLETE` | `client.ts:1390`, `tools.ts:26` | [SRC] + tests | — |
| MCP integration | `COMPLETE` | `client.ts:2052`, `useMcpStore.ts:34` | [SRC] | — |
| OpenCode plugins | `PARTIAL` | `plugins.ts:54`, `usePluginsStore.ts:229` | [SRC] | Server `/api/config/plugins` handler not fully opened |
| Local models | `PARTIAL` | `quota/providers/ollama-cloud.js:1`, provider logos | [SRC] | No dedicated local runtime |
| Authentication | `COMPLETE` | `opencode/auth.js:176`, `clientAuth.ts:57`, `alcore-provider/personal-key.js:1` | [SRC] | — |
| Credential storage | `COMPLETE` | `opencode/auth.js:20`, `routing/DOCUMENTATION.md:29` | [SRC] | — |
| Usage accounting / token cost | `COMPLETE` | `session-stats.ts:39`, `quota/routes.js:93` | [SRC] | — |

---

## 10. Architecture, performance and reliability

| Capability | Status | Runtime integration | Evidence | Limitations |
|---|---|---|---|---|
| Process topology | `COMPLETE` | Electron main → Alcode server in-process → OpenCode **child process** (`lifecycle.js:429`) + code-graph **forked worker** (`host.js:59`) | [SRC] + [RT] | — |
| IPC contracts | `PARTIAL` | `electron/preload.mjs:229`, `main.mjs:6121` | [SRC] | — |
| State management | `COMPLETE` | `ui/src/sync/global-sync-store.ts`, `sync/DOCUMENTATION.md:288` | [SRC] | — |
| Persistence | `PARTIAL` | Files + one SQLite FTS index (`message-search/sqlite.js` uses `node:sqlite`/`bun:sqlite` builtins, no dependency) | [SRC] | No application database for app state |
| Caching | `PARTIAL` | `turnProjectionCache.ts:11`, `runtime.js:88` | [SRC] | — |
| Resource limits | `PARTIAL` | `agent-tool/runtime.js:820`, `runtime.js:65,74` | [SRC] | — |
| Startup / shutdown | `COMPLETE` | `server-startup-runtime.js:5`, `main.mjs:3720`, `server-shutdown.mjs:5` | [SRC] | — |
| Crash recovery | `PARTIAL` | `renderer-recovery.mjs:18`, `main.mjs:117` | [SRC] | — |
| Large-project performance | `PARTIAL` | `runtime.js:76,2270`, `MessageList.tsx:44` | [SRC] | See audit §10 |
| Security boundaries | `PARTIAL` | `early-startup.mjs:474`, `guest-frame-navigation.mjs:1`, `preload.mjs:225` | [SRC] | — |
| Logging / observability | `PARTIAL` | `utils/src/logging/logger.ts:37`, `diagnostics/server-journal.js:4` | [SRC] | — |

---

## 11. Test and CI infrastructure

| Item | Status | Evidence | Notes |
|---|---|---|---|
| UI unit/component tests | `COMPLETE` | 1,004 test files [EXEC] | Includes 220 `.test.tsx` |
| Web server tests | `COMPLETE` | 479 test files [EXEC]; `packages/web/vitest.config.ts:34` | `testTimeout: 30_000` |
| Electron tests | `COMPLETE` | 53 test files [EXEC] | Two fail locally on Windows (`EPERM: symlink`) |
| VS Code tests | `COMPLETE` | 69 test files [EXEC] | — |
| SDK tests | `COMPLETE` | 23 test files [EXEC] | Includes shipped-bundle hash pinning |
| Extensions tests | `COMPLETE` | 8 test files [EXEC] | — |
| Mobile tests | `MISSING` | 0 files [EXEC] | — |
| Docs tests | `MISSING` | 0 files [EXEC]; only `docs:validate` | — |
| Packaged cross-platform acceptance | `COMPLETE` | `.github/workflows/code-graph-packaged.yml:34-44` | 6 targets; green on v0.2.3 |
| PR gate (tests/typecheck/lint/build) | `COMPLETE` | `.github/workflows/oc-review.yml` `on: pull_request` | **PR-only** |
| Post-merge gate on `main` | `MISSING` | [CI] `gh run list --branch main` shows only label/docs/nix workflows | Nothing validates a push to `main` |
| Graph-equivalence tests | `EXPERIMENTAL` | `runtime.sharded-equivalence.test.js:37` | Sharded build is opt-in |
| Benchmark harness | `EXPERIMENTAL` | `scripts/qa/code-graph-search/bench.mjs` | No benchmark in CI |
| Known-flaky class | — | `server/lib/code-graph/` [EXEC] 4 dir runs: 1 pass / 3 fail, different test each time, all pass alone | Load-sensitive timing tests |
| DAG evidence-first verification | `COMPLETE` | `dag/verification.ts` [EXEC] 30/30 tests (`isVerificationAccepting` accepts only `passed`) | Fail-closed by design; DAG-only, reused not duplicated |
| Ordinary-agent verification gate | `PARTIAL` | `verification/ordinary-capture.ts` + `verification/verify-tool.ts` [EXEC] 18/18 boundary tests: empty-schema `verify` request, host-derived binding, revision+epoch-bound records | Capture and the child-facing `verify` tool exist; the tool is not yet in `workerTools` and ordinary completion remains ungated (Phase 2.2) |
