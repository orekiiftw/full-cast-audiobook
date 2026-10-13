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

  it("reads chapters stored under Calibre's default index_split file names", () => {
    const parsed = parseEpub(createMockEpub({ chapterFileNames: ["index_split_000.html", "index_split_001.html"] }));
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1: The Departure", "Chapter 2: The Whispering Woods"]);
  });

  it("skips spine items that resolve to Object.prototype keys at the archive root instead of failing the book", () => {
    const parsed = parseEpub(createMockEpub({ missingSpineHrefs: ["../constructor", "../__proto__", "../toString"] }));
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1: The Departure", "Chapter 2: The Whispering Woods"]);
  });
});
