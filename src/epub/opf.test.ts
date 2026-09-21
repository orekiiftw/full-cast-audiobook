import { describe, expect, it } from "bun:test";
import { parseEpub } from "./index";
import { createMockEpub } from "./testFixture";

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
