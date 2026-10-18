// Activity-card data for ULW turns: phase, counts, and overall status from
// control-plane calls. Pure assertions on summarizeUlwActivity (no mocks);
// rendering, copy, and grouping belong to the future card component.
import { describe, expect, test } from 'bun:test';

import { collectUlvRun, expandUlvCalls, isAllUlwExecutePart, summarizeUlwActivity, type UlwToolCall } from './ulwActivity';

const call = (tool: string, status: UlwToolCall['status'] = 'completed'): UlwToolCall => ({ tool, status });

describe('summarizeUlwActivity', () => {
  test('empty input is idle, never a verdict', () => {
    expect(summarizeUlwActivity([])).toEqual({ total: 0, completed: 0, failed: 0, active: 0, phase: 'idle', status: 'pending' });
    expect(summarizeUlwActivity([{ tool: 'shell', status: 'completed' }])).toEqual({ total: 0, completed: 0, failed: 0, active: 0, phase: 'idle', status: 'pending' });
  });

  test('goal creation reads as planning', () => {
    expect(summarizeUlwActivity([call('ulw_create-goals'), call('ulw_inspect')])).toEqual(
      { total: 2, completed: 2, failed: 0, active: 0, phase: 'planning', status: 'running' },
    );
  });

  test('dispatch advances to investigating', () => {
    expect(summarizeUlwActivity([call('ulw_create-goals'), call('ulw_dispatch', 'running')])).toEqual(
      { total: 2, completed: 1, failed: 0, active: 1, phase: 'investigating', status: 'running' },
    );
  });

  test('checkpoint advances to synthesizing', () => {
    const summary = summarizeUlwActivity([
      call('ulw_dispatch'),
      call('ulw_record-child-result'),
      call('ulw_checkpoint', 'running'),
    ]);
    expect(summary.phase).toBe('synthesizing');
    expect(summary.status).toBe('running');
    expect(summary.total).toBe(3);
  });

  test('a completed complete call closes the run', () => {
    expect(summarizeUlwActivity([call('ulw_dispatch'), call('ulw_complete')])).toEqual(
      { total: 2, completed: 2, failed: 0, active: 0, phase: 'completed', status: 'completed' },
    );
  });

  test('any failure fails the summary without moving the phase', () => {
    const summary = summarizeUlwActivity([call('ulw_dispatch'), { tool: 'ulw_record-child-failure', status: 'error' }]);
    expect(summary).toEqual({ total: 2, completed: 1, failed: 1, active: 0, phase: 'investigating', status: 'failed' });
  });

  test('record-evidence advances to investigating', () => {
    expect(summarizeUlwActivity([call('ulw_create-goals'), call('ulw_record-evidence')])).toEqual(
      { total: 2, completed: 2, failed: 0, active: 0, phase: 'investigating', status: 'running' },
    );
  });

  test('dotted code-mode names reach the same stages', () => {
    const summary = summarizeUlwActivity([{ tool: 'ulw.checkpoint', status: 'running' }]);
    expect(summary).toEqual({ total: 1, completed: 0, failed: 0, active: 1, phase: 'synthesizing', status: 'running' });
  });

  test('unrecognized ulw calls count but advance no stage', () => {
    expect(summarizeUlwActivity([{ tool: 'ulw_future-op', status: 'pending' }])).toEqual(
      { total: 1, completed: 0, failed: 0, active: 1, phase: 'planning', status: 'running' },
    );
  });
});

