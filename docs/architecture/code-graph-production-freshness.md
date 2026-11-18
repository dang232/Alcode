# Code Graph — Production Freshness

**Phase:** 1 of the Code Graph reliability programme
**Repository:** `I:/migration/Alwork` · branch `main` · base commit `f0c6b70cc` (`v0.2.3`)
**Companion evidence:** [`evidence/code-graph-production-freshness.json`](./evidence/code-graph-production-freshness.json)

---

## 1. Root cause

The watcher was never broken. It was never **switched on in production**.

`packages/web/server/index.js:679` constructed the code-graph host with only a store directory:

```js
const codeGraphRuntime = createCodeGraphHost({ storeDir: path.join(ALCODE_DATA_DIR, 'code-graph-store') });
```

`host.js` only exports `ALCODE_CODE_GRAPH_WATCHER=1` to the worker when `watcherEnabled === true` is passed, and `runtime.js` `isWatcherEnabled()` then falls through to an environment flag that production never set. The runtime's own comment described the result: *"Disabled (the default) keeps today's revision-gate + manual-refresh path exactly as it was."*

So freshness depended on the revision gate: the graph re-checked when the panel was **mounted, switched directory, or the window regained focus** (`CodeGraphPanel.tsx:694-701`), and the manual Refresh that used to force a rebuild had been removed. A file saved while the panel was open and focused was simply not seen.

**The precise point where automatic freshness stopped working** is that constructor call. Everything downstream of it — event debounce, invalidation, single-flight rebuild, persistence, publication — already existed and worked when a test enabled it.

## 2. Architecture reused (nothing rebuilt)

| Piece | Where | Reused as-is |
|---|---|---|
| Per-scope watcher creation, idempotent by scope key, bounded retention, error-safe | `runtime.js` `ensureWatcher` | yes |
| Debounce per scope key, unref'd timer | `runtime.js` `scheduleWatcherSync` | yes |
| Invalidate → single-flight `ensureIndex` (joins a running build) | `runtime.js` `triggerWatcherSync` | yes |
| Disposal of watchers and timers | `runtime.js` `closeWatchers` | yes (now also reachable through `close()`) |
| Atomic generation publish, revision/fingerprint restore gate | `snapshot-storage.js`, `runtime.js` `persistEntry` / restore | yes |
| Pending-changes and sync-status reporting | `runtime.js` `pendingSync` / `staleFiles` / `syncStatus` | yes |
| Panel state, focus/visibility revalidation as fallback | `CodeGraphPanel.tsx` | yes |

No second watcher, no new indexing service, no polling substitute.

## 3. Files changed and why

| File | Change | Reason |
|---|---|---|
| `packages/web/server/index.js` | production host passes `watcherEnabled: true` | the actual fix: normal startup now watches |
| `packages/web/server/lib/code-graph/runtime.js` | `isWatcherEnabled()`: an explicitly set env flag decides **both** ways; added `close()`; `freshnessFields()` now carries `watcher` | an operator's `=0` must survive a default-on host, and the UI needs truthful watcher state |
| `packages/web/server/lib/code-graph/host.js` | extracted pure `resolveWatcherEnv()`; never overwrites an explicitly set watcher flag | makes the production decision testable and keeps operator intent authoritative |
| `packages/web/server/lib/code-graph/runtime.watcher-default.test.js` | new suite (16 tests) | pins production wiring, precedence, idempotency, disposal, failure safety, payload truth |
| `packages/web/server/lib/code-graph/runtime.watcher-fs.test.js` | new suite (10 tests) | filesystem correctness against a clean full-build reference |
| `packages/ui/src/lib/codeGraphApi.ts`, `packages/ui/src/components/code-graph/*` | watcher state surfaced in the existing panel | the user can tell "updates by itself" from "re-checks when you return" |

## 4. Production watcher lifecycle

