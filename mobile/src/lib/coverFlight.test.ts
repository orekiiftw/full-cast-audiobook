import { clearCoverFlight, isMeasurableFrame, startCoverFlight, takeCoverFlight } from "@/lib/coverFlight";

const frame = { x: 20, y: 100, width: 167, height: 250 };

describe("cover flight", () => {
  beforeEach(() => clearCoverFlight());

  it("hands the card's rectangle to the detail screen that claims it", () => {
    startCoverFlight("book-1", frame);
    expect(takeCoverFlight("book-1")).toEqual(frame);
  });

  it("is consumed once, so a remount does not replay the flight", () => {
    startCoverFlight("book-1", frame);
    takeCoverFlight("book-1");
    expect(takeCoverFlight("book-1")).toBeNull();
  });

  it("drops a flight that belongs to a different book rather than flying it into the wrong hero", () => {
    startCoverFlight("book-1", frame);
    expect(takeCoverFlight("book-2")).toBeNull();
    expect(takeCoverFlight("book-1")).toBeNull();
  });

  it("refuses a rectangle that was never measured", () => {
    startCoverFlight("book-1", { x: 0, y: 0, width: 0, height: 0 });
    expect(takeCoverFlight("book-1")).toBeNull();

    startCoverFlight("book-1", { x: Number.NaN, y: 10, width: 100, height: 150 });
    expect(takeCoverFlight("book-1")).toBeNull();
  });

  it("rejects a missing or unmeasurable frame", () => {
    expect(isMeasurableFrame(null)).toBe(false);
    expect(isMeasurableFrame({ x: 1, y: 2, width: 0, height: 10 })).toBe(false);
    expect(isMeasurableFrame(frame)).toBe(true);
  });
});
