import { afterEach, expect, mock, test } from "bun:test";
import { assertSafeDownloadUrl, buildTorrentSearchQueries, searchBookTorrent } from "./torboxService";

test("buildTorrentSearchQueries normalizes initials and adds surname fallback", () => {
  expect(buildTorrentSearchQueries("Harry Potter and the Philosopher's Stone", "J.K. Rowling")).toEqual([
    "Harry Potter and the Philosopher s Stone J K Rowling epub",
    "Harry Potter and the Philosopher s Stone Rowling epub",
    "Harry Potter and the Philosopher s Stone epub",
    "Harry Potter Philosopher Stone Rowling epub",
    "Harry Potter epub",
  ]);
});

test("buildTorrentSearchQueries removes duplicate variants for a minimal query", () => {
  expect(buildTorrentSearchQueries("Dune", "Herbert")).toEqual([
    "Dune Herbert epub",
    "Dune epub",
  ]);
});

test("assertSafeDownloadUrl accepts current TorBox CDN hosts", () => {
  // Live requestdl responses observed from the TorBox API.
  expect(assertSafeDownloadUrl("https://nexus-008.indi.tb-cdn.pw/dld/a8624295-2293-44b7-9711-ae0271b25b7a?token=x"))
    .toBe("https://nexus-008.indi.tb-cdn.pw/dld/a8624295-2293-44b7-9711-ae0271b25b7a?token=x");
  expect(assertSafeDownloadUrl("https://cdn.torbox.app/dld/file")).toContain("cdn.torbox.app");
  expect(assertSafeDownloadUrl("https://tb-cdn.pw/dld/file")).toContain("tb-cdn.pw");
});

test("assertSafeDownloadUrl rejects non-HTTPS, spoofed, and private hosts", () => {
  expect(() => assertSafeDownloadUrl("http://nexus-008.indi.tb-cdn.pw/dld/x")).toThrow("non-HTTPS");
  expect(() => assertSafeDownloadUrl("https://tb-cdn.pw.evil.com/dld/x")).toThrow("unexpected host");
  expect(() => assertSafeDownloadUrl("https://evil.com/?x=tb-cdn.pw")).toThrow("unexpected host");
  expect(() => assertSafeDownloadUrl("not a url")).toThrow("invalid download URL");
  // Private/loopback hosts are not on the TorBox allowlist, so they are
  // rejected at the host check before the private-address guard is reached.
  expect(() => assertSafeDownloadUrl("https://localhost/dld/x")).toThrow("unexpected host");
  expect(() => assertSafeDownloadUrl("https://192.168.1.1/dld/x")).toThrow("unexpected host");
});

// ---------------------------------------------------------------------------
// searchBookTorrent provider-fallback latency
//
// TorBox search is the FIRST provider in the chain. Its transient-failure
// handling used to sleep 4s + 8s before the fallback indexers (apibay,
// torrents-csv) were even tried — a ~12s stall between "Add book" and any
// visible pipeline activity. These tests pin the fast-fail contract:
// fallbacks must engage after the fewest possible TorBox calls.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
const originalTorboxKey = process.env.TORBOX_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalTorboxKey === undefined) delete process.env.TORBOX_API_KEY;
  else process.env.TORBOX_API_KEY = originalTorboxKey;
});

/** A valid apibay hit for "The Time Machine" — passes pickBestEpubTorrent. */
const APIBAY_HIT = {
  id: "42",
  name: "The Time Machine - H.G. Wells epub",
  info_hash: "a".repeat(40),
  size: "2000000",
  seeders: "12",
};

/**
 * Stubs the network: TorBox search responses come from `torboxHandler`,
 * apibay always returns APIBAY_HIT, anything else throws. Returns a counter
 * for how many times the TorBox search endpoint was called.
 */
function mockSearchFetch(torboxHandler: () => Promise<Response>): () => number {
  let torboxCalls = 0;
  globalThis.fetch = mock(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.startsWith("https://search-api.torbox.app/")) {
      torboxCalls++;
      return torboxHandler();
    }
    if (url.startsWith("https://apibay.org/")) {
      return new Response(JSON.stringify([APIBAY_HIT]), { status: 200 });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as unknown as typeof fetch;
  return () => torboxCalls;
}

test("searchBookTorrent falls back after a single TorBox call when TorBox is unreachable", async () => {
  process.env.TORBOX_API_KEY = "test-key";
  const torboxCalls = mockSearchFetch(async () => {
    throw new Error("Unable to connect. Is the computer able to access the url?");
  });

  const magnet = await searchBookTorrent("The Time Machine", "H. G. Wells");

  expect(torboxCalls()).toBe(1);
  expect(magnet).toBe(`magnet:?xt=urn:btih:${"a".repeat(40)}&dn=${encodeURIComponent(APIBAY_HIT.name)}`);
});

test("searchBookTorrent does not retry an empty TorBox result set", async () => {
  process.env.TORBOX_API_KEY = "test-key";
  const torboxCalls = mockSearchFetch(
    async () => new Response(JSON.stringify({ data: [] }), { status: 200 })
  );

  const magnet = await searchBookTorrent("The Time Machine", "H. G. Wells");

  expect(torboxCalls()).toBe(1);
  expect(magnet).toContain(`magnet:?xt=urn:btih:${"a".repeat(40)}`);
});

test("searchBookTorrent allows one bounded retry for TorBox rate limits", async () => {
  process.env.TORBOX_API_KEY = "test-key";
  const torboxCalls = mockSearchFetch(
    async () => new Response("slow down", { status: 429 })
  );

  const magnet = await searchBookTorrent("The Time Machine", "H. G. Wells");

  expect(torboxCalls()).toBe(2);
  expect(magnet).toContain(`magnet:?xt=urn:btih:${"a".repeat(40)}`);
});

test("searchBookTorrent does not retry when the TorBox search quota is zero", async () => {
  process.env.TORBOX_API_KEY = "test-key";
  const torboxCalls = mockSearchFetch(
    async () => new Response("rate limit exceeded: 0 per day", { status: 429 })
  );

  const magnet = await searchBookTorrent("The Time Machine", "H. G. Wells");

  expect(torboxCalls()).toBe(1);
  expect(magnet).toContain(`magnet:?xt=urn:btih:${"a".repeat(40)}`);
});

test("searchBookTorrent rejects a fallback hit that only shares a generic title word", async () => {
  process.env.TORBOX_API_KEY = "test-key";
  globalThis.fetch = mock(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.startsWith("https://search-api.torbox.app/")) {
      throw new Error("Unable to connect. Is the computer able to access the url?");
    }
    if (url.startsWith("https://apibay.org/")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.startsWith("https://torrents-csv.com/")) {
      return new Response(
        JSON.stringify({
          torrents: [
            {
              name: "Act Like a Lady, Think Like a Lord: A Mystery by Celeste Connally EPUB",
              infohash: "b".repeat(40),
              size_bytes: 4_000_000,
              seeders: 3,
            },
          ],
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as unknown as typeof fetch;

  await expect(searchBookTorrent("Lord of the Mysteries", "Yuan Ye")).rejects.toThrow(
    "Could not find torrent"
  );
});
