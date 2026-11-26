import type { Segment } from "@/api/types";

// The playback position changes four times a second while a chapter plays. It used to live in
// the player provider's React state, so every tick re-rendered the provider and therefore the
// whole navigator — the library, the detail list and the transcript all rebuilt because a
// number in the dock had moved. It lives here instead: an external store that only the
// components that display a position subscribe to.

export interface PositionSnapshot {
  positionMs: number;
  chapterTotalMs: number;
}

type Listener = () => void;

let snapshot: PositionSnapshot = { positionMs: 0, chapterTotalMs: 0 };
const listeners = new Set<Listener>();

export function getPositionSnapshot(): PositionSnapshot {
  return snapshot;
}

export function setPosition(positionMs: number, chapterTotalMs = snapshot.chapterTotalMs): void {
  if (snapshot.positionMs === positionMs && snapshot.chapterTotalMs === chapterTotalMs) return;
  snapshot = { positionMs, chapterTotalMs };
  for (const listener of [...listeners]) listener();
}

export function setChapterTotal(chapterTotalMs: number): void {
  if (snapshot.chapterTotalMs === chapterTotalMs) return;
  snapshot = { ...snapshot, chapterTotalMs };
  for (const listener of [...listeners]) listener();
}

export function resetPosition(): void {
  setPosition(0, 0);
}

export function subscribePosition(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function positionRatio(snapshot: PositionSnapshot): number {
  return snapshot.chapterTotalMs > 0 ? Math.max(0, Math.min(1, snapshot.positionMs / snapshot.chapterTotalMs)) : 0;
}

export function chapterDurationOf(segments: Segment[]): number {
  return segments.reduce((total, segment) => total + (segment.durationMs ?? 0), 0);
}
