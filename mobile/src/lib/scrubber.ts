// The scrubber's arithmetic, kept out of the gesture handler: a drag position becomes a ratio,
// a ratio becomes a chapter time, and crossing a tenth fires one haptic tick.

export const SCRUB_TICKS = 10;

export function ratioFromX(x: number, width: number): number {
  if (width <= 0 || !Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x / width));
}

export function msAtRatio(totalMs: number, ratio: number): number {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0;
  return Math.round(Math.max(0, Math.min(1, ratio)) * totalMs);
}

export function rangeAtRatio(segments: { durationMs: number | null }[], ratio: number): { startMs: number; endMs: number } {
  const total = segments.reduce((sum, segment) => sum + (segment.durationMs ?? 0), 0);
  const target = Math.max(0, Math.min(1, ratio)) * total;
  let accumulated = 0;
  for (const segment of segments) {
    const duration = segment.durationMs ?? 0;
    if (duration <= 0) continue;
    if (accumulated + duration >= target) return { startMs: accumulated, endMs: accumulated + duration };
    accumulated += duration;
  }
  return { startMs: Math.max(0, accumulated - 1000), endMs: accumulated };
}

// Which tick bucket a ratio sits in; only a change of bucket fires a haptic.
export function tickBucket(ratio: number, ticks = SCRUB_TICKS): number {
  return Math.round(Math.max(0, Math.min(1, ratio)) * ticks);
}

export function tickCrossed(previousRatio: number, nextRatio: number, ticks = SCRUB_TICKS): boolean {
  return tickBucket(previousRatio, ticks) !== tickBucket(nextRatio, ticks);
}

// Keeps the time bubble inside the track instead of half off either end.
export function bubbleLeft(ratio: number, trackWidth: number, bubbleWidth: number): number {
  const center = Math.max(0, Math.min(1, ratio)) * trackWidth;
  const half = bubbleWidth / 2;
  return Math.max(half, Math.min(trackWidth - half, center));
}
