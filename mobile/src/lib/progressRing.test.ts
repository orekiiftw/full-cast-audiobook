import { ringLabel, ringRotation } from "@/lib/progressRing";

describe("ringRotation", () => {
  it("sweeps only the first half up to half a turn", () => {
    expect(ringRotation(0)).toEqual({ first: 0, second: 0 });
    expect(ringRotation(0.25)).toEqual({ first: 90, second: 0 });
    expect(ringRotation(0.5)).toEqual({ first: 180, second: 0 });
  });

  it("sweeps the second half past half a turn", () => {
    expect(ringRotation(0.75)).toEqual({ first: 180, second: 90 });
    expect(ringRotation(1)).toEqual({ first: 180, second: 180 });
  });

  it("clamps nonsense to a full or empty ring rather than spinning past itself", () => {
    expect(ringRotation(-3)).toEqual({ first: 0, second: 0 });
    expect(ringRotation(4)).toEqual({ first: 180, second: 180 });
    expect(ringRotation(Number.NaN)).toEqual({ first: 0, second: 0 });
  });
});

describe("ringLabel", () => {
  it("reads as a percentage of the chapter voiced", () => {
    expect(ringLabel(4, 18)).toBe("22%");
    expect(ringLabel(18, 18)).toBe("100%");
  });

  it("stays empty when the chapter has no known lines yet", () => {
    expect(ringLabel(0, 0)).toBe("");
  });
});
