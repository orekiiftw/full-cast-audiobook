import { describe, expect, it } from "bun:test";
import { parseEpub } from "./index";
import { createMockEpub } from "./testFixture";

describe("spine reading", () => {
  it("parses an OCR-style paginated EPUB whose pages carry no chapter-start signal", () => {
    const parsed = parseEpub(createMockEpub({ paginatedPages: 12, title: "गोदान", author: "प्रेमचंद" }));
    expect(parsed.chapters.length).toBeGreaterThan(0);
    const words = parsed.chapters.reduce((acc, ch) => acc + ch.blocks.reduce((a, b) => a + b.text.split(/\s+/).length, 0), 0);
    expect(words).toBeGreaterThanOrEqual(500);
  });

  it("still prefers a real chapter-start page over held pre-narrative pages", () => {
    const parsed = parseEpub(createMockEpub({}));
    expect(parsed.chapters[0].title).toContain("Chapter 1");
  });
});
