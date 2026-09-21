import { describe, expect, it } from "bun:test";
import { isFrontBackMatterPath, isFrontMatterBody, isTocEntryLine, looksLikeTableOfContents, stripLeadingTocBlocks } from "./filters";
import type { BookBlock } from "./blocks";

describe("isFrontBackMatterPath", () => {
  it("matches front and back matter by exact filename token", () => {
    expect(isFrontBackMatterPath("OEBPS/copyright.xhtml")).toBe(true);
    expect(isFrontBackMatterPath("OEBPS/acknowledgments.xhtml")).toBe(true);
  });

  it("keeps real chapters whose names merely contain a token as a substring", () => {
    expect(isFrontBackMatterPath("OEBPS/jack.xhtml")).toBe(false);
    expect(isFrontBackMatterPath("OEBPS/descent.xhtml")).toBe(false);
    expect(isFrontBackMatterPath("OEBPS/chapter1.xhtml")).toBe(false);
  });
});

describe("isTocEntryLine", () => {
  it("recognizes chapter, numbered, and dotted-leader entries", () => {
    expect(isTocEntryLine("Chapter 1")).toBe(true);
    expect(isTocEntryLine("Chapter I. The Beginning")).toBe(true);
    expect(isTocEntryLine("Part Two")).toBe(true);
    expect(isTocEntryLine("1. Arrival")).toBe(true);
    expect(isTocEntryLine("IV. The Storm")).toBe(true);
    expect(isTocEntryLine("Chapter XII")).toBe(true);
    expect(isTocEntryLine("The Beginning .......... 12")).toBe(true);
  });

  it("rejects prose and over-long lines", () => {
    expect(isTocEntryLine("A long paragraph of prose that continues for a while without listing anything at all.")).toBe(false);
    expect(isTocEntryLine("x".repeat(130))).toBe(false);
  });
});

describe("looksLikeTableOfContents", () => {
  it("flags a dense run of chapter headings", () => {
    const blocks: BookBlock[] = [
      { type: "heading", text: "Chapter 1" },
      { type: "narration", text: "Chapter 2" },
      { type: "narration", text: "Chapter 3" },
      { type: "narration", text: "Chapter 4" },
    ];
    expect(looksLikeTableOfContents(blocks, "")).toBe(true);
  });
});

describe("stripLeadingTocBlocks", () => {
  it("cuts the leading entry run and leaves the chapter text", () => {
    const blocks: BookBlock[] = [
      { type: "heading", text: "Contents" },
      { type: "narration", text: "Chapter One: Arrival" },
      { type: "narration", text: "Chapter Two: The Storm" },
      { type: "narration", text: "Chapter Three: Departure" },
      { type: "narration", text: "Chapter Four: Return" },
      { type: "narration", text: "Real prose begins here with a long sentence that has many words in it." },
    ];
    expect(stripLeadingTocBlocks(blocks).map((block) => block.text)).toEqual([
      "Real prose begins here with a long sentence that has many words in it.",
    ]);
  });
});

describe("isFrontMatterBody", () => {
  it("treats a front-matter heading as front matter", () => {
    const blocks: BookBlock[] = [
      { type: "heading", text: "Chapter 1" },
      { type: "narration", text: "Chapter 2" },
      { type: "narration", text: "Chapter 3" },
    ];
    expect(isFrontMatterBody(blocks, "Synopsis")).toBe(true);
  });

  it("treats a page of short blocks as front matter", () => {
    const blocks: BookBlock[] = [
      { type: "narration", text: "one two three" },
      { type: "narration", text: "four five six" },
      { type: "narration", text: "seven eight nine" },
    ];
    expect(isFrontMatterBody(blocks, "")).toBe(true);
  });

  it("treats a page of quoted pieces as front matter", () => {
    const blocks: BookBlock[] = [
      { type: "poem", text: "A poem line with sixteen words that stays under the long prose threshold" },
      { type: "poem", text: "Another poem line with sixteen words that stays under the long prose threshold" },
      { type: "letter", text: "A letter line with sixteen words that stays under the long prose threshold" },
    ];
    expect(isFrontMatterBody(blocks, "")).toBe(true);
  });
});
