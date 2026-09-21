import { describe, expect, it, mock } from "bun:test";
import { GutenbergProvider } from "./gutenberg";

describe("GutenbergProvider", () => {
  const gutendexBody = {
    results: [
      {
        id: 1342,
        title: "Pride and Prejudice",
        authors: [{ name: "Austen, Jane" }],
        languages: ["en"],
        download_count: 70000,
        formats: { "application/epub+zip": "https://www.gutenberg.org/ebooks/1342.epub.images" },
      },
      { id: 99, title: "No EPub Here", formats: { "text/plain": "https://example.com/x.txt" } },
    ],
  };

  it("keeps only entries that expose a direct EPUB", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response(JSON.stringify(gutendexBody), { status: 200 })) as unknown as typeof fetch;
    try {
      const results = await new GutenbergProvider().search({ title: "Pride and Prejudice" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("1342");
      expect(results[0].format).toBe("epub");
      expect(results[0].authors).toEqual(["Austen, Jane"]);
      expect(results[0].mirrors[0].url).toContain("gutenberg.org");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses to download from a non-Gutenberg host", async () => {
    const provider = new GutenbergProvider();
    await expect(
      provider.acquire({
        id: "1",
        provider: "gutenberg",
        title: "x",
        authors: [],
        format: "epub",
        mirrors: [{ id: "1", label: "evil", kind: "direct", url: "https://evil.example.com/x.epub" }],
      }),
    ).rejects.toThrow("Invalid download destination");
  });
});
