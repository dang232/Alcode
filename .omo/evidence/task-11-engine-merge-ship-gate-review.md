# Gate Review — Task 11 Ship /ulw command + #ulw snippet alias

- recommendation: APPROVE
- executor claim: st_01a12a84, branch engine-merge-alias @ 2fa7455724b5d4ef9a40f35b2b323eb79a4da7b7 (parent 7b3a0ce), worktree I:/migration/Alwork-wt/engine-merge-alias
- gate verdict: confirmed (confidence 0.95)
- report path: I:/migration/.omo/evidence/task-11-engine-merge-ship-gate-review.md (fallback; no ulw-loop plan / currentAttemptDir resolvable in this session)

## originalIntent

Plan I:/migration/.omo/plans/engine-merge-ship.md todo 11: ship BOTH alias forms — a /ulw slash-command file plus a #ulw snippet alias — wired through the existing commands/snippets stacks; slash-menu listing via the commands stack; bare prefix-less ulw deliberately unchanged; no bare-ulw interceptor; no model-prompt touches.

## desiredOutcome

Typing /ulw resolves to the engine workflows through the commands stack and typing #ulw expands via the snippet alias registry, with unknown names failing safely and no behavior change to bare ulw.

## userOutcomeReview

Satisfied. /ulw resolves project-scoped with its template through the real commands stack (live 200 reproduced); #ulw expands through the real snippet loader (live 200 reproduced); unknown snippet still 404s; unknown command returns the pre-existing absence-signal envelope (see deviation D2, acceptable); only the two intended markdown files were added; no interceptor, no prompt, no production-code change.

## Checked artifact paths

- I:/migration/.omo/evidence/task-11-engine-merge-ship.md (executor evidence — read fully)
- I:/migration/.omo/plans/engine-merge-ship.md (todo 11 acceptance + QA scenarios)
- I:/migration/Alwork-wt/engine-merge-alias/.opencode/commands/ulw.md (new file)
- I:/migration/Alwork-wt/engine-merge-alias/.opencode/snippet/ulw-engine.md (new file)
- .../packages/web/server/lib/opencode/commands.js (PROJECT_COMMAND_DIR_NAMES, getProjectCommandPath)
- .../packages/web/server/lib/opencode/snippets.js (getProjectSnippetDirs, alias registry, expand)
- .../packages/web/server/lib/opencode/config-entity-routes.js (GET commands/:name, snippets routes; md5-identical base..lane)
- .../packages/web/server/lib/opencode/feature-routes-runtime.js (real server wires the same real functions)
- .../packages/ui/src/components/chat/CommandAutocomplete.tsx, SnippetAutocomplete.tsx, useSnippetsStore.ts, useCommandsStore.ts (menu chains)

## Probe results (all run by the gate, full outputs quoted in evidence below)

