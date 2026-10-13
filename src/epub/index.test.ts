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

  it("parses a Chinese EPUB whose prose has no spaces between words", () => {
    const paragraph =
      "清晨的薄雾笼罩着整个村庄，远处传来的钟声在山谷之间回荡，仿佛在提醒人们新的一天已经开始。老李坐在自家门前的石阶上，望着远方的群山发呆，心里一直在想着昨天夜里发生的那件怪事。";
    const chapterHtml = (heading: string) => `<h1>${heading}</h1>${`<p>${paragraph}</p>`.repeat(10)}`;

    const parsed = parseEpub(
      createMockEpub({ title: "村庄", author: "老李", chapter1Content: chapterHtml("第一章"), chapter2Content: chapterHtml("第二章") }),
    );
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual(["第一章", "第二章"]);
    expect(parsed.chapters[0].blocks.filter((block) => block.text === paragraph).length).toBe(10);
  });

  it("rejects EPUB with too few words under MIN_BOOK_WORDS threshold", () => {
    const shortEpub = createMockEpub({
      chapter1Content: "<h1>Chapter 1</h1><p>Too short.</p>",
      chapter2Content: "<h1>Chapter 2</h1><p>Also way too short.</p>",
    });

    expect(() => parseEpub(shortEpub)).toThrow("The book content is too short");
  });
});
