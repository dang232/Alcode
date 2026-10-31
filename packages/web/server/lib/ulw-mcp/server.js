// Bundled ULW MCP server (native v2 shape).
//
// Speaks MCP over newline-delimited JSON-RPC on stdio: the managed config
// layer points OpenCode at this file under the runtime already executing
// Alcode, so there is nothing to install and no port to agree on.
// `initialize` and `tools/list` are answered locally; `tools/call` shells
// out to the ulw-loop CLI: an explicit OMO_ULW_LOOP_CLI override (staged
// copy or user path) wins, else the checkout dist beside a checkout server.
// A missing CLI fails closed with the pointer and the rebuild command — it
// never shells out to a guessed path, so a half-staged install reads as a
// named error instead of a node MODULE_NOT_FOUND stack.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_NAME = 'ulw-mcp';
const SERVER_VERSION = '0.1.0';
const PROTOCOL_VERSION = '2024-11-05';
const CALL_TIMEOUT_MS = 120_000;

const missingCliError = () => new Error(
  'No usable ulw-loop CLI: set OMO_ULW_LOOP_CLI at a built ulw-loop dist/cli.js, '
  + 'or rebuild it (checkout: npm --prefix packages/omo-engine/omo-codex/plugin/components/ulw-loop run build; ' +
  'packaged: re-run the Electron prepare:ulw-loop-cli step).',
);

const resolveLoopCli = () => {
  const override = (process.env.OMO_ULW_LOOP_CLI ?? '').trim();
  if (override) {
    if (!existsSync(override)) throw missingCliError();
    return override;
  }
  const checkout = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..', '..',
    'omo-engine', 'omo-codex', 'plugin', 'components', 'ulw-loop', 'dist', 'cli.js',
  );
  if (!existsSync(checkout)) throw missingCliError();
  return checkout;
};

// MCP tool name to ulw-loop subcommand. `inspect` is a read-only view over
// the same state `status` reports, and `revise-goals` steers the active
// plan, which is the `steer` mutation entry: neither has a same-named
// subcommand, so both ride the closest one.
const TOOLS = [
  { name: 'create-goals', subcommand: 'create-goals', description: 'Create ULW goals from a brief. Pass taskKind readonly for surveys with no code changes.' },
  { name: 'status', subcommand: 'status', description: 'Report ULW plan and goal status.' },
  { name: 'complete', subcommand: 'complete-goals', description: 'Complete finished ULW goals.' },
  { name: 'dispatch', subcommand: 'dispatch', description: 'Dispatch pending ULW goals to workers.' },
  { name: 'record-child-result', subcommand: 'record-child-result', description: 'Record a ULW child completion.' },
  { name: 'record-child-failure', subcommand: 'record-child-failure', description: 'Record a ULW child failure.' },
  { name: 'record-evidence', subcommand: 'record-evidence', description: 'Record evidence for a success criterion (pass, fail, or blocked).' },
  { name: 'checkpoint', subcommand: 'checkpoint', description: 'Write a ULW checkpoint.' },
  { name: 'inspect', subcommand: 'status', description: 'Read-only view of ULW plan state.' },
  { name: 'revise-goals', subcommand: 'steer', description: 'Revise ULW goals by steering the active plan.' },
];

const toolRecord = (tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: { type: 'object', additionalProperties: true },
});

const toKebab = (key) => String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

// MCP arguments ride as CLI flags: booleans become bare flags, scalars
// become --key value pairs, objects become JSON strings, and arrays ride
// as one repeated --key per item — the CLI only reads repeated flags
// (readRepeated), so a single JSON-string flag parses as one unknown id.
// `--json` is always on so the result parses.
const toArgv = (params = {}) => {
  const argv = ['--json'];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === false) continue;
    const flag = `--${toKebab(key)}`;
    if (value === true) argv.push(flag);
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        argv.push(flag, item?.constructor === Object || Array.isArray(item) ? JSON.stringify(item) : String(item));
      }
    }
    else if (value?.constructor === Object) argv.push(flag, JSON.stringify(value));
    else argv.push(flag, String(value));
  }
  return argv;
};

const callTool = (name, params) => {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (!tool) {
    return { isError: true, content: [{ type: 'text', text: `Unknown ULW tool: ${name}.` }] };
  }
  let cli;
  try {
    cli = resolveLoopCli();
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: error?.message ?? String(error) }],
    };
  }
  let completed;
  try {
    completed = spawnSync(process.execPath, [cli, tool.subcommand, ...toArgv(params)], {
      encoding: 'utf8',
      timeout: CALL_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Could not run the ULW CLI at "${cli}": ${error?.message ?? error}. Build the checkout component (dev) or re-run prepare:ulw-loop-cli (packaged).` }],
    };
  }
  const output = String(completed.stdout ?? '').trim();
  if (completed.status === 0) {
    let structured;
    try {
      structured = output ? JSON.parse(output) : null;
    } catch {
      structured = undefined;
    }
    const result = { content: [{ type: 'text', text: output }] };
    if (structured !== undefined) result.structuredContent = structured;
    return result;
  }
  const detail = String(completed.stderr ?? '').trim() || output || `exit ${completed.status ?? 'unknown'}`;
  return { isError: true, content: [{ type: 'text', text: detail }] };
};

const send = (id, payload) => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...payload })}\n`);
};

const handleMessage = (message) => {
  if (message === null || message === undefined) return;
  const { id, method, params } = Object(message);
  // Notifications carry no id and want no reply.
  if (id === undefined || id === null) return;
  if (method === 'initialize') {
    send(id, {
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
    return;
  }
  if (method === 'tools/list') {
    send(id, { result: { tools: TOOLS.map(toolRecord) } });
    return;
  }
  if (method === 'tools/call') {
    send(id, { result: callTool(params?.name, params?.arguments) });
    return;
  }
  if (method === 'ping') {
    send(id, { result: {} });
    return;
  }
  send(id, { error: { code: -32601, message: `Method not found: ${method}.` } });
};

let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  pending += String(chunk);
  let index;
  while ((index = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, index).trim();
    pending = pending.slice(index + 1);
    if (!line) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (error) {
      process.stderr.write(`[ulw-mcp] ignoring malformed input: ${error?.message ?? error}\n`);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
