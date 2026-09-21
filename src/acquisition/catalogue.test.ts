import { afterEach, expect, mock, test } from "bun:test";
import { searchCatalogueTorrentCandidates } from "./catalogue";

const originalFetch = globalThis.fetch;
const CATALOGUE_BASE_URL_KEY = "CATALOGUE_BASE_URL";
const CATALOGUE_TOKEN_KEY = "CATALOGUE_TOKEN";
const originalBase = process.env[CATALOGUE_BASE_URL_KEY];
const originalToken = process.env[CATALOGUE_TOKEN_KEY];

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBase === undefined) delete process.env[CATALOGUE_BASE_URL_KEY];
  else process.env[CATALOGUE_BASE_URL_KEY] = originalBase;
  if (originalToken === undefined) delete process.env[CATALOGUE_TOKEN_KEY];
  else process.env[CATALOGUE_TOKEN_KEY] = originalToken;
});

function useLocalCatalogue(): void {
  process.env[CATALOGUE_BASE_URL_KEY] = "http://catalogue.local";
  process.env[CATALOGUE_TOKEN_KEY] = "tk";
}

function mockCatalogueFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    handler(String(input), init),
  ) as unknown as typeof fetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function hit(
  over: Partial<{ md5: string; title: string; authors: string; infohash: string | null; filesize: number; magnet: string | null }>,
) {
  return {
    md5: "a".repeat(32),
    title: "Lord of the Mysteries",
    authors: "Cuttlefish That Loves Diving",
    language: "english",
    filesize: 1_500_000,
    infohash: "b".repeat(40),
    magnet: `magnet:?xt=urn:btih:${"b".repeat(40)}&dn=book`,
    torrent_paths: ["annas_archive_data__aacid__zlib3_files__x"],
    ...over,
  };
}

test("fails closed ([]) when catalogue env vars are unset", async () => {
  delete process.env[CATALOGUE_BASE_URL_KEY];
  delete process.env[CATALOGUE_TOKEN_KEY];
  await expect(searchCatalogueTorrentCandidates("Lord of the Mysteries", "Yuan Ye")).resolves.toEqual([]);
});

test("fails closed ([]) when the catalogue is unreachable", async () => {
  process.env[CATALOGUE_BASE_URL_KEY] = "http://127.0.0.1:1";
  process.env[CATALOGUE_TOKEN_KEY] = "tk";
  mockCatalogueFetch(async () => {
    throw new Error("connect refused");
  });
  await expect(searchCatalogueTorrentCandidates("Lord of the Mysteries", "Yuan Ye")).resolves.toEqual([]);
});

test("maps catalogue hits into torrent candidates with md5 + infohash", async () => {
  useLocalCatalogue();
  let seenAuth = "";
  mockCatalogueFetch(async (url, init) => {
    try {
      seenAuth = new Headers(init?.headers).get("authorization") ?? "";
    } catch {
      seenAuth = "";
    }
    expect(url).toContain("/search");
    expect(url).toContain("q=Lord+of+the+Mysteries");
    expect(url).toContain("author=Yuan+Ye");
    return jsonResponse({ count: 1, results: [hit({})] });
  });

  const candidates = await searchCatalogueTorrentCandidates("Lord of the Mysteries", "Yuan Ye");
  expect(seenAuth).toBe("Bearer tk");
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({
    source: "catalogue",
    md5: "a".repeat(32),
    hash: "b".repeat(40),
    size: 1_500_000,
  });
  expect(candidates[0].magnet).toContain("urn:btih:" + "b".repeat(40));
});

test("drops hits without a resolvable infohash and dedupes by hash", async () => {
  useLocalCatalogue();
  mockCatalogueFetch(async () =>
    jsonResponse({
      count: 3,
      results: [hit({ md5: "a".repeat(32), infohash: null, magnet: null }), hit({ md5: "b".repeat(32) }), hit({ md5: "c".repeat(32) })],
    }),
  );

  const candidates = await searchCatalogueTorrentCandidates("X");
  expect(candidates).toHaveLength(1);
  expect(candidates[0].md5).toBe("b".repeat(32));
});

test("falls back to a title-only query when the author filter matches nothing (pen-name case)", async () => {
  useLocalCatalogue();
  const calls: string[] = [];
  mockCatalogueFetch(async (url) => {
    calls.push(url);
    if (url.includes("author=")) return jsonResponse({ count: 0, results: [] });
    return jsonResponse({
      count: 2,
      results: [
        hit({ md5: "b".repeat(32), authors: "Cuttlefish That Loves Diving" }),
        hit({ md5: "c".repeat(32), title: "Lord of the Mysteries Vol 2", authors: "Someone Else" }),
      ],
    });
  });

  const candidates = await searchCatalogueTorrentCandidates("Lord of the Mysteries", "Yuan Ye");
  expect(calls.length).toBe(2);
  expect(calls[0]).toContain("author=Yuan+Ye");
  expect(calls[1]).not.toContain("author=");
  expect(candidates.length).toBeGreaterThan(0);
  expect(candidates[0].md5).toBe("b".repeat(32));
});
