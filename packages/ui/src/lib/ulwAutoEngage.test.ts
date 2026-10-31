import { describe, expect, test } from 'bun:test';

import { AUTO_ENGAGE_MIN_CHARS, resolveAutoRunIntent } from './ulwAutoEngage';

const workBrief = (body: string): string => `# Repo work order

${body}

## Phase A — Baseline
Map the implementation, list the confirmed defects with file paths.

## Phase B — Critical correctness
Fix the confirmed P0 defects first, keep the change small.

## Definition of done
Every fix is proven by its run on the real surface with the kept tests green.

Priority P0 items come before anything else. Do not stop after a plan:
continue through implementation and verification.
`;

const padTo = (text: string, length: number): string => (
  text.length >= length ? text.slice(0, length) : text + 'x'.repeat(length - text.length)
);

describe('resolveAutoRunIntent: the work chooses the workflow', () => {
  test('a long structured execution brief starts a run with no trigger words', () => {
    const brief = padTo(workBrief('Audit the checkout end to end.'), AUTO_ENGAGE_MIN_CHARS + 200);

    expect(brief.toLowerCase()).not.toContain('ulw');
    const intent = resolveAutoRunIntent(brief);

    expect(intent).not.toBeNull();
    expect(intent?.args).toBe(brief.trim());
    expect(intent?.signals.length).toBeGreaterThan(0);
  });

  test('a brief just under the length floor stays plain chat', () => {
    const brief = padTo(workBrief('Audit the checkout end to end.'), AUTO_ENGAGE_MIN_CHARS - 1);

    expect(resolveAutoRunIntent(brief)).toBeNull();
  });

  test('a long pasted log plus a question stays plain chat', () => {
    const log = `${'Error: something failed\n    at frame (app.js:10:5)\n'.repeat(120)}What does this trace mean?`;

    expect(log.length).toBeGreaterThan(AUTO_ENGAGE_MIN_CHARS);
    expect(resolveAutoRunIntent(log)).toBeNull();
  });

  test('a long structured read-only brief stays plain chat', () => {
    const brief = padTo(
      '# Release notes\n\n## Phase A — Recap\n\nPriority P0 highlights.\n\n## Definition of done\nSummarize what shipped.',
      AUTO_ENGAGE_MIN_CHARS + 100,
    );

    expect(resolveAutoRunIntent(brief)).toBeNull();
  });

  test('short execution chat stays plain chat', () => {
    expect(resolveAutoRunIntent('fix the login bug')).toBeNull();
    expect(resolveAutoRunIntent('audit the repo and verify it works')).toBeNull();
  });

  test('shell input never engages', () => {
    const brief = padTo(workBrief('Audit the checkout end to end.'), AUTO_ENGAGE_MIN_CHARS + 200);

    expect(resolveAutoRunIntent(brief, 'shell')).toBeNull();
  });

  test('an empty message stays plain chat', () => {
    expect(resolveAutoRunIntent('')).toBeNull();
  });
});
