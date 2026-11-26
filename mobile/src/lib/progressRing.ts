// A progress ring without react-native-svg: two half-circle masks, the first sweeping 0→180°
// and the second 180→360°, which is enough to draw any ratio with plain Views. The rotations
// are Reanimated shared values so a studio event moving `done/total` animates on the UI thread.

export interface RingRotation {
  // Degrees of sweep applied to the first half (0–180) and the second (0–180).
  first: number;
  second: number;
}

export function ringRotation(ratio: number): RingRotation {
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  const degrees = clamped * 360;
  return { first: Math.min(180, degrees), second: Math.max(0, degrees - 180) };
}

// The numeric readout a ring can carry, e.g. "4/18" — collapsed to a percentage in the small
// chapter-sized ring, where the counter would not fit.
export function ringLabel(done: number, total: number): string {
  if (total <= 0) return "";
  return `${Math.round((Math.min(done, total) / total) * 100)}%`;
}
