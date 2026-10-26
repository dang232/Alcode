import { describe, expect, test } from 'bun:test';
import {
  computeFitView,
  graphNodeSignature,
  zoomGraphView,
} from './activityGraphView';

describe('computeFitView', () => {
  test('centers the graph at full scale when the frame is larger', () => {
    expect(computeFitView(800, 600, 400, 200)).toEqual({ scale: 1, x: 200, y: 200 });
  });

  test('shrinks to fit the tighter dimension', () => {
    const view = computeFitView(400, 600, 800, 200);
    expect(view).not.toBeNull();
    expect(Math.abs(view!.scale - 400 / 832)).toBeLessThan(1e-9);
    expect(Math.abs(view!.x - (400 - 800 * (400 / 832)) / 2)).toBeLessThan(1e-9);
  });

  test('refuses a sizeless frame instead of collapsing to scale zero', () => {
    expect(computeFitView(0, 600, 400, 200)).toBeNull();
    expect(computeFitView(800, 0, 400, 200)).toBeNull();
  });
});

describe('zoomGraphView', () => {
  test('zooms in around the cursor', () => {
    const view = zoomGraphView({ x: 0, y: 0, scale: 1 }, 100, 50, true);
    expect(Math.abs(view.scale - 1.1)).toBeLessThan(1e-9);
    expect(Math.abs(view.x - (100 - 100 * 1.1))).toBeLessThan(1e-9);
    expect(Math.abs(view.y - (50 - 50 * 1.1))).toBeLessThan(1e-9);
  });

  test('clamps at both ends of the scale range', () => {
    expect(zoomGraphView({ x: 0, y: 0, scale: 2.5 }, 10, 10, true).scale).toBe(2.5);
    expect(zoomGraphView({ x: 0, y: 0, scale: 0.3 }, 10, 10, false).scale).toBe(0.3);
  });
});

describe('graphNodeSignature', () => {
  test('ignores order but not membership', () => {
    expect(graphNodeSignature(['b', 'a'])).toBe(graphNodeSignature(['a', 'b']));
    expect(graphNodeSignature(['a', 'b'])).not.toBe(graphNodeSignature(['a', 'c']));
  });
});
