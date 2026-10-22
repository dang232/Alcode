import { afterEach, describe, expect, it } from 'vitest';

import { parseArgs } from './cli-args.js';
import { INJECTED_ENV_KEY, assignInjectedEnv } from '../../server/lib/injected-env.js';

describe('parseArgs ui password default', () => {
  const previous = {
    OPENCHAMBER_UI_PASSWORD: process.env.OPENCHAMBER_UI_PASSWORD,
    [INJECTED_ENV_KEY]: process.env[INJECTED_ENV_KEY],
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('takes a password the user exported', () => {
    delete process.env[INJECTED_ENV_KEY];
    process.env.OPENCHAMBER_UI_PASSWORD = 'theirs';

    expect(parseArgs(['serve']).options.uiPassword).toBe('theirs');
  });

  it('ignores a password OpenChamber put into the shell', () => {
    delete process.env[INJECTED_ENV_KEY];
    delete process.env.OPENCHAMBER_UI_PASSWORD;
    assignInjectedEnv(process.env, { OPENCHAMBER_UI_PASSWORD: 'the-desktop-apps' });

    expect(parseArgs(['serve']).options.uiPassword).toBeUndefined();
    expect(parseArgs(['serve', '--ui-password', 'chosen']).options.uiPassword).toBe('chosen');
  });
});

describe('parseArgs dag --workflow', () => {
  it('parses dag stream --workflow through', () => {
    const parsed = parseArgs(['dag', 'stream', '--workflow', 'plan-then-execute']);

    expect(parsed.command).toBe('dag');
    expect(parsed.dagAction).toBe('stream');
    expect(parsed.options.workflow).toBe('plan-then-execute');
    expect(parsed.removedFlagErrors).toEqual([]);
  });

  it('parses dag stream --workflow=<name> inline through', () => {
    const parsed = parseArgs(['dag', 'stream', '--workflow=plan-then-execute']);

    expect(parsed.options.workflow).toBe('plan-then-execute');
    expect(parsed.removedFlagErrors).toEqual([]);
  });

  it('rejects --workflow where it is not owned', () => {
    const parsed = parseArgs(['serve', '--workflow', 'plan-then-execute']);

    expect(parsed.removedFlagErrors).toContain(
      'Unknown option for serve: --workflow (used by: dag)',
    );
  });

  it('leaves neighboring DAG flags and the default untouched', () => {
    const parsed = parseArgs(['dag', 'stream', '--attach', 'http://127.0.0.1:4096']);

    expect(parsed.options.attach).toBe('http://127.0.0.1:4096');
    expect(parsed.options.workflow).toBeUndefined();
    expect(parsed.removedFlagErrors).toEqual([]);
  });
});