```text
server start
  └─ createCodeGraphHost({ storeDir, watcherEnabled: true })
       └─ resolveWatcherEnv()  → child env ALCODE_CODE_GRAPH_WATCHER=1
            (skipped when the operator already set the flag)
            └─ worker: isWatcherEnabled() → true
                 └─ first read of a scope → ensureWatcher(key, scopeRoot)
                      └─ fsPromises.watch(scopeRoot, { recursive: true, signal })

filesystem event
  └─ scheduleWatcherSync(key)        debounce (default 150ms, unref'd)
       └─ triggerWatcherSync(key)
            ├─ pending cancel? → invalidate only, never resurrect
            ├─ invalidateWatcherScope(key)   status cache + catch-up memo
            └─ ensureIndex(scopeRoot)        single-flight: joins a running job
                 └─ build → persist (atomic rename) → publish generation
                      └─ next read serves the new generation

shutdown
  ├─ worker host: process ends (production)
  └─ in-process consumer: runtime.close() → closeWatchers() → timers + handles released
```

**Disable paths, all still authoritative:**

| Mechanism | Effect |
|---|---|
| `syncDisabled: true` (settings gate) | watcher never starts |
| `CODEGRAPH_NO_WATCHER=1` | watcher never starts |
| `CODEGRAPH_NO_DAEMON=1`, `CODEGRAPH_SYNC_DISABLED=1` | watcher never starts |
| `ALCODE_CODE_GRAPH_WATCHER=0` (or `false`/`off`/`no`) | beats the host default |
| `watcherEnabled: false` option | beats everything |
| focus / visibility / directory change | remains as the fallback revalidation path either way |

## 5. Incremental update behaviour

A watcher event does not rebuild blindly. It invalidates the scope and calls the same `ensureIndex` the read path uses, which:

- **joins** an in-flight build instead of starting a second one (single-flight by scope key);
- reuses the previous generation when the revision still matches, and re-analyses only what changed when a snapshot is retained (`runtime.js:2281`, two-phase incremental);
- publishes a **new generation** only when a build completes, through the atomic rename in `snapshot-storage.js`;
- leaves the last valid generation untouched when a build fails or a file is unreadable.

A watcher event is therefore **not** proof of an update. The proof is a published generation whose records match a clean build — which is exactly what the FS suite asserts.

## 6. Persistence and restart recovery

Measured and documented in §9 and the evidence file. The rule is unchanged from before this phase: restore is gated on `revision + fingerprint`, so a tree that moved while the app was closed is a **miss → rebuild**, not a silent stale serve.

## 7. UI observability

The panel already reported pending work through `staleFiles` / `pendingSync` / `syncStatus`; what it could not say was **whether the graph updates itself**. That gap is closed without a new panel, route or event system.

**Backend** — `freshnessFields()` in `runtime.js` now carries, on every served envelope:

```js
watcher: { enabled, watchedScopes, debounceMs }
```

Computed from the resolved option, the live watcher map size and the debounce — no I/O, no inference, and it cannot disagree with the code path that actually decides.

**Frontend** — `CodeGraphIndexSummary` gained an optional `watcher` field (an older server still type-checks and renders no line), and the panel renders one `typography-micro` line beneath the existing fresh/stale badge:

| Backend state | What the panel says |
|---|---|
| watching, nothing pending | "Watching for changes · picks them up automatically" |
| watching, N pending | "Watching for changes · N file(s) pending re-index" |
| watching, sync degraded | "Watching for changes · updates paused while sync is unavailable" |
| not watching, N pending | "Not watching for changes · N file(s) pending re-index · re-checks when you return or change directory" |
| not watching, nothing pending | "Not watching for changes · re-checks when you return or change directory" |
| server did not send `watcher` | no line at all |

The rule enforced in the memo: **pending work always qualifies the claim**, so the line can never say "up to date" while files are outstanding. No percentages, no invented progress — the count shown is the pending-file count the footer already used.

Pan, zoom, selection and every existing banner are untouched; the change is additive (59 lines, no deletions).

## 8. Test coverage and exact commands

| Suite | File | Tests | Command |
|---|---|---|---|
| Production wiring + precedence + lifecycle + payload | `packages/web/server/lib/code-graph/runtime.watcher-default.test.js` | 16 | `cd packages/web && bunx vitest run server/lib/code-graph/runtime.watcher-default.test.js` |
| Filesystem correctness vs a clean full-build reference | `packages/web/server/lib/code-graph/runtime.watcher-fs.test.js` | 10 | `cd packages/web && bunx vitest run server/lib/code-graph/runtime.watcher-fs.test.js` |
| Panel watcher line | `packages/ui/src/components/code-graph/CodeGraphPanel.watcher.test.tsx` + existing panel suites | 5 new, 133 total | `cd packages/ui && bun test src/components/code-graph/` |

