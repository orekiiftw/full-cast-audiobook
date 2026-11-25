import { perfFormat, perfMark, perfMarks, perfReset, perfSpan, summarizeFrames } from "@/lib/perf";

describe("perf marks", () => {
  beforeEach(() => perfReset());

  it("records marks in order", () => {
    perfMark("detail:open", 1000);
    perfMark("detail:painted", 1400);
    expect(perfMarks()).toEqual([
      { name: "detail:open", at: 1000 },
      { name: "detail:painted", at: 1400 },
    ]);
  });

  it("measures the most recent finish against the most recent start", () => {
    perfMark("detail:open", 1000);
    perfMark("detail:painted", 1600);
    perfMark("detail:open", 5000);
    perfMark("detail:painted", 6200);
    expect(perfSpan("detail:open", "detail:painted")).toBe(1200);
  });

  it("returns null instead of guessing when a screen never got there", () => {
    perfMark("detail:open", 1000);
    expect(perfSpan("detail:open", "detail:painted")).toBeNull();
    expect(perfSpan("nothing", "detail:open")).toBeNull();
  });

  it("ignores a finish recorded before the start", () => {
    perfMark("detail:painted", 500);
    perfMark("detail:open", 1000);
    expect(perfSpan("detail:open", "detail:painted")).toBeNull();
  });

  it("formats the two magnitudes the harness reports", () => {
    expect(perfFormat(null)).toBe("—");
    expect(perfFormat(240)).toBe("240ms");
    expect(perfFormat(1330)).toBe("1.33s");
  });
});

describe("summarizeFrames", () => {
  it("counts a 60fps sampler as smooth", () => {
    const frames = Array.from({ length: 61 }, (_, index) => index * 16.7);
    const summary = summarizeFrames(frames);
    expect(summary.frames).toBe(61);
    expect(summary.dropped).toBe(0);
    expect(summary.fps).toBeGreaterThanOrEqual(59);
    expect(summary.fps).toBeLessThanOrEqual(61);
  });

  it("counts gaps over one and a half frame budgets as dropped", () => {
    const summary = summarizeFrames([0, 16, 33, 66, 83, 183, 200]);
    expect(summary.dropped).toBe(2);
    expect(summary.worstMs).toBe(100);
  });

  it("reports nothing rather than dividing by zero", () => {
    expect(summarizeFrames([])).toEqual({ frames: 0, dropped: 0, elapsedMs: 0, worstMs: 0, fps: 0 });
    expect(summarizeFrames([10])).toEqual({ frames: 1, dropped: 0, elapsedMs: 0, worstMs: 0, fps: 0 });
  });
});
