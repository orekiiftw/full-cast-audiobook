import { TORRENT } from "../lib/constants";
import type { TorrentCandidate, TorrentHit } from "./types";

export function topEpubTorrents(hits: TorrentHit[], title: string, author: string, limit: number): TorrentHit[] {
  return scoreEpubTorrents(hits, title, author)
    .filter(({ hit, score, matchesQuery }) => /\bepub\b|\.epub\b/i.test(hit.name) && matchesQuery && score > 0)
    .sort((a, b) => b.score - a.score || b.hit.seeds - a.hit.seeds)
    .slice(0, limit)
    .map(({ hit }) => hit);
}

export function candidateHealth(candidate: TorrentCandidate): "cached" | "cold" | null {
  if (candidate.cached) return "cached";
  if (candidate.alive === false) return "cold";
  return null;
}

export function candidateHealthRank(candidate: TorrentCandidate): number {
  if (candidate.cached) return 0;
  if (candidate.alive === true) return 1;
  if (candidate.alive === null) return 2;
  return 3;
}

export function isColdCandidate(candidate: TorrentCandidate): boolean {
  return candidate.cached === false && candidate.alive === false;
}

interface ScoredHit {
  hit: TorrentHit;
  score: number;
  matchesQuery: boolean;
}

function scoreEpubTorrents(hits: TorrentHit[], title: string, author: string): ScoredHit[] {
  const titleTokens = tokenize(title);
  const authorTokens = tokenize(author);
  return hits
    .filter((hit) => hit.hash.length >= 32 && (hit.size <= 0 || hit.size <= TORRENT.MAX_FILE_SIZE_BYTES))
    .map((hit) => {
      const name = hit.name.toLowerCase();
      const nameTokens = tokenize(hit.name);
      const matchesQuery =
        titleTokens.length > 0
          ? titleTokens.every((token) => nameTokens.includes(token))
          : authorTokens.some((token) => nameTokens.includes(token));
      let score = 0;
      if (/\.epub\b|\bepub\b/i.test(name)) score += 50;
      if (/\.pdf\b/i.test(name)) score -= 20;
      if (/\.mobi\b|\.azw/i.test(name)) score -= 5;
      if (/\baudiobook\b|\bmp3\b|\bm4b\b/i.test(name)) score -= 40;
      for (const token of titleTokens) if (name.includes(token)) score += 8;
      for (const token of authorTokens) if (name.includes(token)) score += 4;
      score += Math.min(hit.seeds, 50);
      if (hit.size > 0 && hit.size < 20 * 1024 * 1024) score += 10;
      if (hit.size > 50 * 1024 * 1024) score -= 10;
      return { hit, score, matchesQuery };
    });
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 || /[^\x00-\x7f]/.test(word))
    .filter((word) => !["the", "and", "for"].includes(word));
}
