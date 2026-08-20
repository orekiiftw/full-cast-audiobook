import { describe, expect, it } from "bun:test";
import { segmentChapter } from "./segmentService";
import { BookBlock } from "./epubService";
import { SEGMENT } from "./lib/constants";

describe("segmentChapter", () => {
  it("chunks standard narration blocks into segments", () => {
    const blocks: BookBlock[] = [
      {
        type: "narration",
        text: "The morning light filtered through the dense branches of the ancient forest, illuminating the mossy path below.",
      },
      {
        type: "narration",
        text: "Elena paused at the crossing, checking her compass and adjusting the worn leather strap of her traveling pack.",
      },
      {
        type: "narration",
        text: "Every step brought them closer to the borderlands where the ruins were rumored to lie hidden beneath the mist.",
      },
    ];

    const segments = segmentChapter(blocks);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0].segmentIndex).toBe(1);
    expect(segments[0].text).toContain("The morning light");
    expect(segments[0].isSceneBreak).toBe(false);
  });

  it("isolates headings so they do not exhaust the prose lead-in budget", () => {
    const blocks: BookBlock[] = [
      { type: "heading", text: "Chapter 1: The Beginning" },
      {
        type: "narration",
        text: "This is the first sentence of the real story that follows the chapter heading.",
      },
      {
        type: "narration",
        text: "The journey begins here with steady determination as the characters advance.",
      },
    ];

    const segments = segmentChapter(blocks);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    // Heading should be its own segment
    expect(segments[0].text).toBe("Chapter 1: The Beginning");
    expect(segments[0].segmentIndex).toBe(1);
    // Next segment starts the prose
    expect(segments[1].text).toContain("This is the first sentence");
    expect(segments[1].segmentIndex).toBe(2);
  });

  it("detects explicit scene breaks and marks isSceneBreak correctly", () => {
    const blocks: BookBlock[] = [
      { type: "narration", text: "The conversation ended on a grim note as darkness settled over the camp." },
      { type: "narration", text: "* * *" },
      { type: "narration", text: "The next morning brought clearer skies and renewed hope for the travelers." },
    ];

    const segments = segmentChapter(blocks);
    expect(segments.length).toBe(2);
    expect(segments[0].isSceneBreak).toBe(true);
    expect(segments[1].text).toContain("The next morning");
    expect(segments[1].isSceneBreak).toBe(false);
  });

  it("respects sentence boundaries and does not split on common abbreviations", () => {
    const text = "Dr. Watson met Mr. Holmes at 221B Baker St. in London. They discussed the mysterious case with Prof. Moriarty.";
    const blocks: BookBlock[] = [{ type: "narration", text }];

    const segments = segmentChapter(blocks);
    expect(segments.length).toBe(1);
    expect(segments[0].text).toContain("Dr. Watson met Mr. Holmes");
    expect(segments[0].text).toContain("Prof. Moriarty.");
  });

  it("hard-splits oversized text exceeding HARD_MAX_WORDS", () => {
    const oversizedSentence = Array.from({ length: 650 }, (_, i) => `word${i}`).join(" ");
    const blocks: BookBlock[] = [{ type: "narration", text: oversizedSentence }];

    const segments = segmentChapter(blocks);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    for (const seg of segments) {
      const wordCount = seg.text.trim().split(/\s+/).filter(Boolean).length;
      expect(wordCount).toBeLessThanOrEqual(SEGMENT.HARD_MAX_WORDS + 10);
    }
  });

  it("groups short dialogue with attribution", () => {
    const blocks: BookBlock[] = [
      { type: "dialogue", text: '"Are you ready?" she asked softly.' },
      { type: "narration", text: "Marcus nodded without saying another word." },
    ];

    const segments = segmentChapter(blocks);
    expect(segments.length).toBe(1);
    expect(segments[0].text).toContain('"Are you ready?" she asked softly.');
    expect(segments[0].text).toContain("Marcus nodded");
  });
});