**Per-scenario proof in the FS suite** — each compared against a second runtime doing a clean full build from a fresh store (entry, node and edge counts must match; removed paths must report `unindexed`): file create · file edit · file delete · file rename (single identity, old path absent) · directory create · directory delete · atomic save (tmp + rename) · rapid consecutive saves (generation exactly base+1) · bulk change · **events during an active build** (both changes land, exactly one new generation — the single-flight join).

**Branch switch** is proven separately on the real-code repo, in both directions and with **exact** symbol matching (the graph search is fuzzy, so membership is asserted by `name === query`):

| Checked-out branch | `zzBranchOnly` | `zzMainOnly` |
|---|---|---|
| `master` | absent | present |
| `feature/branch-probe` | present | absent |

**Concurrency mapping:** join-during-build and coalescing are proven in the FS suite; failure memory and single-flight under concurrent polls in `runtime.failure.test.js`; cancel intent in `runtime.cancel-intent.test.js`, and "a cancelled build leaves no graph behind and never reports a smaller one as ready" in `runtime.partial-publish.test.js`. All of these ran green in the 21-file / 183-test code-graph run below.

**Startup suite proves:** the production server asks for watching (it reads the `createCodeGraphHost` call in `packages/web/server/index.js`), `=0` beats a default-on host, `=1` enables a host that did not ask, unset stays off (back-compat), the settings gate wins, `CODEGRAPH_NO_WATCHER` wins, repeated reads start exactly one watcher, `close()` disposes and clears, a throwing factory and a null handle degrade to the revision gate without throwing, and the payload reports watching truthfully in both states.

## 9. Measurements

**Environment:** Windows 11 (win32 x64), 12-core i5-12400F, Bun 1.4.2, repo at `f0c6b70cc` plus this phase working-tree changes. The Alcode desktop app was running during the real-scope run.

Measurements are kept **separate on purpose** — they answer different questions and must never be averaged into one number.

### (iv) Full cold index — the baseline cost

| Scope | Entries | Duration | Result |
|---|---|---|---|
| `I:/migration/Alwork` (real monorepo) | 7,198 | **365,728 ms** (6 min 6 s) | 517,410 nodes · 541,071 edges · generation 26 · freshness=fresh · truncated=false |
| SDK copy (real TypeScript, git repo) | 68 | **3,372–3,824 ms** | 6,508 nodes · 6,695 edges |

### (i) Same-session edit → visible graph, watcher ON — the headline

Real monorepo, watcher enabled, **no manual action of any kind**:

| Change | Edit → new generation served | Generation | Entries |
|---|---|---|---|
| create one .ts file | **17,326 ms** | 26 → 30 | 7,198 → 7,201 |
| delete that file | **4,883 ms** | 30 → 31 | 7,201 → 7,200 |

This is the behaviour the phase exists to produce: the file was saved and the graph converged on its own. It is **not** instant — a sync re-analyses the scope, and on a 7,198-entry monorepo that is seconds to tens of seconds, not milliseconds.

### (ii) Fresh-process restore

| Scope | Duration | Result |
|---|---|---|
| 68-entry real-code repo, second process | **387 ms** | identical counts (68 / 6,508 / 6,695), freshness=fresh |
| same repo, third process | **440 ms** | identical counts |

### (iii) Fresh-process recovery after off-session changes

| Scenario | Duration | Result |
|---|---|---|
| tree changed while no process ran (file added, renamed, deleted) | **3,081–3,648 ms** (rebuild after revision miss) | new content served; deleted symbol gone |

### Convergence to a clean full-build reference

| Comparison | Stored graph | Clean full build | Equal |
|---|---|---|---|
| 68-entry real-code repo | 68 / 6,508 / 6,695 | 68 / 6,508 / 6,695 | **true** |

At unit level the same equality is asserted for **every** FS scenario against a fresh-store clean build.

**Honest caveat on the real-scope numbers:** documentation was written into the repository *during* the Alwork run, so the tree moved underneath the measurement (hence 7,198 → 7,201 → 7,200 rather than a return to baseline). The Alwork figures are valid as **latency** evidence; the **convergence** proof comes from the frozen-tree repo and the ten-scenario suite, not from Alwork.

## 10. Known limitations and follow-up work

