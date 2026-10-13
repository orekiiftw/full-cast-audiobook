import { randomBytes } from "node:crypto";
import { describe, expect, it, mock } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { TORRENT } from "../../lib/constants";
import { fetchEpubFromArchiveOrg } from "./archiveOrg";
import { fetchEpubFromGutenberg } from "./gutenberg";

describe("fetchEpubFromArchiveOrg content verification", () => {
  it("skips an item whose OCR destroyed the script its metadata claims", async () => {
    const originalFetch = globalThis.fetch;
    const garbage = createFallbackTestEpub("garbage-item", "qa ed ak We a Wa ae a TT aan fe Cat Wat scat WR");
    const good = createFallbackTestEpub(
      "good-item",
      "होरी ने अपने झुर्रियों से भरे हुए माथे को सिकोड़ कर कहा कि अबेर हो गई है और उसे घर जाना चाहिए।",
    );

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("advancedsearch.php")) {
        return new Response(
          JSON.stringify({
            response: {
              docs: [
                { identifier: "garbage-item", title: "Godan", creator: "Premchand", language: "hin" },
                { identifier: "good-item", title: "Godan Other", creator: "Premchand", language: "hin" },
              ],
            },
          }),
        );
      }
      if (u.includes("/metadata/")) {
        const id = u.split("/metadata/")[1];
        return new Response(JSON.stringify({ metadata: { title: id, language: "hin" }, files: [{ name: `${id}.epub` }] }));
      }
      if (u.includes("/download/garbage-item/")) return new Response(new Uint8Array(garbage));
      if (u.includes("/download/good-item/")) return new Response(new Uint8Array(good));
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const acquired = await fetchEpubFromArchiveOrg("godan", "premchand", () => {});
      expect(acquired).not.toBeNull();
      expect(acquired!.filename).toBe("good-item.epub");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts a Latin-script item without a script check", async () => {
    const originalFetch = globalThis.fetch;
    const english = createFallbackTestEpub(
      "english-item",
      "The morning light filtered through the ancient forest onto the mossy path below.",
    );

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("advancedsearch.php")) {
        return new Response(
          JSON.stringify({
            response: { docs: [{ identifier: "english-item", title: "The Time Machine", creator: "Wells", language: "eng" }] },
          }),
        );
      }
      if (u.includes("/metadata/")) {
        return new Response(JSON.stringify({ metadata: { title: "t", language: "eng" }, files: [{ name: "english-item.epub" }] }));
      }
      if (u.includes("/download/english-item/")) return new Response(new Uint8Array(english));
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const acquired = await fetchEpubFromArchiveOrg("The Time Machine", "Wells", () => {});
      expect(acquired!.filename).toBe("english-item.epub");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("fallback acquisition size cap", () => {
  const downloadUrl = "https://www.gutenberg.org/ebooks/1.epub.images";

  function mockGutenbergDownload(download: () => Response): void {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.startsWith("https://gutendex.com/")) {
        return new Response(
          JSON.stringify({ results: [{ id: 1, title: "Oversized", languages: ["en"], formats: { "application/epub+zip": downloadUrl } }] }),
        );
      }
      if (u === downloadUrl) return download();
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;
  }

  it("rejects a download whose declared size exceeds the cap", async () => {
    const originalFetch = globalThis.fetch;
    const epub = createFallbackTestEpub("oversized", "The morning light filtered through the ancient forest onto the mossy path below.");
    mockGutenbergDownload(
      () => new Response(new Uint8Array(epub), { headers: { "content-length": String(TORRENT.MAX_FILE_SIZE_BYTES + 1) } }),
    );
    try {
      expect(await fetchEpubFromGutenberg("Oversized", undefined, () => {})).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stops reading a download that streams past the cap", async () => {
    const originalFetch = globalThis.fetch;
    const oversized = new Uint8Array(TORRENT.MAX_FILE_SIZE_BYTES + 1);
    oversized.set([0x50, 0x4b, 0x03, 0x04]);
    mockGutenbergDownload(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(oversized);
              controller.close();
            },
          }),
        ),
    );
    try {
      expect(await fetchEpubFromGutenberg("Oversized", undefined, () => {})).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

const CHAPTER_BODY_WORDS = 600;
const INCOMPRESSIBLE_PADDING_BYTES = 6000;

function createFallbackTestEpub(id: string, text: string): Buffer {
  const repetitions = Math.max(1, Math.ceil(CHAPTER_BODY_WORDS / text.split(/\s+/).length));
  const body = `<p>${(text + " ").repeat(repetitions).trim()}</p>`;
  const padding = new Uint8Array(randomBytes(INCOMPRESSIBLE_PADDING_BYTES));
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "OEBPS/padding.bin": padding,
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${id}</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>hi</dc:language>
  </metadata>
  <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`),
    "OEBPS/c1.xhtml": strToU8(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body>${body}</body></html>`),
  };
  return Buffer.from(zipSync(files));
}
