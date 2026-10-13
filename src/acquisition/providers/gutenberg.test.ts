import { describe, expect, it, mock } from "bun:test";
import type { BookResult } from "../types";
import { GutenbergProvider } from "./gutenberg";
import { mockFetchFollowingRedirects, redirectResponse } from "./testSupport";

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

  const downloadUrl = "https://www.gutenberg.org/ebooks/1342.epub.images";
  const prideAndPrejudice: BookResult = {
    id: "1342",
    provider: "gutenberg",
    title: "Pride and Prejudice",
    authors: [],
    format: "epub",
    mirrors: [{ id: "1342", label: "Project Gutenberg", kind: "direct", url: downloadUrl }],
  };

  it("follows Gutenberg's redirect to its own EPUB cache", async () => {
    const originalFetch = globalThis.fetch;
    const cacheUrl = "https://www.gutenberg.org/cache/epub/1342/pg1342-images.epub";
    const epub = Buffer.from("PK\x03\x04pride-and-prejudice");
    mockFetchFollowingRedirects((url) => (url === downloadUrl ? redirectResponse(cacheUrl) : new Response(new Uint8Array(epub))));
    try {
      const acquired = await new GutenbergProvider().acquire(prideAndPrejudice);
      expect(Buffer.from(await new Response(acquired.stream).arrayBuffer())).toEqual(epub);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses to follow a search or download redirect off the Gutenberg hosts", async () => {
    const originalFetch = globalThis.fetch;
    const metadataUrl = "http://169.254.169.254/latest/meta-data/";
    const requested = mockFetchFollowingRedirects((url) => (url === metadataUrl ? new Response("{}") : redirectResponse(metadataUrl)));
    try {
      const provider = new GutenbergProvider();
      await expect(provider.search({ title: "Pride and Prejudice" })).rejects.toThrow(
        "Gutendex search redirected to an untrusted destination",
      );
      await expect(provider.acquire(prideAndPrejudice)).rejects.toThrow("gutenberg download redirected to an untrusted destination");
      expect(requested).not.toContain(metadataUrl);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
