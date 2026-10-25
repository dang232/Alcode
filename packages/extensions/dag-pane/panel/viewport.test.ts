// Pure view-math tests for the dag-pane SVG graph (RunGraph port).
// bun:test, no DOM: the anchor/clamp/fit/pan helpers only.
import { describe, expect, test } from 'bun:test';

import {
  anchorView,
  clampScale,
  computeFit,
  DEFAULT_VIEW,
  defaultView,
  dragDistanceExceeded,
  DRAG_THRESHOLD_PX,
  MAX_SCALE,
  MIN_SCALE,
  nextZoomScale,
  panView,
  viewTransform,
  wheelZoom,
  ZOOM_STEP,
} from './viewport.ts';
import { DAG_PANE_LOCALES, stringsFor } from './strings.ts';

describe('defaultView', () => {
  test('starts top-left padded at scale 1', () => {
    expect(defaultView()).toEqual({ x: 16, y: 16, scale: 1 });
    expect(DEFAULT_VIEW).toEqual({ x: 16, y: 16, scale: 1 });
  });

  test('returns a fresh copy per call', () => {
    const first = defaultView();
    first.x = 999;
    expect(defaultView().x).toBe(16);
  });
});

describe('clampScale', () => {
  test('pins to [0.3, 2.5]', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(5)).toBe(MAX_SCALE);
    expect(clampScale(MIN_SCALE)).toBe(MIN_SCALE);
    expect(clampScale(MAX_SCALE)).toBe(MAX_SCALE);
    expect(clampScale(1)).toBe(1);
  });
});

describe('nextZoomScale', () => {
  test('zooms in by 1.1x on negative deltaY', () => {
    expect(nextZoomScale(1, -100)).toBeCloseTo(ZOOM_STEP, 10);
  });

  test('zooms out by 1/1.1 on positive deltaY', () => {
    expect(nextZoomScale(1, 100)).toBeCloseTo(1 / ZOOM_STEP, 10);
  });

  test('clamps at both ends', () => {
    expect(nextZoomScale(MAX_SCALE, -50)).toBe(MAX_SCALE);
    expect(nextZoomScale(MIN_SCALE, 50)).toBe(MIN_SCALE);
  });
});

describe('wheelZoom anchor', () => {
  test('keeps the world point under the cursor fixed on zoom in', () => {
    const before = { x: 16, y: 16, scale: 1 };
    const cursor = { x: 116, y: 116 };
    const after = wheelZoom(before, cursor.x, cursor.y, -100);
    expect(after.scale).toBeCloseTo(1.1, 10);
    // (116 - 16) * 1.1 = 110, so the offset moves to 116 - 110 = 6.
    expect(after.x).toBeCloseTo(6, 10);
    expect(after.y).toBeCloseTo(6, 10);
    // World point is invariant: (cursor - offset) / scale on both views.
    expect((cursor.x - after.x) / after.scale).toBeCloseTo((cursor.x - before.x) / before.scale, 10);
    expect((cursor.y - after.y) / after.scale).toBeCloseTo((cursor.y - before.y) / before.scale, 10);
  });

  test('uses the symmetric form: y anchors on cursorY, not cursorX', () => {
    // A cursorX-in-y typo would answer y = 12 here instead of 2.
    const after = wheelZoom({ x: 10, y: 20, scale: 1 }, 100, 200, -100);
    expect(after.scale).toBeCloseTo(1.1, 10);
    expect(after.x).toBeCloseTo(100 - (100 - 10) * 1.1, 10);
    expect(after.y).toBeCloseTo(200 - (200 - 20) * 1.1, 10);
    expect(after.y).toBeCloseTo(2, 10);
  });

  test('zooms out about the cursor', () => {
    const before = { x: 6, y: 6, scale: 1.1 };
    const after = wheelZoom(before, 116, 116, 100);
    expect(after.scale).toBeCloseTo(1, 10);
    expect((116 - after.x) / after.scale).toBeCloseTo((116 - before.x) / before.scale, 10);
    expect((116 - after.y) / after.scale).toBeCloseTo((116 - before.y) / before.scale, 10);
  });

  test('a clamped step leaves the offset untouched', () => {
    const before = { x: 7, y: 9, scale: MAX_SCALE };
    const after = wheelZoom(before, 200, 150, -100);
    expect(after).toEqual(before);
  });

  test('repeated notches never leave [0.3, 2.5]', () => {
    let zoomedIn = defaultView();
    for (let index = 0; index < 50; index += 1) {
      zoomedIn = wheelZoom(zoomedIn, 100, 100, -100);
    }
    expect(zoomedIn.scale).toBe(MAX_SCALE);
    let zoomedOut = defaultView();
    for (let index = 0; index < 100; index += 1) {
      zoomedOut = wheelZoom(zoomedOut, 100, 100, 100);
    }
    expect(zoomedOut.scale).toBe(MIN_SCALE);
  });
});

