import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createMockEpub } from "../epub/testFixture";
import type { TorrentCandidate } from "./types";

// A CDN download is only reachable in this sandbox with DNS stubbed out; every other step of a candidate attempt
// (TorBox cache check, add, poll, file selection, request-link, download, verification) runs for real.
mock.module("./safety", () => ({
  assertSafeDownloadUrlDns: async (url: string) => url,
  isIpfsCid: () => false,
}));

const { downloadBookFromCandidates } = await import("./index");

const CDN_HOST = "https://weur.tb-cdn.io";
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.TORBOX_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.TORBOX_API_KEY;
});

function candidate(index: number): TorrentCandidate {
  const hash = String(index).repeat(40);
  return {
    magnet: `magnet:?xt=urn:btih:${hash}`,
    hash,
    name: `edition ${index}`,
    size: 2_000_000,
    seeds: 8,
    source: "apibay",
    cached: true,
    alive: null,
  };
}

// Serves the Nth attempted torrent from servedFiles[N-1], so a test can make the first candidate send junk.
function mockTorBox(servedFiles: Array<() => Response>): { downloads: string[] } {
  const downloads: string[] = [];
  let adds = 0;

  globalThis.fetch = mock(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("/torrents/checkcached")) return Response.json({ success: true, data: {} });
    if (url.includes("/torrents/createtorrent")) {
      adds++;
      return Response.json({ success: true, data: { torrent_id: adds } });
    }
    if (url.includes("/torrents/mylist")) {
      const torrentId = Number(new URL(url).searchParams.get("id"));
      return Response.json({
        success: true,
        data: { download_state: "cached", files: [{ id: torrentId, name: "book.epub", size: 2_000 }] },
      });
    }
    if (url.includes("/torrents/requestdl")) {
      const fileId = Number(new URL(url).searchParams.get("file_id"));
      return Response.json({ success: true, data: `${CDN_HOST}/file-${fileId}.epub` });
    }
    if (url.startsWith(CDN_HOST)) {
      downloads.push(url);
      const serve = servedFiles[downloads.length - 1];
      if (!serve) throw new Error(`Unexpected fetch in test: ${url}`);
      return serve();
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as unknown as typeof fetch;

  return { downloads };
}

const epubBytes = () => new Response(new Uint8Array(createMockEpub({})));

const webPage = () => new Response("<!DOCTYPE html><html><body>503 Service Unavailable</body></html>");

describe("downloadBookFromCandidates EPUB verification", () => {
  test("rejects a candidate that downloads a web page and returns the next edition's EPUB", async () => {
    const { downloads } = mockTorBox([webPage, epubBytes]);

    const result = await downloadBookFromCandidates([candidate(1), candidate(2)]);

    expect(downloads).toHaveLength(2);
    expect(result.buffer.equals(createMockEpub({}))).toBe(true);
  });

  test("rejects a candidate whose EPUB has no reading order and tries the next edition", async () => {
    const emptySpine = () => new Response(new Uint8Array(createMockEpub({ emptySpine: true })));
    mockTorBox([emptySpine, epubBytes]);

    await expect(downloadBookFromCandidates([candidate(3), candidate(4)])).resolves.toBeDefined();
  });

  test("fails the book only after every candidate has been tried, naming each rejection", async () => {
    mockTorBox([webPage, webPage]);

    await expect(downloadBookFromCandidates([candidate(5), candidate(6)])).rejects.toThrow(
      /All 2 torrent candidate\(s\) failed to download: edition 5: .*not a readable EPUB \(the download was a web page[\s\S]*edition 6: .*not a readable EPUB/,
    );
  });
});
