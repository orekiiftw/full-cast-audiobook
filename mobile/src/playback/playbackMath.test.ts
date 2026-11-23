import {
  chapterDurationMs,
  findNextIndex,
  findPrevIndex,
  hasPendingLines,
  playbackProgressPercent,
  positionMsFor,
  resolveSeekPlan,
  segmentSourceKey,
  sumDurationsBefore,
} from "./playbackMath";
import { segment, voicedLine } from "./testFixtures";

describe("segment advance", () => {
  it("steps over failed lines and stops at -1 at the end", () => {
    const lines = [voicedLine(1), segment({ segmentIndex: 2, status: "failed", audioUrl: null }), voicedLine(3)];

    expect(findNextIndex(lines, 0)).toBe(2);
    expect(findNextIndex(lines, 2)).toBe(-1);
  });

  it("does not advance past a pending line — the player waits for it instead", () => {
    const lines = [voicedLine(1), segment({ segmentIndex: 2, status: "processing", audioUrl: null }), voicedLine(3)];

    expect(findNextIndex(lines, 0)).toBe(1);
    expect(hasPendingLines(lines)).toBe(true);
  });

  it("steps back over failed lines and clamps at the first line", () => {
    const lines = [voicedLine(1), segment({ segmentIndex: 2, status: "failed", audioUrl: null }), voicedLine(3)];

    expect(findPrevIndex(lines, 2)).toBe(0);
    expect(findPrevIndex(lines, 0)).toBe(-1);
  });

  it("knows when nothing is left to voice", () => {
    expect(hasPendingLines([voicedLine(1), voicedLine(2)])).toBe(false);
  });
});

describe("position math", () => {
  const lines = [voicedLine(1, 2000), voicedLine(2, 3000), voicedLine(3, 1000)];

  it("sums the lines before an index", () => {
    expect(sumDurationsBefore(lines, 0)).toBe(0);
    expect(sumDurationsBefore(lines, 2)).toBe(5000);
    expect(chapterDurationMs(lines)).toBe(6000);
  });

  it("turns a line offset into an absolute chapter position", () => {
    expect(positionMsFor(lines, 0, 0)).toBe(0);
    expect(positionMsFor(lines, 1, 1.5)).toBe(3500);
    expect(positionMsFor(lines, 2, 0.25)).toBe(5250);
  });

  it("clamps an offset that overruns its own line", () => {
    expect(positionMsFor(lines, 1, 99)).toBe(5000);
  });

  it("maps a scrub ratio back to a line and an offset inside it", () => {
    expect(resolveSeekPlan(lines, 0, 0)).toEqual({ index: 0, offsetSec: 0, positionMs: 0, appliesInPlace: true });

    const middle = resolveSeekPlan(lines, 0, 0.5);
    expect(middle).not.toBeNull();
    expect(middle?.index).toBe(1);
    expect(middle?.offsetSec).toBeCloseTo(1);
    expect(middle?.positionMs).toBe(3000);
    expect(middle?.appliesInPlace).toBe(false);

    const end = resolveSeekPlan(lines, 2, 1);
    expect(end?.index).toBe(2);
    expect(end?.appliesInPlace).toBe(true);
  });

  it("has no plan for a chapter with no known durations", () => {
    expect(resolveSeekPlan([segment({ segmentIndex: 1, durationMs: null })], 0, 0.5)).toBeNull();
  });

  it("reports progress as a clamped percentage", () => {
    expect(playbackProgressPercent(0, 0)).toBe(0);
    expect(playbackProgressPercent(3000, 6000)).toBe(50);
    expect(playbackProgressPercent(9000, 6000)).toBe(100);
  });

  it("versions a source by the line's duration so a re-voiced line reloads", () => {
    const key = segmentSourceKey(voicedLine(4, 1234), "https://example.test/a.wav");
    expect(key).toBe("seg-4:1234:https://example.test/a.wav");
  });
});
