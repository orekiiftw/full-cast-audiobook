import type { Segment } from "../types/api";

export function applySegmentReady(segments: Segment[], event: { segmentId: string; audioUrl: string; durationMs: number }): Segment[] {
  const index = segments.findIndex((segment) => segment.id === event.segmentId);
  if (index < 0) return segments;

  const current = segments[index];
  if (current.status === "voiced" && current.audioUrl === event.audioUrl) return segments;

  const next = segments.slice();
  next[index] = {
    ...current,
    status: "voiced",
    audioUrl: event.audioUrl,
    durationMs: event.durationMs,
  };
  return next;
}
