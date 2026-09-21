import { describe, expect, it } from "bun:test";
import { parseEpub } from "./index";
import { createMockEpub } from "./testFixture";

describe("parseEpub", () => {
  it("rejects non-ZIP buffers", () => {
    const invalidBuffer = Buffer.from("this is definitely not a zip file");
    expect(() => parseEpub(invalidBuffer)).toThrow("not a valid ZIP archive");
  });

  it("rejects EPUB with missing container.xml", () => {
    const epubWithoutContainer = createMockEpub({ includeInvalidContainer: true });
    expect(() => parseEpub(epubWithoutContainer)).toThrow("Missing META-INF/container.xml");
  });

  it("rejects EPUB with empty spine", () => {
    const epubWithEmptySpine = createMockEpub({ emptySpine: true });
    expect(() => parseEpub(epubWithEmptySpine)).toThrow("Spine is empty");
  });

  it("parses valid EPUB metadata, chapters, and content blocks correctly", () => {
    const validEpub = createMockEpub({
      title: "The Silver Citadel",
      author: "Gwenevere Vance",
    });

    const parsed = parseEpub(validEpub);
    expect(parsed.title).toBe("The Silver Citadel");
    expect(parsed.author).toBe("Gwenevere Vance");
    expect(parsed.chapters.length).toBe(2);

    expect(parsed.chapters[0].chapterIndex).toBe(1);
    expect(parsed.chapters[0].title).toBe("Chapter 1: The Departure");
    expect(parsed.chapters[0].blocks.length).toBeGreaterThan(0);

    expect(parsed.chapters[1].chapterIndex).toBe(2);
    expect(parsed.chapters[1].title).toBe("Chapter 2: The Whispering Woods");
  });

  it("rejects EPUB with too few words under MIN_BOOK_WORDS threshold", () => {
    const shortEpub = createMockEpub({
      chapter1Content: "<h1>Chapter 1</h1><p>Too short.</p>",
      chapter2Content: "<h1>Chapter 2</h1><p>Also way too short.</p>",
    });

    expect(() => parseEpub(shortEpub)).toThrow("The book content is too short");
  });
});
