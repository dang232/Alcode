import { afterEach, describe, expect, it } from 'vitest';

import { parseArgs } from './cli-args.js';

describe('parseArgs ui password removal', () => {
  const previous = {
    OPENCHAMBER_UI_PASSWORD: process.env.OPENCHAMBER_UI_PASSWORD,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('takes no UI password default from the environment', () => {
    process.env.OPENCHAMBER_UI_PASSWORD = 'theirs';

    const parsed = parseArgs(['serve']);
    expect('uiPassword' in parsed.options).toBe(false);
    expect(parsed.removedFlagErrors).toEqual([]);
  });

  it('rejects --ui-password with a pointer to Alcore login', () => {
    expect(parseArgs(['serve', '--ui-password', 'chosen']).removedFlagErrors).toEqual([
      '`--ui-password` was removed. Browser auth now uses Alcore login.',
    ]);
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
