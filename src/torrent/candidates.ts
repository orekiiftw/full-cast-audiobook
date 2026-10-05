import {
  API_TIMEOUT_MS,
  MAIN_API_URL,
  TORBOX_API_HOSTS,
  fetchApiWithValidatedRedirects,
  readJson,
  sanitizeLogText,
  torBoxApiKey,
} from "./client";
import { candidateHealth, candidateHealthRank, topEpubTorrents } from "./ranking";
import { buildTorrentSearchQueries, cleanHash, searchApibay, searchTorBox, searchTorrentsCsv, torBoxSearchDown } from "./search";
import type { TorrentCandidate, TorrentHit } from "./types";
import { errorMessage } from "../lib/errors";

const CANDIDATES_PER_PROVIDER = 3;

const ALIVE_PROBE_MAX = 5;

export async function resolveTorrentCandidates(title: string, author: string): Promise<TorrentCandidate[]> {
  const queries = buildTorrentSearchQueries(title, author);
  if (!queries.length) throw new Error("A book title is required for torrent search.");
  console.log(
    `🔍 Searching torrents using ${queries.length} query variant(s): ${queries.map((query) => JSON.stringify(query)).join(", ")}`,
  );

  const candidates = candidatesFromHits(await gatherAllHits(queries, title, author));
  if (!candidates.length) return [];

  await applyCacheState(candidates);
  await probeUncachedCandidates(candidates);

  candidates.sort((a, b) => candidateHealthRank(a) - candidateHealthRank(b) || b.seeds - a.seeds || a.name.localeCompare(b.name));

  console.log(`🏅 Ranked ${candidates.length} candidate(s): ${candidates.map(describeCandidate).join("; ")}`);
  return candidates;
}

export async function isTorrentCached(hash: string): Promise<boolean> {
  const clean = cleanHash(hash.replace("magnet:?xt=urn:btih:", "").split("&")[0]);
  return clean ? ((await batchCheckCached([clean])).get(clean) ?? false) : false;
}

async function gatherAllHits(queries: string[], title: string, author: string): Promise<TorrentHit[]> {
  const hits: TorrentHit[] = [];
  if (!torBoxSearchDown()) {
    hits.push(...(await gatherProviderHits("torbox", () => searchTorBox(queries[0]), title, author)));
  }
  hits.push(...(await gatherProviderHits("apibay", () => searchApibay(queries), title, author)));
  hits.push(...(await gatherProviderHits("torrents-csv", () => searchTorrentsCsv(queries), title, author)));
  return hits;
}

function candidatesFromHits(hits: TorrentHit[]): TorrentCandidate[] {
  const byHash = new Map<string, TorrentCandidate>();
  for (const hit of hits) {
    const hash = cleanHash(hit.hash);
    if (!hash || byHash.has(hash)) continue;
    byHash.set(hash, {
      magnet: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(hit.name)}`,
      hash,
      name: hit.name,
      size: hit.size,
      seeds: hit.seeds,
      source: hit.source,
      cached: null,
      alive: null,
    });
  }
  return [...byHash.values()];
}

async function applyCacheState(candidates: TorrentCandidate[]): Promise<void> {
  const cached = await batchCheckCached(candidates.map((candidate) => candidate.hash));
  for (const candidate of candidates) candidate.cached = cached.get(candidate.hash) ?? false;
}

async function probeUncachedCandidates(candidates: TorrentCandidate[]): Promise<void> {
  const uncached = candidates.filter((candidate) => !candidate.cached).sort((a, b) => b.seeds - a.seeds);
  await Promise.all(
    uncached.slice(0, ALIVE_PROBE_MAX).map(async (candidate) => {
      candidate.alive = await isTorrentAlive(candidate.hash);
    }),
  );
}

function describeCandidate(candidate: TorrentCandidate): string {
  const health = candidateHealth(candidate);
  return `[${candidate.source}${health ? `·${health}` : ""}] ${sanitizeLogText(candidate.name)}`;
}

async function gatherProviderHits(name: string, search: () => Promise<TorrentHit[]>, title: string, author: string): Promise<TorrentHit[]> {
  try {
    return topEpubTorrents(await search(), title, author, CANDIDATES_PER_PROVIDER);
  } catch (error) {
    console.warn(`⚠️ Search provider "${name}" failed: ${errorMessage(error)}`);
    return [];
  }
}

async function batchCheckCached(hashes: string[]): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  const apiKey = torBoxApiKey();
  if (!apiKey || !hashes.length) return result;
  try {
    const cleanHashes = hashes.map(cleanHash).filter(Boolean);
    const response = await fetchApiWithValidatedRedirects(
      `${MAIN_API_URL}/torrents/checkcached?hash=${cleanHashes.join(",")}&format=object`,
      TORBOX_API_HOSTS,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: API_TIMEOUT_MS,
      },
    );
    if (!response.ok) return result;
    const json = await readJson<{ success?: boolean; data?: Record<string, unknown> }>(response, "TorBox checkcached");
    if (!json.success || !json.data) return result;
    for (const hash of cleanHashes) result.set(hash, Boolean(json.data[hash]));
  } catch {}
  return result;
}

async function isTorrentAlive(hash: string): Promise<boolean | null> {
  const apiKey = torBoxApiKey();
  if (!apiKey) return null;
  try {
    const response = await fetchApiWithValidatedRedirects(
      `${MAIN_API_URL}/torrents/torrentinfo?hash=${cleanHash(hash)}&timeout=15&use_cache_lookup=true`,
      TORBOX_API_HOSTS,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: 20_000,
      },
    );
    if (!response.ok) return null;
    const json = await readJson<{ success?: boolean; data?: { name?: string } | null }>(response, "TorBox torrentinfo");
    if (json.success && json.data) return true;
    return json.success === false ? false : null;
  } catch {
    return null;
  }
}
