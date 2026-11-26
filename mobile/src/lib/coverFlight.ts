// The shared-element hand-off from a library card into the detail hero. There is no native
// shared-transition API that also works in the web export, so the tapped card measures its cover
// in window coordinates, parks that rectangle here, and navigates; the detail screen picks the
// rectangle up on its first layout and flies a copy of the cover from it to the real hero. One
// pending flight at a time, and a flight for any other book is discarded rather than animated
// into the wrong place.

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

let pending: { bookId: string; frame: Frame } | null = null;

export function isMeasurableFrame(frame: Frame | null | undefined): frame is Frame {
  if (!frame) return false;
  const values = [frame.x, frame.y, frame.width, frame.height];
  return values.every((value) => Number.isFinite(value)) && frame.width > 0 && frame.height > 0;
}

export function startCoverFlight(bookId: string, frame: Frame | null | undefined): void {
  pending = isMeasurableFrame(frame) ? { bookId, frame } : null;
}

// Consumed at most once: the flight belongs to the navigation that started it.
export function takeCoverFlight(bookId: string | undefined): Frame | null {
  const current = pending;
  pending = null;
  if (!current || !bookId || current.bookId !== bookId) return null;
  return current.frame;
}

export function clearCoverFlight(): void {
  pending = null;
}
