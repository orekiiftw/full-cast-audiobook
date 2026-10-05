import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { downloadBookFromCandidates, searchBookTorrent } from "./index";
import { resetTorBoxSearchCircuit } from "./search";
import { VALID_CID, ZIP_BUFFER, mockFetch, restoreFetchAndEnvironment, zipResponse } from "./testSupport";
import type { TorrentCandidate } from "./types";

const APIBAY_HIT = {
  id: "42",
  name: "The Time Machine - H.G. Wells epub",
  info_hash: "a".repeat(40),
  size: "2000000",
  seeders: "12",
};

beforeEach(() => resetTorBoxSearchCircuit());

afterEach(restoreFetchAndEnvironment);

function torrentCandidate(over: Partial<TorrentCandidate>): TorrentCandidate {
  return {
    magnet: `magnet:?xt=urn:btih:${"f".repeat(40)}`,
    hash: "f".repeat(40),
    name: "candidate",
    size: 1_000_000,
    seeds: 5,
    source: "apibay",
    cached: null,
    alive: null,
    ...over,
  };
}

function mockSearchFetch(torboxHandler: () => Promise<Response>): () => number {
  let torboxCalls = 0;
  mockFetch(async (url) => {
    if (url.startsWith("https://search-api.torbox.app/")) {
      torboxCalls++;
      return torboxHandler();
    }
    if (url.startsWith("https://apibay.org/")) {
      return new Response(JSON.stringify([APIBAY_HIT]), { status: 200 });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
  return () => torboxCalls;
}

const isIpfsGatewayRequest = (url: string) =>
  /^https:\/\/(ipfs\.io|dweb\.link|w3s\.link|nftstorage\.link)\//.test(url) || url.includes("/ipfs/");

function mockTorBoxDownloadFetch(options: { serveIpfs?: boolean } = {}): { requests: string[]; torrentAdds: string[] } {
  const requests: string[] = [];
  const torrentAdds: string[] = [];
  mockFetch(async (url) => {
    if (options.serveIpfs && isIpfsGatewayRequest(url)) return zipResponse();
    requests.push(url);
    if (url.includes("/torrents/checkcached")) return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    if (url.includes("/torrents/createtorrent")) {
      torrentAdds.push(url);
      return new Response(JSON.stringify({ success: true, data: { torrent_id: 1 } }), { status: 200 });
    }
    if (url.includes("/torrents/mylist")) {
      return new Response(JSON.stringify({ success: true, data: { download_state: "failed" } }), { status: 200 });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
  return { requests, torrentAdds };
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
  const torboxCalls = mockSearchFetch(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));

  const magnet = await searchBookTorrent("The Time Machine", "H. G. Wells");

  expect(torboxCalls()).toBe(1);
  expect(magnet).toContain(`magnet:?xt=urn:btih:${"a".repeat(40)}`);
});

test("searchBookTorrent allows one bounded retry for TorBox rate limits", async () => {
  process.env.TORBOX_API_KEY = "test-key";
  const torboxCalls = mockSearchFetch(async () => new Response("slow down", { status: 429 }));

  const magnet = await searchBookTorrent("The Time Machine", "H. G. Wells");

  expect(torboxCalls()).toBe(2);
  expect(magnet).toContain(`magnet:?xt=urn:btih:${"a".repeat(40)}`);
});

test("searchBookTorrent does not retry when the TorBox search quota is zero", async () => {
  process.env.TORBOX_API_KEY = "test-key";
  const torboxCalls = mockSearchFetch(async () => new Response("rate limit exceeded: 0 per day", { status: 429 }));

  const magnet = await searchBookTorrent("The Time Machine", "H. G. Wells");

  expect(torboxCalls()).toBe(1);
  expect(magnet).toContain(`magnet:?xt=urn:btih:${"a".repeat(40)}`);
});

test("searchBookTorrent rejects a fallback hit that only shares a generic title word", async () => {
  process.env.TORBOX_API_KEY = "test-key";
  mockFetch(async (url) => {
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
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });

  await expect(searchBookTorrent("Lord of the Mysteries", "Yuan Ye")).rejects.toThrow("Could not find torrent");
});

describe("downloadBookFromCandidates skip-cold fallback", () => {
  test("fails fast with no candidates", async () => {
    await expect(downloadBookFromCandidates([])).rejects.toThrow("No torrent candidates");
  });

  test("skips a cold edition when a healthier one is ahead (torrent never attempted)", async () => {
    process.env.TORBOX_API_KEY = "test-key";
    const { torrentAdds } = mockTorBoxDownloadFetch();
    const cold = torrentCandidate({ name: "cold edition", cached: false, alive: false });
    const healthy = torrentCandidate({
      name: "healthy edition",
      cached: false,
      alive: true,
      hash: "e".repeat(40),
      magnet: `magnet:?xt=urn:btih:${"e".repeat(40)}`,
    });

    await expect(downloadBookFromCandidates([cold, healthy])).rejects.toThrow("All 2 torrent candidate(s)");
    expect(torrentAdds).toHaveLength(1);
  });

  test("still attempts the best-ranked edition when every candidate is cold (last resort)", async () => {
    process.env.TORBOX_API_KEY = "test-key";
    const { torrentAdds } = mockTorBoxDownloadFetch();

    await expect(downloadBookFromCandidates([torrentCandidate({ name: "only cold", cached: false, alive: false })])).rejects.toThrow(
      "All 1 torrent candidate(s)",
    );
    expect(torrentAdds).toHaveLength(1);
  });
});

describe("downloadBookFromCandidates IPFS fallback", () => {
  test("serves a cold IPFS-carrying edition without touching TorBox", async () => {
    const { requests } = mockTorBoxDownloadFetch({ serveIpfs: true });
    const result = await downloadBookFromCandidates([
      torrentCandidate({ source: "catalogue", cached: false, alive: false, ipfs_cid: VALID_CID }),
    ]);
    expect(result.buffer).toEqual(ZIP_BUFFER);
    expect(requests).toEqual([]);
  });

  test("falls back to IPFS when a TorBox attempt on a healthy-looking edition fails", async () => {
    mockTorBoxDownloadFetch({ serveIpfs: true });
    const result = await downloadBookFromCandidates([
      torrentCandidate({ source: "catalogue", cached: false, alive: null, ipfs_cid: VALID_CID }),
    ]);
    expect(result.buffer).toEqual(ZIP_BUFFER);
  });
});
