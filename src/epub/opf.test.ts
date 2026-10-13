import { describe, expect, it } from "bun:test";
import { strToU8 } from "fflate";
import { parse } from "node-html-parser";
import { parseEpub } from "./index";
import { readBookMetadata, resolvePackagePath } from "./opf";
import { createMockEpub } from "./testFixture";

const LINEAR_SCAN_BUDGET_MS = 500;

describe("parseEpub metadata extraction", () => {
  it("reads dc:title / dc:creator", () => {
    const book = parseEpub(createMockEpub({ title: "Godan", author: "Premchand" }));
    expect(book.title).toBe("Godan");
    expect(book.author).toBe("Premchand");
  });

  it("reads EPUB2 <meta name=...> when no DC elements exist", () => {
    const book = parseEpub(createMockEpub({ title: "गोदान", author: "प्रेमचंद", metadataStyle: "meta-name" }));
    expect(book.title).toBe("गोदान");
    expect(book.author).toBe("प्रेमचंद");
  });

  it("reads a DC element under a non-dc namespace prefix", () => {
    const book = parseEpub(createMockEpub({ title: "Война и мир", author: "Толстой", metadataStyle: "prefixed" }));
    expect(book.title).toBe("Война и мир");
    expect(book.author).toBe("Толстой");
  });

  it("falls back to sentinels when the OPF carries no usable metadata", () => {
    const book = parseEpub(createMockEpub({ metadataStyle: "none" }));
    expect(book.title).toBe("Unknown Title");
    expect(book.author).toBe("Unknown Author");
  });
});

describe("package document scanning on hostile markup", () => {
  it("finds metadata past thousands of unterminated tags in linear time", () => {
    const content = `<package><metadata>${"<dc:title ".repeat(16_000)}${"<meta ".repeat(16_000)}<dc:creator>Premchand</dc:creator></metadata></package>`;
    const document = parse(content);

    const startedAt = performance.now();
    const metadata = readBookMetadata(content, document);
    expect(performance.now() - startedAt).toBeLessThan(LINEAR_SCAN_BUDGET_MS);
    expect(metadata).toEqual({ title: "Unknown Title", author: "Premchand" });
  });

  it("strips markup from a title full of unclosed angle brackets in linear time", () => {
    const brackets = "<".repeat(100_000);
    const content = `<package><metadata><dc:title>Godan ${brackets}</dc:title><dc:creator>Premchand</dc:creator></metadata></package>`;
    const document = parse(content);

    const startedAt = performance.now();
    const metadata = readBookMetadata(content, document);
    expect(performance.now() - startedAt).toBeLessThan(LINEAR_SCAN_BUDGET_MS);
    expect(metadata).toEqual({ title: `Godan ${brackets}`, author: "Premchand" });
  });

  it("rejects a container.xml full of unterminated rootfile tags in linear time", () => {
    const entries = { "META-INF/container.xml": strToU8(`<container><rootfiles>${"<rootfile ".repeat(40_000)}`) };

    const startedAt = performance.now();
    expect(() => resolvePackagePath(entries)).toThrow("Cannot find rootfile path");
    expect(performance.now() - startedAt).toBeLessThan(LINEAR_SCAN_BUDGET_MS);
  });
});
