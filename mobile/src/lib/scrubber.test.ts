import { bubbleLeft, msAtRatio, rangeAtRatio, ratioFromX, tickBucket, tickCrossed } from "@/lib/scrubber";

describe("ratioFromX", () => {
  it("maps a tap across the track to a ratio", () => {
    expect(ratioFromX(0, 200)).toBe(0);
    expect(ratioFromX(50, 200)).toBe(0.25);
    expect(ratioFromX(200, 200)).toBe(1);
  });

  it("clamps a drag that leaves the track", () => {
    expect(ratioFromX(-40, 200)).toBe(0);
    expect(ratioFromX(260, 200)).toBe(1);
  });

  it("returns zero for an unmeasured track", () => {
    expect(ratioFromX(50, 0)).toBe(0);
    expect(ratioFromX(Number.NaN, 200)).toBe(0);
  });
});

describe("msAtRatio", () => {
  it("scales the chapter duration", () => {
    expect(msAtRatio(800_000, 0.5)).toBe(400_000);
    expect(msAtRatio(800_000, 1.4)).toBe(800_000);
  });

  it("returns zero for a chapter with no known duration", () => {
    expect(msAtRatio(0, 0.5)).toBe(0);
  });
});

describe("rangeAtRatio", () => {
  const segments = [{ durationMs: 1000 }, { durationMs: 1000 }, { durationMs: 2000 }];

  it("finds the line under the thumb", () => {
    expect(rangeAtRatio(segments, 0.1)).toEqual({ startMs: 0, endMs: 1000 });
    expect(rangeAtRatio(segments, 0.5)).toEqual({ startMs: 1000, endMs: 2000 });
    expect(rangeAtRatio(segments, 0.9)).toEqual({ startMs: 2000, endMs: 4000 });
  });
});

describe("tick buckets", () => {
  it("fires only when the thumb crosses a tenth", () => {
    expect(tickBucket(0.04)).toBe(0);
    expect(tickBucket(0.06)).toBe(1);
    expect(tickCrossed(0.04, 0.06)).toBe(true);
    expect(tickCrossed(0.02, 0.04)).toBe(false);
    expect(tickCrossed(0.86, 0.96)).toBe(true);
  });

  it("supports a coarser tick count", () => {
    expect(tickCrossed(0.1, 0.3, 4)).toBe(true);
    expect(tickCrossed(0.1, 0.11, 4)).toBe(false);
    expect(tickCrossed(0.1, 0.3, 10)).toBe(true);
  });
});

describe("bubbleLeft", () => {
  it("keeps the time bubble inside the track at both ends", () => {
    expect(bubbleLeft(0, 300, 60)).toBe(30);
    expect(bubbleLeft(1, 300, 60)).toBe(270);
    expect(bubbleLeft(0.5, 300, 60)).toBe(150);
  });
});
