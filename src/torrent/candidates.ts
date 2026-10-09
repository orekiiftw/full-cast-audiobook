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

const ALIVE_PROBE_BUDGET_S = 5;

const ALIVE_PROBE_TIMEOUT_MS = (ALIVE_PROBE_BUDGET_S + 3) * 1000;

const ALIVE_PROBE_PAUSE_MS = 10 * 60_000;

let aliveProbePausedUntil = 0;

interface SearchProvider {
  name: string;
  search: () => Promise<TorrentHit[]>;
}

export function resetAliveProbeCircuit(): void {
  aliveProbePausedUntil = 0;
}

export async function resolveTorrentCandidates(
  title: string,
  author: string,
  onProgress?: (message: string) => void,
): Promise<TorrentCandidate[]> {
  const queries = buildTorrentSearchQueries(title, author);
  if (!queries.length) throw new Error("A book title is required for torrent search.");
  console.log(
    `🔍 Searching torrents using ${queries.length} query variant(s): ${queries.map((query) => JSON.stringify(query)).join(", ")}`,
  );

  const candidates = candidatesFromHits(await gatherAllHits(queries, title, author, onProgress));
  if (!candidates.length) return [];

  onProgress?.(`Checking TorBox cache for ${candidates.length} candidate(s)...`);
  await applyCacheState(candidates);
  await probeUncachedCandidates(candidates, onProgress);

  candidates.sort((a, b) => candidateHealthRank(a) - candidateHealthRank(b) || b.seeds - a.seeds || a.name.localeCompare(b.name));

  console.log(`🏅 Ranked ${candidates.length} candidate(s): ${candidates.map(describeCandidate).join("; ")}`);
  return candidates;
}

export async function isTorrentCached(hash: string): Promise<boolean> {
  const clean = cleanHash(hash.replace("magnet:?xt=urn:btih:", "").split("&")[0]);
  return clean ? ((await batchCheckCached([clean])).get(clean) ?? false) : false;
}

async function gatherAllHits(
  queries: string[],
  title: string,
  author: string,
  onProgress?: (message: string) => void,
): Promise<TorrentHit[]> {
  const providers: SearchProvider[] = [
    ...(torBoxSearchDown() ? [] : [{ name: "torbox", search: () => searchTorBox(queries[0]) }]),
    { name: "apibay", search: () => searchApibay(queries) },
    { name: "torrents-csv", search: () => searchTorrentsCsv(queries) },
  ];
  onProgress?.(`Searching ${providers.map((provider) => provider.name).join(", ")}...`);
  const hitsByProvider = await Promise.all(providers.map((provider) => gatherProviderHits(provider.name, provider.search, title, author)));
  return hitsByProvider.flat();
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

async function probeUncachedCandidates(candidates: TorrentCandidate[], onProgress?: (message: string) => void): Promise<void> {
  const apiKey = torBoxApiKey();
  if (!apiKey || Date.now() < aliveProbePausedUntil) return;
  const probed = candidates
    .filter((candidate) => !candidate.cached)
    .sort((a, b) => b.seeds - a.seeds)
    .slice(0, ALIVE_PROBE_MAX);
  if (probed.length) onProgress?.(`Checking ${probed.length} uncached candidate(s) for live seeders...`);
  await Promise.all(
    probed.map(async (candidate) => {
      candidate.alive = await isTorrentAlive(candidate.hash, apiKey);
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

async function isTorrentAlive(hash: string, apiKey: string): Promise<boolean | null> {
  try {
    const response = await fetchApiWithValidatedRedirects(
      `${MAIN_API_URL}/torrents/torrentinfo?hash=${cleanHash(hash)}&timeout=${ALIVE_PROBE_BUDGET_S}&use_cache_lookup=true`,
      TORBOX_API_HOSTS,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: ALIVE_PROBE_TIMEOUT_MS,
      },
    );
    if (!response.ok) {
      const failure = await readJson<{ error?: string }>(response, "TorBox torrentinfo").catch(() => ({ error: undefined }));
      if (failure.error !== "DOWNLOAD_SERVER_ERROR") pauseAliveProbe(`HTTP ${response.status}${failure.error ? ` ${failure.error}` : ""}`);
      return null;
    }
    const json = await readJson<{ success?: boolean; data?: { name?: string } | null }>(response, "TorBox torrentinfo");
    if (json.success && json.data) return true;
    return json.success === false ? false : null;
  } catch (error) {
    pauseAliveProbe(errorMessage(error));
    return null;
  }
}

function pauseAliveProbe(reason: string): void {
  if (Date.now() < aliveProbePausedUntil) return;
  aliveProbePausedUntil = Date.now() + ALIVE_PROBE_PAUSE_MS;
  console.warn(
    `⚠️ TorBox liveness probe paused for ${ALIVE_PROBE_PAUSE_MS / 60_000} min (${sanitizeLogText(reason)}); ranking uncached candidates by seeders.`,
  );
}
