// Pure view math for the dag-pane SVG graph (RunGraph port, no DOM).
//
// One translate + one uniform scale: screen = world * scale + offset.
// The world layer (`g.dag-world`) carries `translate(x y) scale(s)` about
// the world origin, so the anchor math below holds. Clamp, step, and margin
// mirror `RunGraph.tsx`: scale in [0.3, 2.5], 1.1x per wheel notch, 32px
// total fit margin, shrink-only fit.

export type View = { x: number; y: number; scale: number };

export const MIN_SCALE = 0.3;
export const MAX_SCALE = 2.5;
export const ZOOM_STEP = 1.1;
export const FIT_MARGIN = 32;
export const DRAG_THRESHOLD_PX = 4;

export const DEFAULT_VIEW: View = { x: 16, y: 16, scale: 1 };

export const defaultView = (): View => ({ ...DEFAULT_VIEW });

export const clampScale = (scale: number): number => (
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
);

export const nextZoomScale = (current: number, deltaY: number): number => (
  clampScale(current * (deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))
);

// Anchor: the world point under the cursor stays under the cursor,
// offset' = cursor - (cursor - offset) * (next / current).
// Both axes use their own cursor component (the symmetric form).
export const anchorView = (view: View, cursorX: number, cursorY: number, nextScale: number): View => {
  const scale = clampScale(nextScale);
  const factor = scale / view.scale;
  return {
    scale,
    x: cursorX - (cursorX - view.x) * factor,
    y: cursorY - (cursorY - view.y) * factor,
  };
};

export const wheelZoom = (view: View, cursorX: number, cursorY: number, deltaY: number): View => (
  anchorView(view, cursorX, cursorY, nextZoomScale(view.scale, deltaY))
);

export const panView = (view: View, deltaX: number, deltaY: number): View => ({
  ...view,
  x: view.x + deltaX,
  y: view.y + deltaY,
});

// Shrink-only fit with a 32px total margin, centred on both axes.
export const computeFit = (
  viewportWidth: number,
  viewportHeight: number,
  graphWidth: number,
  graphHeight: number,
): View => {
  const scale = Math.min(1, Math.min(
    viewportWidth / (graphWidth + FIT_MARGIN),
    viewportHeight / (graphHeight + FIT_MARGIN),
  ));
  return {
    scale,
    x: (viewportWidth - graphWidth * scale) / 2,
    y: (viewportHeight - graphHeight * scale) / 2,
  };
};

export const viewTransform = (view: View): string => (
  `translate(${view.x} ${view.y}) scale(${view.scale})`
);

export const dragDistanceExceeded = (
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold: number = DRAG_THRESHOLD_PX,
): boolean => (
  Math.hypot(currentX - startX, currentY - startY) > threshold
);
