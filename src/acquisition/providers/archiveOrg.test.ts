import { describe, expect, it, mock } from "bun:test";
import { BookNotFoundError } from "../errors";
import { ArchiveOrgProvider } from "./archiveOrg";

describe("ArchiveOrgProvider", () => {
  it("rejects search when title and author are empty", async () => {
    const provider = new ArchiveOrgProvider();
    expect(provider.search({})).rejects.toThrow(BookNotFoundError);
  });

  it("parses search results correctly", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("advancedsearch.php")) {
        return new Response(
          JSON.stringify({
            response: {
              docs: [
                {
                  identifier: "test-book-id",
                  title: "Test Book",
                  creator: "Test Author",
                  year: 2020,
                  language: "eng",
                },
              ],
            },
          }),
        );
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const provider = new ArchiveOrgProvider();
      const results = await provider.search({ title: "Test Book", author: "Test Author" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("test-book-id");
      expect(results[0].provider).toBe("archive-org");
      expect(results[0].title).toBe("Test Book");
      expect(results[0].authors).toEqual(["Test Author"]);
      expect(results[0].year).toBe(2020);
      expect(results[0].format).toBe("epub");
      expect(results[0].mirrors[0].kind).toBe("direct");
      expect(results[0].mirrors[0].url).toBe("https://archive.org/download/test-book-id");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("getBook resolves the non-encrypted EPUB file", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/metadata/test-book-id")) {
        return new Response(
          JSON.stringify({
            metadata: {
              title: "Test Book",
              creator: "Test Author",
            },
            files: [
              { name: "test-book_lcp.epub", size: 1000 },
              { name: "test-book.epub", size: 2000 },
              { name: "test-book.pdf", size: 5000 },
            ],
          }),
        );
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const provider = new ArchiveOrgProvider();
      const details = await provider.getBook("test-book-id");
      expect(details.id).toBe("test-book-id");
      expect(details.mirrors[0].url).toBe("https://archive.org/download/test-book-id/test-book.epub");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("acquire streams buffer correctly", async () => {
    const originalFetch = globalThis.fetch;
    const fakeEpubBuffer = Buffer.from("PK\x03\x04test-epub-content");
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/metadata/test-book-id")) {
        return new Response(
          JSON.stringify({
            metadata: { title: "Test Book" },
            files: [{ name: "test-book.epub", size: fakeEpubBuffer.length }],
          }),
        );
      }
      if (urlStr.includes("/download/test-book-id/test-book.epub")) {
        return new Response(fakeEpubBuffer);
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const provider = new ArchiveOrgProvider();
      const acquired = await provider.acquire({
        id: "test-book-id",
        provider: "archive-org",
        title: "Test Book",
        authors: [],
        format: "epub",
        mirrors: [],
      });
      expect(acquired.filename).toBe("test-book-id.epub");
      expect(acquired.contentType).toBe("application/epub+zip");
      expect(acquired.contentLength).toBe(fakeEpubBuffer.length);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("acquire rejects untrusted / malicious domains", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          metadata: { title: "Fake Domain Book" },
          files: [{ name: "fake.epub", size: 100 }],
        }),
      );
    }) as unknown as typeof fetch;

    try {
      const provider = new ArchiveOrgProvider();
      const fakeBook = {
        id: "evil-item",
        provider: "archive-org",
        title: "Evil Book",
        authors: [],
        format: "epub" as const,
        mirrors: [],
      };
      provider.getBook = async () => ({
        ...fakeBook,
        formats: ["epub" as const],
        metadata: {},
        mirrors: [
          {
            id: "evil-item",
            label: "Evil Mirror",
            kind: "direct" as const,
            url: "https://evilarchive.org/download/evil-item/fake.epub",
          },
        ],
      });
      expect(provider.acquire(fakeBook)).rejects.toThrow("Invalid Archive.org download destination");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("acquire follows valid redirects to Archive.org CDN subdomains", async () => {
    const originalFetch = globalThis.fetch;
    const fakeEpubBuffer = Buffer.from("PK\x03\x04test-redirect-content");
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/metadata/test-redirect-id")) {
        return new Response(
          JSON.stringify({
            metadata: { title: "Redirect Book" },
            files: [{ name: "redirect.epub", size: fakeEpubBuffer.length }],
          }),
        );
      }
      if (urlStr === "https://archive.org/download/test-redirect-id/redirect.epub") {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://ia801234.us.archive.org/items/test-redirect-id/redirect.epub" },
        });
      }
      if (urlStr === "https://ia801234.us.archive.org/items/test-redirect-id/redirect.epub") {
        return new Response(fakeEpubBuffer, { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const provider = new ArchiveOrgProvider();
      const acquired = await provider.acquire({
        id: "test-redirect-id",
        provider: "archive-org",
        title: "Redirect Book",
        authors: [],
        format: "epub",
        mirrors: [],
      });
      expect(acquired.filename).toBe("test-redirect-id.epub");
      expect(acquired.contentLength).toBe(fakeEpubBuffer.length);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("acquire rejects redirects to untrusted destinations", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/metadata/test-bad-redirect")) {
        return new Response(
          JSON.stringify({
            metadata: { title: "Bad Redirect Book" },
            files: [{ name: "bad.epub", size: 100 }],
          }),
        );
      }
      if (urlStr === "https://archive.org/download/test-bad-redirect/bad.epub") {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://malicious-site.com/bad.epub" },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const provider = new ArchiveOrgProvider();
      expect(
        provider.acquire({
          id: "test-bad-redirect",
          provider: "archive-org",
          title: "Bad Redirect Book",
          authors: [],
          format: "epub",
          mirrors: [],
        }),
      ).rejects.toThrow("Archive.org redirected to an untrusted destination");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("excludes lending-restricted collections so results are anonymously downloadable", async () => {
    const originalFetch = globalThis.fetch;
    let seenUrl = "";
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      seenUrl = url.toString();
      return new Response(JSON.stringify({ response: { docs: [] } }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await new ArchiveOrgProvider().search({ title: "Godan", author: "Premchand" });
      const q = decodeURIComponent(seenUrl);
      expect(q).toContain("-collection:(inlibrary)");
      expect(q).toContain("-collection:(printdisabled)");
      expect(q).toContain("mediatype:(texts)");
      expect(q).toContain("format:(EPUB)");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to a title-only query when the title+author search is empty", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      urls.push(decodeURIComponent(url.toString()));
      if (urls.length === 1) return new Response(JSON.stringify({ response: { docs: [] } }), { status: 200 });
      return new Response(JSON.stringify({ response: { docs: [{ identifier: "godan-marathi", title: "Godan", language: "mar" }] } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    try {
      const results = await new ArchiveOrgProvider().search({ title: "Godan", author: "Some Transliteration" });
      expect(urls).toHaveLength(2);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("godan-marathi");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
