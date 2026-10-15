// Bundled /ulw workflow appendix (ulw-workflow-delivery).
//
// Commands resolve per session directory (`commands.js`: project
// `.opencode/commands/` then user dirs), so a project without its own
// `ulw.md` — the normal case — leaves a bare `ulw` or typed `/ulw` send
// with no template. The Codex world covers that gap with its
// `UserPromptSubmit` hook, which appends the workflow directive whenever
// the prompt matches word-bound `ultrawork|ulw`; Alcode sends never
// pass that pipeline. This module is the Alcode side of that hook:
// `routeMessage` attaches the instruction below as prompt context when
// the send names `ulw` and nothing resolved, so the model runs the loop
// instead of truthfully reporting that no workflow is loaded.
//
// The instruction drives the engine's owning interface
// (`omo-agent-toolkit ulw-loop`, per
// `packages/omo-engine/omo-codex/plugin/skills/ulw-loop/`): the CLI owns
// state transitions (locks, revisions, session scoping), so the model
// never hand-writes loop state — the skill forbids exactly that.

export const ULW_COMMAND_NAME = 'ulw';

/**
 * The workflow instruction attached to an unresolved `ulw` send. Takes the
 * session id for CLI scoping: every state subcommand runs against exactly
 * one session, and the CLI refuses unscoped state. Returns plain text: the
 * caller admits it as prompt context, the same channel the command route
 * uses for skill instructions.
 */
export const ulwWorkflowInstruction = (sessionId: string): string => (
  'You are running the user\'s /ulw request: the ultrawork loop. '
  + 'There IS a ulw workflow — drive it below and never say it is missing.\n\n'
  + 'Drive the loop through the engine CLI and never hand-write loop state:\n'
  + 'Resolve the CLI internal-first before the first command: `$OMO_ULW_LOOP_CLI` when set (the host exports '
  + 'the internal build), else the checkout `packages/omo-engine/omo-codex/plugin/components/ulw-loop/dist/cli.js` via node, '
  + 'else `omo-agent-toolkit` on PATH (it must answer `ulw-loop help`). '
  + 'If none resolves, say how you looked and stop.\n'
  + `- Scope every call: pass \`--session-id "${sessionId}"\` on each invocation; '\n`
  + '- `ulw-loop create-goals --session-id "<id>" --brief "<goal>" --json` first; do the work in steps; '
  + '`ulw-loop checkpoint` to advance and record evidence; `ulw-loop complete-goals` at the end; '
  + '`ulw-loop status --json` to read. Run `<cli> ulw-loop <subcommand> --help` for flags.\n'
  + '- State under `.omo/ulw-loop/<id>/` (brief, goals, ledger) is written only through the CLI — '
  + 'never hand-edit it; the DAG runs pane tracks it.\n'
  + 'For multi-goal runs, fan out through this runtime only: run `ulw-loop dispatch --json`, '
  + 'spawn one engine task worker per handoff concurrently, wait for each real result, record it with '
  + '`record-child-result` (or `record-child-failure`), and only then checkpoint each goal — '
  + 'checkpoint refuses completion while a dispatched child has no recorded result. '
  + 'Never hand delegated work to an external orchestrator CLI; the DAG panel tracks this loop.\n\n'
  + 'If the request names engine surfaces (native run, loop status, worker jobs, skills catalog, DAG pane, tab stats), drive each through its owning interface and report the exact invocation per surface. '
  + 'The user\'s goal, if any, is the message this instruction is attached to.'
);