1. **Generation numbers can repeat across restarts (pre-existing, not introduced here).** `buildSeq` is a per-runtime counter starting at 0 (`runtime.js:951`) adopted from the store only on a restore (`:3203`). A rebuild after a revision miss re-publishes generation **1** with different content — measured: manifest `buildSeq=1` while `nodeCount` moved 6,508 → 6,511 → 6,508 across three processes. Within one process numbering is monotonic, so the live path is unaffected; a client holding rows across a restart cannot rely on the number to detect change. **Follow-up:** adopt the stored buildSeq even on a miss so a rebuild mints stored+1, with its own test matrix.
2. **Real-monorepo convergence was not measured** (tree moved during the run). The 68-entry repo and the ten-scenario suite carry that claim instead.
3. **Warm restore on the 7,198-entry scope was not captured** — that probe was cancelled; 387 ms / 440 ms is the 68-entry figure.
4. **Edit cost scales with scope.** 17.3 s for one file on 7,198 entries. Incremental reuse depends on a retained snapshot; without one the sync re-analyses. Sub-second single-file edits on large scopes is a separate optimisation, not a freshness bug.
5. **Branch switch is proven on a fresh process, not under a live watcher.** Switching `master` ↔ `feature/branch-probe` produced the correct exact symbol membership in both directions, but each check ran in a new process. A branch switch while the panel is open is handled by the same revision gate the watcher triggers; that exact live sequence was not measured.
6. **Unsupported filesystems degrade silently.** Where `fs.watch` with `recursive: true` is unavailable, the watcher never starts and the panel truthfully says "Not watching for changes" — without explaining why.
7. **Panel copy is literal English**, matching the adjacent status lines in the same block. No i18n keys were added deliberately: keys without real translations would be worse. Follow-up: route these through the locale layer.
8. **Windows-only measurement.** macOS/Linux `fs.watch` recursive behaviour differs; the code path is identical but unmeasured here.
9. **The watcher reacts to any event, including documentation writes** — a docs-only edit triggers the same sync as a source edit.
10. **No live UI observation of the new panel line.** The running Alcode instance is a packaged build from before this source change, so the watcher line was verified by component tests only (both states, plus pending-never-up-to-date) and by reading the render path. Seeing it live requires a packaged rebuild (`bun run build:web-assets` + `package.mjs`), which this phase did not run. The maintainer is running this live pass; see §11.

## 11. Live QA checklist (for the maintainer's run)

Run these against a build that includes this change, and send the log/observations back:

| # | Step | Pass condition |
|---|---|---|
| 1 | Open a project and open Settings → Code graph | The new line reads **"Watching for changes · picks them up automatically"** |
| 2 | Edit any source file, save, stay on the panel | The line shows pending/updating, then returns to watching; the generation/entry counts change **without pressing anything** |
| 3 | Delete a file, save | Its symbols disappear; the line settles back to watching |
| 4 | `git switch` to another branch | The graph follows the branch without manual action |
| 5 | Restart the app, reopen the same project | The graph appears quickly (restore), then the line reads watching |
| 6 | Set `ALCODE_CODE_GRAPH_WATCHER=0` and restart | The line reads **"Not watching for changes · re-checks when you return or change directory"** |
| 7 | Set `CODEGRAPH_NO_WATCHER=1` and restart | Same as 6 — the kill switch wins over the default |

Anything that disagrees with the table is a defect in this phase and should come back with the app log; the backend reports its own truth in the `watcher` field of every code-graph index response, so a mismatch between that field and the rendered line localises the fault immediately.


## 12. Phase 1.1 — reliability closure

Phase 1 left three gaps. This section records what closed, what was measured, and what remains bounded.

### 12.1 Generation identity across restarts (FIXED)

A runtime mints generation numbers from a counter starting at zero, and the stored number was adopted only on a restore **hit**. A fresh process whose tree had changed missed the store, rebuilt from zero and republished generation **1** for different content — a client holding rows from the earlier generation 1 could not tell the graph had changed.

The store already returned the stale manifest with a scope-mismatch miss (`snapshot-storage.js:322`); `restoreFromStore` discarded it. The fix adopts that number before the rebuild (`runtime.js` `adoptPublishedSeq`), so a rebuild mints the next generation. Misses carrying no manifest — no store, corrupt JSON, incompatible version — adopt nothing and stay safe.

