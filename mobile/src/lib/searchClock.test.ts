import { SEARCH_SOURCES, formatElapsed, searchProgressLine, sourceAnswers } from "@/lib/searchClock";

describe("formatElapsed", () => {
  it("keeps a decimal for the first ten seconds, where the number is the news", () => {
    expect(formatElapsed(0)).toBe("0.0s");
    expect(formatElapsed(1400)).toBe("1.4s");
    expect(formatElapsed(9800)).toBe("9.8s");
  });

  it("rounds to whole seconds past ten", () => {
    expect(formatElapsed(13_300)).toBe("13s");
    expect(formatElapsed(45_600)).toBe("46s");
  });

  it("switches to minutes past a minute", () => {
    expect(formatElapsed(64_000)).toBe("1m 04s");
    expect(formatElapsed(125_000)).toBe("2m 05s");
  });

  it("never shows a negative clock", () => {
    expect(formatElapsed(-40)).toBe("0.0s");
  });
});

describe("sourceAnswers", () => {
  it("marks every source answered when the answer was complete", () => {
    expect(sourceAnswers(["anna-archive"], null)).toEqual([{ provider: "anna-archive", label: "Anna's Archive", answered: true }]);
    expect(sourceAnswers(["a", "b"], [])).toEqual([
      { provider: "a", label: "A", answered: true },
      { provider: "b", label: "B", answered: true },
    ]);
  });

  it("names the providers that are still working", () => {
    const answers = sourceAnswers(["anna-archive", "archive-org", "gutenberg"], ["archive-org"]);
    expect(answers.map((answer) => [answer.label, answer.answered])).toEqual([
      ["Anna's Archive", true],
      ["Internet Archive", false],
      ["Project Gutenberg", true],
    ]);
  });

  it("falls back to the known roster when a first search has no response yet", () => {
    expect(sourceAnswers(null, null).map((answer) => answer.provider)).toEqual(SEARCH_SOURCES);
  });
});

describe("searchProgressLine", () => {
  it("reports the clock alone before any source is known to have answered", () => {
    expect(searchProgressLine(4200, 0, 4)).toBe("Still searching · 4.2s · asking 4 sources");
  });

  it("counts sources in once the response resolves them", () => {
    expect(searchProgressLine(13_300, 3, 4)).toBe("Still searching · 13s · 3 of 4 sources in");
  });
});
