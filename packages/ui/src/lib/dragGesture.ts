export const DRAG_THRESHOLD_PX = 4;

/**
 * True once a pointer has travelled far enough to be a drag rather than a tap.
 * Capture belongs behind this check: capturing on pointerdown retargets the
 * release, so the browser dispatches `click` on the capturing frame and a tap
 * on a node inside it never reaches the node's own handler.
 */
export const exceedsDragThreshold = (startX: number, startY: number, x: number, y: number): boolean =>
  Math.abs(x - startX) > DRAG_THRESHOLD_PX || Math.abs(y - startY) > DRAG_THRESHOLD_PX;
