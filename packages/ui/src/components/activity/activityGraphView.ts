/**
 * Pure view-math for the run-graph viewport. Kept outside the component so
 * the fit/zoom contracts are unit-testable and shared: the component owns
 * the frame and the pointer, this module owns the numbers.
 */
export type GraphView = { x: number; y: number; scale: number };

export const MIN_GRAPH_SCALE = 0.3;
export const MAX_GRAPH_SCALE = 2.5;
const ZOOM_STEP = 1.1;
const FIT_PAD = 32;

/** Fitted view for the frame, or null when the frame has no size yet. */
export const computeFitView = (
  frameWidth: number,
  frameHeight: number,
  graphWidth: number,
  graphHeight: number,
): GraphView | null => {
  if (!(frameWidth > 0) || !(frameHeight > 0)) return null;
  const scale = Math.min(
    1,
    Math.min(frameWidth / (graphWidth + FIT_PAD), frameHeight / (graphHeight + FIT_PAD)),
  );
  return {
    scale,
    x: (frameWidth - graphWidth * scale) / 2,
    y: (frameHeight - graphHeight * scale) / 2,
  };
};

/** Zoom step around the cursor, clamped to the component's scale range. */
export const zoomGraphView = (
  view: GraphView,
  cursorX: number,
  cursorY: number,
  zoomIn: boolean,
): GraphView => {
  const next = Math.min(
    MAX_GRAPH_SCALE,
    Math.max(MIN_GRAPH_SCALE, view.scale * (zoomIn ? ZOOM_STEP : 1 / ZOOM_STEP)),
  );
  const factor = next / view.scale;
  return {
    scale: next,
    x: cursorX - (cursorX - view.x) * factor,
    y: cursorY - (cursorY - view.y) * factor,
  };
};

/** Identity of the node set: refit when this changes, never on state updates. */
export const graphNodeSignature = (ids: readonly string[]): string => [...ids].sort().join(',');
