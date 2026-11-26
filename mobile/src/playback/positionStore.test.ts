import {
  chapterDurationOf,
  getPositionSnapshot,
  positionRatio,
  resetPosition,
  setChapterTotal,
  setPosition,
  subscribePosition,
} from "@/playback/positionStore";

const segments = [{ durationMs: 1000 }, { durationMs: 3000 }] as unknown as Parameters<typeof chapterDurationOf>[0];

describe("position store", () => {
  beforeEach(() => resetPosition());

  it("publishes a moved position to its subscribers", () => {
    const seen: number[] = [];
    const stop = subscribePosition(() => seen.push(getPositionSnapshot().positionMs));
    setPosition(250, 4000);
    setPosition(500);
    stop();
    setPosition(750);
    expect(seen).toEqual([250, 500]);
  });

  it("stays quiet when nothing moved, so a 250ms sampler does not churn", () => {
    let calls = 0;
    subscribePosition(() => {
      calls += 1;
    });
    setPosition(250, 4000);
    setPosition(250, 4000);
    expect(calls).toBe(1);
  });

  it("keeps the chapter length alongside the position", () => {
    setChapterTotal(4000);
    setPosition(1000);
    expect(getPositionSnapshot()).toEqual({ positionMs: 1000, chapterTotalMs: 4000 });
    expect(positionRatio(getPositionSnapshot())).toBe(0.25);
  });

  it("reports a zero ratio for a chapter of unknown length", () => {
    resetPosition();
    expect(positionRatio(getPositionSnapshot())).toBe(0);
  });

  it("clamps a position the audio clock reported past the end", () => {
    setPosition(6000, 4000);
    expect(positionRatio(getPositionSnapshot())).toBe(1);
  });

  it("sums the durations of the lines it was given", () => {
    expect(chapterDurationOf(segments)).toBe(4000);
  });
});
