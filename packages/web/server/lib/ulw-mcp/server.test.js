import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, 'server.js');

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

// The stub stands in for the ulw-loop CLI: it answers 0 and echoes the argv
// it was given, so the test observes exactly what the MCP server forwarded.
const writeStubCli = async (directory) => {
  const stubPath = path.join(directory, 'ulw-loop-stub.mjs');
  await fs.writeFile(
    stubPath,
    `process.stdout.write(JSON.stringify({ argv: process.argv.slice(3) }));\n`,
    'utf8',
  );
  return stubPath;
};

const callTool = (stubPath, tool, args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, OMO_ULW_LOOP_CLI: stubPath },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const responses = new Map();
  let pending = '';
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error('MCP tools/call timed out'));
  }, 15000);
  timer.unref?.();
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    pending += String(chunk);
    let index;
    while ((index = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, index).trim();
      pending = pending.slice(index + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        if (message?.id !== undefined) responses.set(message.id, message);
      } catch {
        // Non-JSON stdio noise; keep waiting for the call answer.
      }
      if (responses.has(1)) {
        clearTimeout(timer);
        child.kill();
        resolve(responses.get(1));
      }
    }
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } })}\n`);
});

const stubArgvFor = async (tool, args) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alcode-ulw-mcp-'));
  temporaryDirectories.push(directory);
  const stubPath = await writeStubCli(directory);
  const response = await callTool(stubPath, tool, args);
  expect(response?.result?.isError).not.toBe(true);
  return JSON.parse(response.result.content[0].text).argv;
};

describe('ulw-mcp argument forwarding', () => {
  it('emits one repeated flag per array item so the CLI reads every goal id', async () => {
    // The dispatch subcommand only reads repeated --goal-id flags
    // (readRepeated); a single JSON-string flag is one unknown id.
    const argv = await stubArgvFor('dispatch', { goalId: ['goal-a', 'goal-b'], sessionId: 'ses-1' });

    expect(argv).toEqual(['--json', '--goal-id', 'goal-a', '--goal-id', 'goal-b', '--session-id', 'ses-1']);
  });

  it('keeps scalar, boolean, and object forwarding unchanged', async () => {
    const argv = await stubArgvFor('create-goals', {
      brief: 'harden the loop',
      taskKind: 'survey',
      retryFailed: false,
      count: 3,
      filter: { status: 'pending' },
    });

    expect(argv).toEqual([
      '--json',
      '--brief', 'harden the loop',
      '--task-kind', 'survey',
      '--count', '3',
      '--filter', '{"status":"pending"}',
    ]);
  });

  it('forwards no session scope the caller did not pass', async () => {
    const argv = await stubArgvFor('dispatch', { brief: 'unscoped' });

    expect(argv).not.toContain('--session-id');
  });
});
