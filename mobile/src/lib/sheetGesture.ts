// The bottom sheet's gesture rules, apart from the component so they can be tested without a
// touch surface or a running animation runtime.

export const DRAG_DISMISS_DISTANCE = 110;
export const DRAG_DISMISS_VELOCITY = 0.9;
const DRAG_START_SLOP = 6;

// A downward drag claims the sheet; a sideways one is left to whatever is underneath (the
// results list scrolls vertically, the header itself has nothing to swipe sideways).
export function isDismissDrag(dy: number, dx: number): boolean {
  return dy > DRAG_START_SLOP && Math.abs(dy) > Math.abs(dx);
}

// Past the distance threshold, or flicked fast enough, the sheet closes; otherwise it springs back.
export function shouldDismissSheet(dy: number, vy: number): boolean {
  return dy > DRAG_DISMISS_DISTANCE || vy > DRAG_DISMISS_VELOCITY;
}

// The visible offset while the finger moves: never above the resting position.
export function dragOffset(dy: number): number {
  return Math.max(0, dy);
}
