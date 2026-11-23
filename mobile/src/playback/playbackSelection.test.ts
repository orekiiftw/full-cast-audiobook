import type { Chapter } from "@/api/types";
import { findNextPlayableChapter, resolveStartSegmentIndex } from "./playbackSelection";
import { segment, voicedLine } from "./testFixtures";

function chapter(overrides: Partial<Chapter> & { id: string; chapterIndex: number }): Chapter {
  return {
    bookId: "book-1",
    title: `Chapter ${overrides.chapterIndex}`,
    status: "ready",
    audioR2Key: null,
    durationMs: 60000,
    totalCount: 10,
    voicedCount: 10,
    failedCount: 0,
    ...overrides,
  };
}

describe("resolveStartSegmentIndex", () => {
  const lines = [voicedLine(1, 2000), voicedLine(2, 3000), voicedLine(3, 1000)];

  it("starts at the first playable line when there is nothing to resume", () => {
    expect(resolveStartSegmentIndex(lines, 0)).toBe(0);
    expect(resolveStartSegmentIndex([segment({ segmentIndex: 1, status: "queued", audioUrl: null }), voicedLine(2)], 0)).toBe(1);
  });

  it("finds the line that contains a saved position", () => {
    expect(resolveStartSegmentIndex(lines, 1000)).toBe(0);
    expect(resolveStartSegmentIndex(lines, 2500)).toBe(1);
    expect(resolveStartSegmentIndex(lines, 5900)).toBe(2);
  });

  it("falls forward to the next voiced line when the exact one is not ready", () => {
    const partial = [voicedLine(1, 2000), segment({ segmentIndex: 2, status: "processing", audioUrl: null }), voicedLine(3, 1000)];

    expect(resolveStartSegmentIndex(partial, 2500)).toBe(2);
  });

  it("falls back to the first voiced line when the resume point is past everything voiced", () => {
    const partial = [voicedLine(1, 2000), segment({ segmentIndex: 2, status: "pending", audioUrl: null })];

    expect(resolveStartSegmentIndex(partial, 5000)).toBe(0);
  });
});

describe("findNextPlayableChapter", () => {
  const chapters = [
    chapter({ id: "a", chapterIndex: 1 }),
    chapter({ id: "b", chapterIndex: 2, status: "failed", voicedCount: 0 }),
    chapter({ id: "c", chapterIndex: 3, status: "partial_ready", voicedCount: 4, totalCount: 10 }),
    chapter({ id: "d", chapterIndex: 4, status: "queued", voicedCount: 0, totalCount: 0 }),
  ];

  it("advances to the next chapter that has anything to listen to", () => {
    expect(findNextPlayableChapter(chapters, 1)?.id).toBe("c");
  });

  it("returns nothing at the end of the book", () => {
    expect(findNextPlayableChapter(chapters, 4)).toBeUndefined();
  });
});