describe('collectUlvRun', () => {
  const parts = [
    { id: 't1', type: 'text' },
    { id: 'c1', type: 'tool', tool: 'ulw_create-goals' },
    { id: 'c2', type: 'tool', tool: 'ulw_dispatch' },
    { id: 's1', type: 'tool', tool: 'shell' },
    { id: 'c3', type: 'tool', tool: 'ulw_status' },
  ];
  const visible = () => true;

  test('collects the consecutive run and stops at other parts', () => {
    expect(collectUlvRun(parts, 1, 'm1', visible)).toEqual({
      run: [{ id: 'c1', index: 1 }, { id: 'c2', index: 2 }],
      next: 3,
    });
  });

  test('restarts after the break', () => {
    expect(collectUlvRun(parts, 4, 'm1', visible)).toEqual({
      run: [{ id: 'c3', index: 4 }],
      next: 5,
    });
  });

  test('a hidden call ends the run without consuming it', () => {
    const { run, next } = collectUlvRun(parts, 1, 'm1', (part) => part.id !== 'c2');
    expect(run).toEqual([{ id: 'c1', index: 1 }]);
    expect(next).toBe(2);
  });

  test('missing ids fall back to message-scoped keys', () => {
    const { run } = collectUlvRun([{ type: 'tool', tool: 'ulw_status' }], 0, 'm9', visible);
    expect(run).toEqual([{ id: 'm9-part-0-tool', index: 0 }]);
  });

  test('starting past the end collects nothing', () => {
    expect(collectUlvRun(parts, 9, 'm1', visible)).toEqual({ run: [], next: 9 });
  });
});

describe('code-mode execute grouping', () => {
  const visible = () => true;
  const executePart = (
    id: string,
    toolCalls: { readonly tool: string; readonly status: string; readonly input?: Record<string, string> }[],
  ) => ({
    id,
    type: 'tool',
    tool: 'execute',
    state: { status: 'completed' as const, input: {}, output: '', metadata: { toolCalls }, time: { start: 0, end: 0 } },
  });
  const ulwScript = (id: string) => executePart(id, [
    { tool: 'ulw.checkpoint', status: 'completed', input: {} },
    { tool: 'ulw.status', status: 'completed', input: {} },
  ]);

  test('an execute script calling only ulw tools joins the run', () => {
    expect(isAllUlwExecutePart(ulwScript('e1'))).toBe(true);
  });

  test('a mixed script stays an ordinary script row', () => {
    const mixed = executePart('e2', [
      { tool: 'ulw.status', status: 'completed', input: {} },
      { tool: 'shell', status: 'completed', input: {} },
    ]);
    expect(isAllUlwExecutePart(mixed)).toBe(false);
  });

  test('a script that called nothing stays an ordinary script row', () => {
    expect(isAllUlwExecutePart(executePart('e3', []))).toBe(false);
    expect(isAllUlwExecutePart({ id: 'e4', type: 'tool', tool: 'execute' })).toBe(false);
  });

  test('non-execute parts never count as scripts', () => {
    expect(isAllUlwExecutePart({ id: 'c1', type: 'tool', tool: 'ulw_status' })).toBe(false);
  });

  test('collectUlvRun spans direct and script-wrapped ulw calls but stops at mixed scripts', () => {
    const singleUlv = executePart('e2', [{ tool: 'ulw.status', status: 'completed', input: {} }]);
    const mixedShell = executePart('e3', [
      { tool: 'ulw.status', status: 'completed', input: {} },
      { tool: 'shell', status: 'completed', input: {} },
    ]);
    const runParts = [
      { id: 'c1', type: 'tool', tool: 'ulw_create-goals' },
      ulwScript('e1'),
      singleUlv,
      mixedShell,
      { id: 'c2', type: 'tool', tool: 'ulw_status' },
    ];
    expect(collectUlvRun(runParts, 0, 'm1', visible)).toEqual({
      run: [
        { id: 'c1', index: 0 },
        { id: 'e1', index: 1 },
        { id: 'e2', index: 2 },
      ],
      next: 3,
    });
  });

  test('expandUlvCalls counts one entry per scripted control-plane call', () => {
    expect(expandUlvCalls(ulwScript('e1'), 'completed')).toEqual([
      { tool: 'ulw.checkpoint', status: 'completed' },
      { tool: 'ulw.status', status: 'completed' },
    ]);
    expect(expandUlvCalls({ id: 'c1', type: 'tool', tool: 'ulw_status' }, 'running')).toEqual([
      { tool: 'ulw_status', status: 'running' },
    ]);
  });

  test('expanded script calls summarize by phase', () => {
    const summary = summarizeUlwActivity(expandUlvCalls(ulwScript('e1'), 'completed'));
    expect(summary).toEqual({ total: 2, completed: 2, failed: 0, active: 0, phase: 'synthesizing', status: 'running' });
  });
});
