import { describe, expect, it } from "bun:test";
import { applySegmentReady } from "./segmentPatch";
import type { Segment } from "../types/api";

function seg(id: string, overrides: Partial<Segment> = {}): Segment {
  return {
    id,
    chapterId: "chapter-1",
    segmentIndex: 1,
    rawText: "Some narration.",
    status: "pending",
    audioUrl: null,
    durationMs: null,
    ...overrides,
  };
}

const READY = { segmentId: "s2", audioUrl: "/api/audio?key=k2&v=5000", durationMs: 5000 };

describe("applySegmentReady", () => {
  it("marks the event's line voiced and playable", () => {
    const before = [seg("s1"), seg("s2"), seg("s3")];
    const after = applySegmentReady(before, READY);
    expect(after[1].status).toBe("voiced");
    expect(after[1].audioUrl).toBe("/api/audio?key=k2&v=5000");
    expect(after[1].durationMs).toBe(5000);
  });

  it("leaves every other line untouched, replaces only the patched entry, and never mutates the input", () => {
    const before = [seg("s1"), seg("s2"), seg("s3")];
    const after = applySegmentReady(before, READY);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(after[1]).not.toBe(before[1]);
    expect(before[1].status).toBe("pending");
  });

  it("returns the identical array for a duplicate event so React can bail out", () => {
    const once = applySegmentReady([seg("s1"), seg("s2")], READY);
    const twice = applySegmentReady(once, READY);
    expect(twice).toBe(once);
  });

  it("returns the identical array for a line that isn't in this chapter", () => {
    const before = [seg("s1"), seg("s2")];
    expect(applySegmentReady(before, { ...READY, segmentId: "other-chapter-line" })).toBe(before);
  });

  it("preserves the transcript text and index when patching", () => {
    const before = [seg("s2", { rawText: "Keep me.", segmentIndex: 7 })];
    const after = applySegmentReady(before, READY);
    expect(after[0].rawText).toBe("Keep me.");
    expect(after[0].segmentIndex).toBe(7);
  });

  it("re-patches when a regeneration changes the URL", () => {
    const voiced = seg("s2", { status: "voiced", audioUrl: "/api/audio?key=k2&v=1000", durationMs: 1000 });
    const after = applySegmentReady([voiced], READY);
    expect(after[0].audioUrl).toBe("/api/audio?key=k2&v=5000");
    expect(after[0].durationMs).toBe(5000);
  });
});
