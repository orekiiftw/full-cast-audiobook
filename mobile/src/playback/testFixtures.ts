import type { Segment } from "@/api/types";

export function segment(overrides: Partial<Segment> & { segmentIndex: number }): Segment {
  return {
    id: `seg-${overrides.segmentIndex}`,
    chapterId: "chapter-1",
    rawText: `Line ${overrides.segmentIndex}`,
    status: "voiced",
    audioUrl: `/api/audio?key=book/ch/seg-${overrides.segmentIndex}.wav`,
    durationMs: 1000,
    ...overrides,
  };
}

export function voicedLine(segmentIndex: number, durationMs = 1000): Segment {
  return segment({ segmentIndex, durationMs });
}