describe('anchorView', () => {
  test('factor 1 is the identity on offsets', () => {
    const before = { x: 30, y: 40, scale: 1.2 };
    expect(anchorView(before, 100, 100, 1.2)).toEqual(before);
  });
});

describe('panView', () => {
  test('adds the pointer delta and keeps the scale', () => {
    expect(panView({ x: 10, y: 20, scale: 1.5 }, 5, -8)).toEqual({ x: 15, y: 12, scale: 1.5 });
  });
});

describe('computeFit', () => {
  test('never upscales: a small graph centres at scale 1', () => {
    expect(computeFit(800, 600, 400, 300)).toEqual({ scale: 1, x: 200, y: 150 });
  });

  test('a graph exactly margin-filling still fits at scale 1', () => {
    const fitted = computeFit(432, 332, 400, 300);
    expect(fitted.scale).toBe(1);
    expect(fitted.x).toBeCloseTo(16, 10);
    expect(fitted.y).toBeCloseTo(16, 10);
  });

  test('shrinks a large graph and centres the leftover space', () => {
    const fitted = computeFit(400, 300, 800, 600);
    expect(fitted.scale).toBeCloseTo(300 / 632, 10);
    expect(fitted.scale).toBeLessThan(1);
    // Centred: the scaled graph middle lands on the viewport middle.
    expect(fitted.x + (800 * fitted.scale) / 2).toBeCloseTo(200, 10);
    expect(fitted.y + (600 * fitted.scale) / 2).toBeCloseTo(150, 10);
  });

  test('picks the tighter axis', () => {
    const wide = computeFit(400, 1000, 800, 100);
    expect(wide.scale).toBeCloseTo(400 / 832, 10);
    const tall = computeFit(1000, 300, 100, 800);
    expect(tall.scale).toBeCloseTo(300 / 832, 10);
  });
});

describe('viewTransform', () => {
  test('emits the world-layer transform string', () => {
    expect(viewTransform({ x: 6, y: 6, scale: 1.1 })).toBe('translate(6 6) scale(1.1)');
    expect(viewTransform(defaultView())).toBe('translate(16 16) scale(1)');
  });
});

describe('dragDistanceExceeded', () => {
  test('ignores sub-threshold jitter, fires past it', () => {
    expect(DRAG_THRESHOLD_PX).toBe(4);
    expect(dragDistanceExceeded(0, 0, 0, 0)).toBe(false);
    expect(dragDistanceExceeded(0, 0, 3, 0)).toBe(false);
    expect(dragDistanceExceeded(0, 0, 4, 0)).toBe(false);
    expect(dragDistanceExceeded(0, 0, 5, 0)).toBe(true);
    expect(dragDistanceExceeded(0, 0, 3, 4)).toBe(true);
  });
});

describe('graph strings', () => {
  test('every locale ships Fit plus all five legend labels', () => {
    expect(DAG_PANE_LOCALES).toHaveLength(13);
    for (const locale of DAG_PANE_LOCALES) {
      const strings = stringsFor(locale);
      expect(strings.fit.length).toBeGreaterThan(0);
      expect(strings.legendPending.length).toBeGreaterThan(0);
      expect(strings.legendRunning.length).toBeGreaterThan(0);
      expect(strings.legendCompleted.length).toBeGreaterThan(0);
      expect(strings.legendFailed.length).toBeGreaterThan(0);
      expect(strings.legendBlocked.length).toBeGreaterThan(0);
    }
  });
});
