import { env } from "../lib/env";
import { fetchWithRedirectGuard, redirectFailureMessage, type RedirectGuard } from "../lib/redirectGuard";
import { readStreamWithCap } from "../lib/readStream";
import type { TorrentCandidate } from "../torrent";

const CATALOGUE_TIMEOUT_MS = 12_000;
const CATALOGUE_JSON_CAP = 8 * 1024 * 1024;

interface CatalogueHit {
  md5: string;
  title: string;
  authors?: string | null;
  language?: string | null;
  filesize?: number | null;
  infohash?: string | null;
  magnet?: string | null;
  torrent_paths?: string[];
  ipfs_cid?: string | null;
}

export async function searchCatalogueTorrentCandidates(title: string, author?: string, limit = 10): Promise<TorrentCandidate[]> {
  const withAuthor = author ? await searchCatalogue(title, author, limit) : [];
  if (withAuthor.length) return mapCandidates(withAuthor);

  const titleOnly = await searchCatalogue(title, undefined, limit);
  if (!titleOnly.length || !author) return mapCandidates(titleOnly);
  return mapCandidates([...titleOnly].sort(byAuthorOverlap(author)));
}

function byAuthorOverlap(author: string): (a: CatalogueHit, b: CatalogueHit) => number {
  const authorTokens = new Set(
    author
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
  const score = (hit: CatalogueHit) =>
    (hit.authors ?? "")
      .toLowerCase()
      .split(/\s+/)
      .reduce((count, word) => count + (authorTokens.has(word) ? 1 : 0), 0);
  return (a, b) => score(b) - score(a);
}

async function searchCatalogue(title: string, author: string | undefined, limit: number): Promise<CatalogueHit[]> {
  const base = env("CATALOGUE_BASE_URL");
  const token = env("CATALOGUE_TOKEN");
  if (!base || !token) return [];
  try {
    const response = await fetchCatalogue(catalogueSearchUrl(base, title, author, limit), token);
    if (!response.ok) return [];
    if (!response.body) return [];
    const buffer = await readStreamWithCap(
      response.body,
      CATALOGUE_JSON_CAP,
      () => new Error("Catalogue search response exceeded the size limit."),
    );
    const body = JSON.parse(buffer.toString("utf-8")) as { results?: CatalogueHit[] };
    return body.results ?? [];
  } catch {
    return [];
  }
}

function catalogueSearchUrl(base: string, title: string, author: string | undefined, limit: number): string {
  const url = new URL("search", base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("q", title);
  url.searchParams.set("limit", String(limit));
  if (author) url.searchParams.set("author", author);
  return url.toString();
}

async function fetchCatalogue(url: string, token: string): Promise<Response> {
  return fetchWithRedirectGuard({
    url,
    timeoutMs: CATALOGUE_TIMEOUT_MS,
    guard: catalogueRedirectGuard,
    headers: { Authorization: `Bearer ${token}` },
  });
}

const catalogueRedirectGuard: RedirectGuard = {
  approve: (target, { initialUrl }) => {
    if (target.hostname !== initialUrl.hostname) {
      throw new Error(`Catalogue redirect to unapproved host: ${target.hostname}`);
    }
    if (target.protocol !== "https:" && target.protocol !== initialUrl.protocol) {
      throw new Error(`Catalogue redirect to insecure protocol: ${target.protocol}`);
    }
    return target;
  },
  fail: (failure) => new Error(redirectFailureMessage("Catalogue", failure)),
};

function mapCandidates(hits: CatalogueHit[]): TorrentCandidate[] {
  const candidates: TorrentCandidate[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const hash = hit.infohash?.toLowerCase() ?? "";
    if (!hash || !hit.md5) continue;
    if (seen.has(hash)) continue;
    seen.add(hash);
    candidates.push({
      magnet: hit.magnet ?? `magnet:?xt=urn:btih:${hash}&dn=book`,
      hash,
      name: hit.title || "Unknown",
      size: hit.filesize ?? 0,
      seeds: 0,
      source: "catalogue",
      cached: null,
      alive: null,
      md5: hit.md5,
      ipfs_cid: hit.ipfs_cid ?? undefined,
    });
  }
  return candidates;
}
