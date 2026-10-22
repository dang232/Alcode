// Step A trustworthy-execution slice: bridge pump fail-closed counters
// (`omo-bridge-runtime.js:67-69,685,703`) plus the G2 pane/bridge writer
// equivalence pin (`dag-pane/service/main.js:563-603` vs
// `omo-bridge-runtime.js:731-776`).
//
// The pane bundle is built output: Bun inlines the bridge writer into
// `server/built-in-extensions/dag-pane/service/main.js` at build time.
// These tests pin the behavior contract on the bridge side
// (snapshot_too_large + malformed_json counters) and prove the checked-in
// bundle's writer still behaves identically to the bridge source across a
// scripted event sequence. If one copy is patched without the other, the
// equivalence case fails.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  OMO_BRIDGE_EVENT_DAG_UPDATED,
  OMO_BRIDGE_EVENT_TASK_UPDATED,
  createSnapshotWriter,
} from './omo-bridge-runtime.js';

const FIXED_NOW = 1_700_000_000_000;

const createMemoryFs = () => {
  const files = new Map();
  return {
    files,
    writeFileSync: (path, content) => {
      files.set(path, String(content));
    },
    renameSync: (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
};

const dagPayload = (sessionId) => ({ parent_session_id: sessionId, runs: [] });
const taskPayload = (sessionId) => ({ parent_session_id: sessionId, tasks: [] });

// The built pane bundle is a service entry (no exports): extract its
// inlined writer plus the declarations it closes over, then evaluate that
// slice in isolation. Marker assertions fail loudly on bundle drift so a
// regen that renames or moves the writer cannot pass silently.
const loadPaneWriter = () => {
  const bundlePath = new URL('../../built-in-extensions/dag-pane/service/main.js', import.meta.url);
  const text = readFileSync(bundlePath, 'utf8');
  const headMarker = 'var OMO_BRIDGE_EVENT_DAG_UPDATED =';
  const recordMarker = 'var isNonEmptyString =';
  const parseMarker = 'var parseEventLine = (line) => {';
  const writerMarker = 'var createSnapshotWriter = (options) => {';
  const runtimeMarker = 'var createOmoBridgeRuntime = (dependencies = {}) => {';
  const headStart = text.indexOf(headMarker);
  const recordLine = text.indexOf(recordMarker);
  const parseStart = text.indexOf(parseMarker);
  const writerStart = text.indexOf(writerMarker);
  const runtimeStart = text.indexOf(runtimeMarker);
  for (const [name, index] of [['head', headStart], ['isNonEmptyString', recordLine], ['parseEventLine', parseStart], ['createSnapshotWriter', writerStart], ['createOmoBridgeRuntime', runtimeStart]]) {
    expect(index, `pane bundle marker ${name}`).toBeGreaterThan(-1);
  }
  expect(headStart < recordLine && recordLine < parseStart && parseStart < writerStart && writerStart < runtimeStart).toBe(true);
  const recordLineEnd = text.indexOf('\n', recordLine);
  const head = text.slice(headStart, recordLineEnd);
  const parseBlock = text.slice(parseStart, writerStart);
  const writerBlock = text.slice(writerStart, runtimeStart);
  for (const snippet of [head, parseBlock, writerBlock]) {
    expect(snippet).not.toMatch(/^\s*import[\s(]/m);
    expect(snippet).not.toMatch(/^\s*export[\s{]/m);
  }
  const factory = new Function(`${head}\n${parseBlock}\n${writerBlock}\nreturn { createSnapshotWriter, parseEventLine };`);
  return factory();
};

const runWriterScript = (createWriter) => {
  const fs = createMemoryFs();
  const snapshotPath = '/snap/ses_equiv01.snapshot.json';
  const writer = createWriter({ sessionId: 'ses_equiv01', snapshotPath, fs, now: () => FIXED_NOW });
  const outcomes = [
    writer.handleEvent(OMO_BRIDGE_EVENT_DAG_UPDATED, dagPayload('ses_equiv01')),
    writer.handleEvent(OMO_BRIDGE_EVENT_TASK_UPDATED, taskPayload('ses_equiv01')),
    writer.handleEvent(OMO_BRIDGE_EVENT_DAG_UPDATED, dagPayload('ses_other02')),
    writer.handleEvent('bogus.type', dagPayload('ses_equiv01')),
    writer.handleEvent(OMO_BRIDGE_EVENT_DAG_UPDATED, null),
    writer.handleLine('nope{'),
    writer.handleLine(JSON.stringify({ type: OMO_BRIDGE_EVENT_TASK_UPDATED, data: taskPayload('ses_equiv01') })),
    writer.handleLine(JSON.stringify({ type: OMO_BRIDGE_EVENT_DAG_UPDATED, data: dagPayload('ses_other02') })),
  ];
  return { outcomes, stats: { ...writer.stats }, file: fs.files.get(snapshotPath) ?? null };
};

describe('exec slice: bridge pump fail-closed counters', () => {
  it('oversize snapshots are dropped and counted, the file stays put', () => {
    const fs = createMemoryFs();
    const writer = createSnapshotWriter({
      sessionId: 'ses_exec01',
      snapshotPath: '/snap/ses_exec01.snapshot.json',
      fs,
      now: () => FIXED_NOW,
      maxSnapshotBytes: 10,
    });
    const dagOutcome = writer.handleEvent(OMO_BRIDGE_EVENT_DAG_UPDATED, dagPayload('ses_exec01'));
    expect(dagOutcome).toEqual({ accepted: true, written: false, reason: 'snapshot_too_large' });
    const taskOutcome = writer.handleEvent(OMO_BRIDGE_EVENT_TASK_UPDATED, taskPayload('ses_exec01'));
    expect(taskOutcome).toEqual({ accepted: true, written: false, reason: 'snapshot_too_large' });
    expect(writer.stats).toMatchObject({ received: 2, acceptedDag: 1, acceptedTask: 1, droppedOversize: 2, writes: 0 });
    expect(fs.files.size).toBe(0);
  });

  it('malformed pump lines degrade to counters, never throw, never write', () => {
    const fs = createMemoryFs();
    const writer = createSnapshotWriter({
      sessionId: 'ses_exec01',
      snapshotPath: '/snap/ses_exec01.snapshot.json',
      fs,
      now: () => FIXED_NOW,
    });
    const lines = [
      'nope{',
      '[1,2]',
      '',
      '   ',
      '{"type":"omo.dag.updated"}',
      JSON.stringify({ type: 'omo.dag.updated', data: dagPayload('ses_other02') }),
    ];
    const outcomes = lines.map((line) => writer.handleLine(line));
    expect(outcomes.map((outcome) => outcome.reason)).toEqual([
      'malformed_json',
      'malformed_json',
      'empty_line',
      'empty_line',
      'malformed_event',
      'wrong_session',
    ]);
    expect(writer.stats).toMatchObject({ received: 4, droppedMalformed: 3, droppedWrongSession: 1 });
    expect(fs.files.size).toBe(0);
    expect(() => lines.forEach((line) => writer.handleLine(line))).not.toThrow();
  });
});

describe('exec slice: pane bundle writer equivalence (G2 drift pin)', () => {
  it('pane bundle writer matches the bridge writer outcome for outcome', () => {
    const pane = loadPaneWriter();
    expect(typeof pane.createSnapshotWriter).toBe('function');
    const bridge = runWriterScript(createSnapshotWriter);
    const bundled = runWriterScript(pane.createSnapshotWriter);
    expect(bundled.outcomes).toEqual(bridge.outcomes);
    expect(bundled.stats).toEqual(bridge.stats);
    expect(bundled.file).toBe(bridge.file);
    expect(JSON.parse(bundled.file)).toMatchObject({ schemaVersion: 1, sessionId: 'ses_equiv01' });
  });

  it('pane bundle parseEventLine matches the bridge on malformed input', async () => {
    const pane = loadPaneWriter();
    const { parseEventLine } = await import('./omo-bridge-runtime.js');
    for (const line of ['nope{', '[1]', '']) {
      expect(pane.parseEventLine(line)).toEqual(parseEventLine(line));
    }
  });

  it('pane bundle writer counts oversize exactly like the bridge writer', () => {
    const pane = loadPaneWriter();
    const tiny = { sessionId: 'ses_exec01', snapshotPath: '/snap/ses_exec01.snapshot.json', now: () => FIXED_NOW, maxSnapshotBytes: 10 };
    const bridgeFs = createMemoryFs();
    const paneFs = createMemoryFs();
    const bridgeWriter = createSnapshotWriter({ ...tiny, fs: bridgeFs });
    const paneWriter = pane.createSnapshotWriter({ ...tiny, fs: paneFs });
    expect(paneWriter.handleEvent(OMO_BRIDGE_EVENT_DAG_UPDATED, dagPayload('ses_exec01')))
      .toEqual(bridgeWriter.handleEvent(OMO_BRIDGE_EVENT_DAG_UPDATED, dagPayload('ses_exec01')));
    expect(paneWriter.stats).toEqual({ ...bridgeWriter.stats });
    expect(paneFs.files.size).toBe(0);
  });

  it('both writers reject construction misuse with the same coded errors', () => {
    const pane = loadPaneWriter();
    for (const createWriter of [createSnapshotWriter, pane.createSnapshotWriter]) {
      for (const options of [
        { sessionId: '', snapshotPath: '/x', fs: createMemoryFs() },
        { sessionId: 's', snapshotPath: '', fs: createMemoryFs() },
        { sessionId: 's', snapshotPath: '/x', fs: {} },
      ]) {
        let code = null;
        try {
          createWriter(options);
        } catch (error) {
          code = error.code;
        }
        expect(code).toMatch(/^OMO_(SESSION_ID|SNAPSHOT_DIR)_INVALID$/);
      }
    }
  });
});
