import { describe, expect, it } from "bun:test";
import { parseEpub } from "./index";
import { createMockEpub } from "./testFixture";

describe("chapter aggregation", () => {
  it("merges a page-based spine into chapter-sized units that break at sentence ends", () => {
    const parsed = parseEpub(createMockEpub({ paginatedPages: 60, title: "गोदान", author: "प्रेमचंद" }));
    expect(parsed.chapters.length).toBeLessThan(60 / 3);
    for (const chapter of parsed.chapters) {
      const tail = chapter.blocks[chapter.blocks.length - 1].text.trim();
      expect(/[.!?।॥…”"')]$/.test(tail)).toBe(true);
    }
    const words = parsed.chapters.reduce((acc, ch) => acc + ch.blocks.reduce((a, b) => a + b.text.split(/\s+/).length, 0), 0);
    expect(words).toBeGreaterThanOrEqual(4 * 1000);
  });
});