1. Branch: `log --oneline -2` = `2fa7455 feat(engine): ulw slash command plus snippet alias` on parent `7b3a0ce feat(engine): merged loop-status caller`. `show --stat HEAD` = exactly 2 files, 26 insertions. `status --porcelain` empty before and after. CONFIRMED.
2. Snippet-dir convention: `getProjectSnippetDirs` returns BOTH `.opencode/snippets` AND `.opencode/snippet` (snippets.js lines 13-19); `getWritableSnippetDir` prefers singular `snippet`. Singular is a REAL scanned dir, not a miss. Live `GET /api/config/snippets/ulw` -> 200 `{"name":"ulw-engine",...,"aliases":["ulw]",...,"filePath":"...\\.opencode\\snippet\\ulw-engine.md","source":"project"}` through the real loader. CONFIRMED.
3. Unknown-command 200 vs plan's 404: route handler (`GET /api/config/commands/:name`, config-entity-routes.js:288-311) has NO 404 path — always 200 with `isBuiltIn: !md.exists && !json.exists`. Route + commands.js + snippets.js are byte-identical base..lane (`git diff 7b3a0ce HEAD -- <3 files>` empty; route md5 `7d9f95d8927e2fe57d91c02f6b227f45` both sides), so base ALSO returns 200-with-null-scope. Plan text expectation was wrong; no worker regression. Live lane repro: `GET /api/config/commands/does-not-exist-xyz` -> 200 `{"scope":null,"isBuiltIn":true,...}` (absence signal, no crash). Deviation D2 ACCEPTABLE as plan-text correction.
4. Command resolution: live `GET /api/config/commands/ulw` -> 200 `{"scope":"project","isBuiltIn":false, ... "path":"...\\.opencode\\commands\\ulw.md","scope":"project",...,"fields":["template","description"]}`; `GET .../ulw/config` -> 200 `{source:md, scope:project, config.template: "You are working in the OpenChamber repository..."}`. Bare-ulw interceptor: none — commit adds only the 2 files; repo grep for interceptor/bare-ulw/prefixless handling finds only unrelated pre-existing "bare" comments. CONFIRMED.
5. Menu registration: `PROJECT_COMMAND_DIR_NAMES = ['commands','command']` (commands.js); `getProjectCommandPath` ancestor-walk covers `.opencode/commands/ulw.md` -> project scope proven by live 200. UI chains verified by code: `CommandAutocomplete -> useCommandsStore -> /api/config/commands/:name(/config)`; `SnippetAutocomplete -> useSnippetsStore -> /api/config/snippets(/:name|/expand)` over `listSnippets`. Live UI-menu click not performed; covered by registration path + API per probe allowance. CONFIRMED with that record.
6. Server-boot block: at gate time port 57123 was FREE (`netstat | grep 57123` exit 1). Full boot from the lane tree (`bun server/index.js --port 3213`) SUCCEEDED: `OpenChamber server listening on 127.0.0.1:3213` + `Desktop Google callback listening on 127.0.0.1:57123`. Full-server HTTP hit an unrelated auth layer (401 Authentication required), so endpoint proof rests on the route-module harness (same `registerConfigEntityRoutes` + same real functions the full server passes in feature-routes-runtime.js:325-353). Executor's block was environmental/time-bound, not a code issue. No foreign PIDs touched; my probe servers (3229/3213) killed, TEMP harness deleted.
7. Shared branches: wave1 (`ui-alcore-readiness`) at `50786f9b` unmoved; train `engine-merge-train-t3-group` at `7b3a0ce` unmoved; no landing performed (orchestrator's job). CONFIRMED.
8. dirty_worktree: clean (empty porcelain at start and end). stale_state: start/end recorded here. N/A one-liners: prompt_injection (command/snippet bodies are static markdown; `show --stat` proves no model-prompt file touched), cancel_resume, hung_commands, flaky_tests, repeated_interrupts (none occurred; no untrusted text executed).
9. Malformed input: live `GET /api/config/snippets/does-not-exist-xyz` -> 404 `{"error":"Snippet \"does-not-exist-xyz\" not found"}`; live `POST /api/config/snippets/expand {"text":"run #ulw now"}` -> 200 with `#ulw` replaced by the alias body. CONFIRMED.

## Overfit/slop pass (remove-ai-slops + programming criteria, applied directly)

No skill files were resolvable in this session, so the criteria were applied from the task text by the gate itself. Result CLEAN: zero tests added (nothing tautological, deletion-only, implementation-mirroring, or removal-verifying); zero production-code changes (no extraction, parsing, or normalization to maintain); diff is exactly the 2 intended static markdown files — no scope drift, no maintenance burden, no false-confidence scaffolding.

## Evidence gaps (NOTEs, not blockers)

- G1: no standalone code-review-report artifact was supplied with the inputs; the skill-perspective check above was performed directly by the gate instead. No criterion requires that report artifact, so this is a NOTE.
- G2: live UI-menu click (seeing /ulw and #ulw in the rendered autocomplete) was not performed; registration-path code + live API proof stand in per the probe allowance. NOTE.
- G3: full-server endpoint bodies were not quotable (auth-walled 401); route-module proof with identical wiring is exact for these endpoints. NOTE.

## blockers

None. No stated success criterion fails.

## Deviations disposition

- D1 (snippet singular dir): NOT a deviation — confirmed real scanned dir.
- D2 (unknown-command 200 vs plan 404): plan-text error, worker behavior matches base byte-for-byte. ACCEPTABLE, correct the plan text.
- D3 (full-boot blocked claim): environmental at executor time; gate performed the full boot successfully. No action.
