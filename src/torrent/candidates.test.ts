import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetAliveProbeCircuit, resolveTorrentCandidates } from "./candidates";
import { resetTorBoxSearchCircuit } from "./search";
import { mockFetch, restoreFetchAndEnvironment } from "./testSupport";

beforeEach(() => {
  resetTorBoxSearchCircuit();
  resetAliveProbeCircuit();
});

afterEach(restoreFetchAndEnvironment);

describe("resolveTorrentCandidates seed-health ranking", () => {
  const hash = (character: string) => character.repeat(40);
  const apibayHit = (name: string, infoHash: string, seeders = "5") => ({
    id: name,
    name,
    info_hash: infoHash,
    size: "2000000",
    seeders,
  });

  function mockResolveFetch(options: {
    apibay?: unknown[];
    csv?: { torrents: unknown[] };
    cachedHashes?: string[];
    aliveHashes?: string[];
    torrentInfo?: () => Response;
  }) {
    const urls: string[] = [];
    mockFetch(async (url) => {
      urls.push(url);
      if (url.startsWith("https://search-api.torbox.app/")) {
        throw new Error("search-api unreachable (test)");
      }
      if (url.startsWith("https://apibay.org/")) {
        return new Response(JSON.stringify(options.apibay ?? []), { status: 200 });
      }
      if (url.startsWith("https://torrents-csv.com/")) {
        return new Response(JSON.stringify(options.csv ?? { torrents: [] }), { status: 200 });
      }
      if (url.includes("/torrents/checkcached")) {
        const data: Record<string, unknown> = {};
        for (const cachedHash of options.cachedHashes ?? []) data[cachedHash] = { hash: cachedHash, cached: true };
        return new Response(JSON.stringify({ success: true, data }), { status: 200 });
      }
      if (url.includes("/torrents/torrentinfo")) {
        if (options.torrentInfo) return options.torrentInfo();
        const infoHash = new URL(url).searchParams.get("hash") ?? "";
        const alive = (options.aliveHashes ?? []).includes(infoHash);
        return alive
          ? new Response(JSON.stringify({ success: true, data: { name: "x", hash: infoHash } }), { status: 200 })
          : new Response(JSON.stringify({ success: false, error: "DOWNLOAD_SERVER_ERROR", data: null }), { status: 200 });
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
    return () => urls;
  }

  test("ranks cached > alive > dead and dedupes by hash", async () => {
    process.env.TORBOX_API_KEY = "test-key";
    const [deadA, aliveB, cachedC] = [hash("a"), hash("b"), hash("c")];
    mockResolveFetch({
      apibay: [apibayHit("The Time Machine epub", aliveB, "8"), apibayHit("The Time Machine dead epub", deadA, "1")],
      csv: { torrents: [{ name: "The Time Machine epub cached", infohash: cachedC, size_bytes: 3_000_000, seeders: 3 }] },
      cachedHashes: [cachedC],
      aliveHashes: [aliveB],
    });
    const candidates = await resolveTorrentCandidates("The Time Machine", "H. G. Wells");
    expect(candidates.map((candidate) => candidate.hash)).toEqual([cachedC, aliveB, deadA]);
    expect(candidates[0].cached).toBe(true);
    expect(candidates[1].alive).toBe(true);
    expect(candidates[2].alive).toBe(false);
  });

  test("dedupes the same hash across indexers, keeping the first occurrence", async () => {
    process.env.TORBOX_API_KEY = "test-key";
    const dup = hash("d");
    mockResolveFetch({
      apibay: [apibayHit("The Time Machine epub dup", dup, "9")],
      csv: { torrents: [{ name: "The Time Machine EPUB dup again", infohash: dup, size_bytes: 2_000_000, seeders: 2 }] },
    });
    const candidates = await resolveTorrentCandidates("The Time Machine", "H. G. Wells");
    expect(candidates.filter((candidate) => candidate.hash === dup)).toHaveLength(1);
  });

  test("reports each search stage while it runs", async () => {
    process.env.TORBOX_API_KEY = "test-key";
    const [uncachedE, cachedF] = [hash("e"), hash("f")];
    mockResolveFetch({
      apibay: [apibayHit("The Time Machine epub", uncachedE, "4")],
      csv: { torrents: [{ name: "The Time Machine epub cached", infohash: cachedF, size_bytes: 3_000_000, seeders: 3 }] },
      cachedHashes: [cachedF],
    });
    const messages: string[] = [];
    await resolveTorrentCandidates("The Time Machine", "H. G. Wells", (message) => messages.push(message));
    expect(messages).toEqual([
      "Searching torbox, apibay, torrents-csv...",
      "Checking TorBox cache for 2 candidate(s)...",
      "Checking 1 uncached candidate(s) for live seeders...",
    ]);
  });

  test("queries the indexers concurrently instead of one after another", async () => {
    process.env.TORBOX_API_KEY = "test-key";
    const timeline: string[] = [];
    mockFetch(async (url) => {
      const host = new URL(url).hostname;
      timeline.push(`start ${host}`);
      await Bun.sleep(10);
      timeline.push(`end ${host}`);
      if (host === "apibay.org") return new Response("[]", { status: 200 });
      if (host === "torrents-csv.com") return new Response(JSON.stringify({ torrents: [] }), { status: 200 });
      throw new Error("search-api unreachable (test)");
    });
    await resolveTorrentCandidates("The Time Machine", "H. G. Wells");
    expect(timeline.indexOf("start torrents-csv.com")).toBeLessThan(timeline.indexOf("end apibay.org"));
  });

  test("stops probing liveness once the TorBox probe itself fails", async () => {
    process.env.TORBOX_API_KEY = "test-key";
    const urls = mockResolveFetch({
      apibay: [apibayHit("The Time Machine epub", hash("9"), "4")],
      torrentInfo: () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    });
    await resolveTorrentCandidates("The Time Machine", "H. G. Wells");
    const [candidate] = await resolveTorrentCandidates("The Time Machine", "H. G. Wells");
    expect(candidate.alive).toBeNull();
    expect(urls().filter((url) => url.includes("/torrents/torrentinfo"))).toHaveLength(1);
  });

  test("keeps probing when TorBox only ran out of time fetching one torrent's metadata", async () => {
    process.env.TORBOX_API_KEY = "test-key";
    const urls = mockResolveFetch({
      apibay: [apibayHit("The Time Machine epub", hash("8"), "4")],
      torrentInfo: () =>
        new Response(JSON.stringify({ success: false, error: "DOWNLOAD_SERVER_ERROR", data: null }), {
          status: 500,
        }),
    });
    await resolveTorrentCandidates("The Time Machine", "H. G. Wells");
    await resolveTorrentCandidates("The Time Machine", "H. G. Wells");
    expect(urls().filter((url) => url.includes("/torrents/torrentinfo"))).toHaveLength(2);
  });

  test("returns [] with no usable hits (no candidates to attempt)", async () => {
    process.env.TORBOX_API_KEY = "test-key";
    mockResolveFetch({});
    const candidates = await resolveTorrentCandidates("The Time Machine", "H. G. Wells");
    expect(candidates).toEqual([]);
  });
});