| Step | Generation |
|---|---|
| cold build | 1 |
| restart + restore | 1 (159 ms) |
| modify tree while closed | — |
| restart + **rebuild** | **2** (was 1 before the fix) |
| restart + restore | 2 (190 ms) |
| persisted manifest | `buildSeq=2` |

Arithmetic isolated: forcing the stored value to 26 makes the next rebuild mint **27** and persist 27. Pinned by `runtime.generation-monotonic.test.js` (6 tests: rebuild-after-miss, three restarts 1→2→3, missing store, corrupt manifest, incompatible version, two scopes independent).

### 12.2 Why one edit advanced generation 26 → 30 (ANSWERED)

Instrumented on a quiet tree with the real watcher:

- one file creation emits **3 OS events** (`rename:<file>`, `change:<dir>`, `change:<file>`);
- the per-scope debounce coalesces them into **one** sync — two `ready` events carried the **same** generation `[3,3]`;
- the generation advanced by **exactly 1**.

So 26 → 30 was not per-event republication. Each source-relevant change costs exactly +1, and that Phase-1 window contained four source-relevant writes (the probe plus the new and edited source files the delegated lanes wrote during the cold build). The exact four events cannot be reconstructed retroactively; the mechanism and the candidate set are proven and the residual uncertainty is stated rather than hidden.

### 12.3 Filtering is already correct (NO CODE ADDED)

| Change | Generation delta |
|---|---|
| documentation-only `.md` | **0** |
| temporary `.tmp` | **0** |
| real `.ts` source | **+1** |

The revision gate is computed over the indexed entry set, so changes that cannot affect the graph do not trigger a rebuild. A filter layer would duplicate that guarantee and risk semantics, so none was added — the requirement is met by measurement, not new code.

### 12.4 Branch switch under a live watcher (PROVEN)

`runtime.branch-switch.test.js` — 6/6 — covers changed source, deleted file, renamed file, switch during an in-flight build, rapid consecutive switches, and return to the original branch. Each asserts scope isolation (same scopeRoot/projectId, one watched scope) and convergence against a clean full build of the same checkout.

### 12.5 Frozen real-monorepo equivalence (PROVEN, content-level)

Frozen at `f0c6b70cc` with the working tree recorded (11 entries before the probe, 12 during the run). Shards are content-addressed, so comparing the manifest-published shard hash sets compares graph content, not counts.

| Side | Shards | Files | Node records | Unique ids | Repeated ids |
|---|---|---|---|---|---|
| live (watcher-updated, gen 53) | 7,274 | 7,274 | 517,916 | 517,916 | **0** |
| clean full build (same tree) | 7,274 | 7,274 | 517,916 | 517,916 | **0** |

**SHARDS_EQUAL=true · FILES_EQUAL=true · IDS_EQUAL=true** — `onlyLive=0`, `onlyClean=0`. The watcher-updated graph is byte-equivalent, file for file, to a clean build of the same tree, with no duplicate identities.

Two harness faults were found and fixed before this result counted: the first run created the live runtime without `storeDir` (so nothing persisted and it compared a six-hour-old store), and it listed the shard *directory* instead of the manifest list (so six orphaned shards were miscounted as 1,137 "duplicate identities"). Reading what the store publishes gives zero.

### 12.6 Cross-platform

| Platform | Status | Evidence |
|---|---|---|
| Windows 11 | **verified** | all suites green on the host; watcher 3 OS events → 1 sync → +1 generation |
| Linux (WSL2, kernel `6.6.114.1-microsoft-standard-WSL2`) | **verified** | recursive `fs.watch` probe: 2 nested events, non-recursive control 0; three suites 32/32 on Linux-native vitest |
| macOS | **UNVERIFIED** | no macOS host available; the code path is identical but unmeasured. Not claimed. |

The fallback is the documented one: where recursive watching is unavailable the watcher never starts and the panel says "Not watching for changes" rather than claiming freshness it does not have.

### 12.7 Remaining limitations

1. macOS watcher behaviour is unverified (above).
2. A burst coalesces into one generation, so a large-scope edit is seconds, not milliseconds (7.6 s measured on 7,203 entries in 1.1; 17.3 s in 1.0).
3. Orphaned shard files can accumulate on disk (6 observed after a killed build). The published graph is unaffected; pruning them is a hygiene follow-up.
4. Live in-app UI observation of the watcher line is still the maintainer pass described in §11.
