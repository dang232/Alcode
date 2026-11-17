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
      force: true,
    });

    expect(argv).toEqual([
      '--json',
      '--brief', 'harden the loop',
      '--task-kind', 'survey',
      '--force',
    ]);
  });

  it('stringifies an object payload onto its own flag', async () => {
    const argv = await stubArgvFor('checkpoint', { codexGoalJson: { status: 'pending' } });

    expect(argv).toEqual(['--json', '--codex-goal-json', '{"status":"pending"}']);
  });

  it('forwards no session scope the caller did not pass', async () => {
    const argv = await stubArgvFor('dispatch', { goalId: ['goal-a'] });

    expect(argv).not.toContain('--session-id');
  });
});

describe('ulw-mcp tool contracts', () => {
  const request = async (message) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alcode-ulw-mcp-'));
    temporaryDirectories.push(directory);
    const stubPath = await writeStubCli(directory);
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, OMO_ULW_LOOP_CLI: stubPath },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('MCP reply timed out')); }, 15000);
      timer.unref?.();
      let pending = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        pending += String(chunk);
        let index;
        while ((index = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, index).trim();
          pending = pending.slice(index + 1);
          if (!line) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed?.id === 1) { clearTimeout(timer); child.kill(); resolve(parsed); }
          } catch {
            // Not our answer yet.
          }
        }
      });
    });
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return answer;
  };

  const callToolVia = (name, args) => request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

  it('publishes the arguments each tool actually reads', async () => {
    const response = await request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const tools = response.result.tools;
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    const createGoals = byName.get('create-goals').inputSchema;
    expect(Object.keys(createGoals.properties)).toContain('brief');
    expect(Object.keys(createGoals.properties)).toContain('sessionId');
    expect(createGoals.additionalProperties).toBe(false);

    const childResult = byName.get('record-child-result').inputSchema;
    expect(childResult.required).toEqual(['goalId', 'childId', 'resultRef']);

    const steer = byName.get('revise-goals').inputSchema;
    expect(Object.keys(steer.properties)).toContain('kind');
    expect(Object.keys(steer.properties)).toContain('sessionId');

    expect(byName.get('inspect').inputSchema.properties).toHaveProperty('sessionId');
  });

  it('refuses an argument the tool does not declare instead of forwarding it', async () => {
    const response = await callToolVia('create-goals', { runId: 'r-1', goals: [{ title: 't1' }] });

    expect(response?.result?.isError).toBe(true);
    const text = response.result.content[0].text;
    expect(text).toContain('Unknown argument(s) for create-goals');
    expect(text).toContain('runId');
    expect(text).toContain('Allowed:');
  });

  it('refuses a call that omits a required argument', async () => {
    const response = await callToolVia('record-child-result', { goalId: 'goal-a', childId: 'child-a' });

    expect(response?.result?.isError).toBe(true);
    expect(response.result.content[0].text).toContain('Missing required argument(s) for record-child-result');
    expect(response.result.content[0].text).toContain('resultRef');
  });
});
