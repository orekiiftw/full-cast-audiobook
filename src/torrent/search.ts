import {
  API_TIMEOUT_MS,
  ERROR_TEXT_CAP,
  SEARCH_API_HOST,
  SEARCH_API_URL,
  errorMessage,
  fetchApiWithValidatedRedirects,
  readBodyText,
  readJson,
  torBoxApiKey,
} from "./client";
import type { TorrentHit } from "./types";

const MAX_SEARCH_ATTEMPTS = 2;
const SEARCH_RETRY_DELAY_MS = 750;

let torBoxSearchDownReason: string | null = null;

export function torBoxSearchDown(): string | null {
  return torBoxSearchDownReason;
}

export function resetTorBoxSearchCircuit(): void {
  torBoxSearchDownReason = null;
}

function markTorBoxSearchDown(reason: string): void {
  if (torBoxSearchDownReason) return;
  torBoxSearchDownReason = reason;
  console.warn(`⚠️ TorBox search disabled for this process (${reason}); using the fallback indexers.`);
}

export function buildTorrentSearchQueries(title: string, author: string): string[] {
  const clean = (value: string) =>
    value
      .normalize("NFKC")
      .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const cleanTitle = clean(title);
  const authorWords = clean(author).split(" ").filter(Boolean);
  const surname = authorWords.at(-1) ?? "";
  const keywords = cleanTitle.split(" ").filter((word) => word.length > 2 && !["the", "and", "for", "with"].includes(word.toLowerCase()));
  const variants = [
    `${cleanTitle} ${authorWords.join(" ")} epub`,
    `${cleanTitle} ${surname} epub`,
    `${cleanTitle} epub`,
    `${keywords.slice(0, 5).join(" ")} ${surname} epub`,
    `${keywords.slice(0, 2).join(" ")} epub`,
  ]
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter((query) => query !== "epub");
  return [...new Set(variants)].slice(0, 5);
}

export function cleanHash(hash: string): string {
  return hash
    .replace(/^urn:btih:/i, "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toLowerCase();
}

export function infohashFromMagnet(magnet: string): string {
  try {
    const url = new URL(magnet);
    const match = /urn:btih:([0-9a-fA-F]{40})/i.exec(url.searchParams.get("xt") ?? "");
    if (match) return match[1].toLowerCase();
  } catch {}
  const hex = magnet.match(/[0-9a-fA-F]{40}/)?.[0];
  return hex ? hex.toLowerCase() : cleanHash(magnet);
}

export async function searchTorBox(query: string): Promise<TorrentHit[]> {
  if (torBoxSearchDownReason) throw new Error(torBoxSearchDownReason);
  const apiKey = torBoxApiKey();
  if (!apiKey) throw new Error("TORBOX_API_KEY not set");
  let lastError: Error = new Error("TorBox search failed");
  for (let attempt = 1; attempt <= MAX_SEARCH_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetchApiWithValidatedRedirects(`${SEARCH_API_URL}/torrents/search/${encodeURIComponent(query)}`, [SEARCH_API_HOST], {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        timeoutMs: API_TIMEOUT_MS,
      });
    } catch (error) {
      const message = errorMessage(error);
      markTorBoxSearchDown(`unreachable (${message})`);
      throw error instanceof Error ? error : new Error(message);
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      const body = await readBodyText(response, ERROR_TEXT_CAP, "TorBox search").catch(() => "");
      markTorBoxSearchDown(`HTTP ${response.status}${body ? ` — ${body.slice(0, 120).trim()}` : ""}`);
      throw new Error(`TorBox search unavailable (HTTP ${response.status})`);
    }
    if (response.status === 429) {
      const body = await readBodyText(response, ERROR_TEXT_CAP, "TorBox search").catch(() => "");
      if (/0 per/i.test(body)) {
        markTorBoxSearchDown("search quota is 0 on this account");
        throw new Error("TorBox Search API quota is 0 on this account (use fallback indexers)");
      }
      lastError = new Error("Rate limited (429)");
    } else if (!response.ok) {
      lastError = new Error(`HTTP ${response.status}`);
    } else {
      const json = await readJson<{ data?: unknown; torrents?: unknown; error?: string }>(response, "TorBox search");
      const rows = normalizeList(json.data ?? json.torrents);
      if (!rows.length) throw new Error(json.error || "No results returned");
      return rows.map((item) => ({
        name: firstString(item, ["name", "titleFull", "title"]) || "Unknown",
        hash: cleanHash(firstString(item, ["hash", "info_hash", "infohash"])),
        size: firstNumber(item, ["size", "size_bytes", "filesize"]),
        seeds: firstNumber(item, ["seeds", "seeders", "seed"]),
        source: "torbox",
      }));
    }
    if (attempt < MAX_SEARCH_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, SEARCH_RETRY_DELAY_MS));
  }
  throw lastError;
}

export async function searchApibay(queries: string[]): Promise<TorrentHit[]> {
  return collectIndexerHits(queries, async (query) => {
    const response = await fetchApiWithValidatedRedirects(
      `https://apibay.org/q.php?q=${encodeURIComponent(query)}&cat=601`,
      ["apibay.org"],
      {
        headers: { Accept: "application/json" },
        timeoutMs: API_TIMEOUT_MS,
      },
    );
    if (!response.ok) return [];
    const data = await readJson<unknown>(response, "apibay");
    if (!Array.isArray(data)) return [];
    return (data as Record<string, unknown>[])
      .filter((item) => String(item.id) !== "0" && !/no results/i.test(String(item.name ?? "")))
      .map((item) => ({
        name: String(item.name ?? "Unknown"),
        hash: cleanHash(String(item.info_hash ?? "")),
        size: Number(item.size) || 0,
        seeds: Number(item.seeders) || 0,
        source: "apibay",
      }));
  });
}

export async function searchTorrentsCsv(queries: string[]): Promise<TorrentHit[]> {
  return collectIndexerHits(queries, async (query) => {
    const response = await fetchApiWithValidatedRedirects(
      `https://torrents-csv.com/service/search?q=${encodeURIComponent(query)}&size=25`,
      ["torrents-csv.com"],
      {
        headers: { Accept: "application/json" },
        timeoutMs: API_TIMEOUT_MS,
      },
    );
    if (!response.ok) return [];
    const json = await readJson<{ torrents?: Record<string, unknown>[] }>(response, "torrents-csv");
    const rows = Array.isArray(json.torrents) ? json.torrents : [];
    return rows.map((item) => ({
      name: String(item.name ?? "Unknown"),
      hash: cleanHash(String(item.infohash ?? item.info_hash ?? "")),
      size: Number(item.size_bytes ?? item.size) || 0,
      seeds: Number(item.seeders ?? item.seeds) || 0,
      source: "torrents-csv",
    }));
  });
}

async function collectIndexerHits(queries: string[], searchQuery: (query: string) => Promise<TorrentHit[]>): Promise<TorrentHit[]> {
  const hits: TorrentHit[] = [];
  for (const query of queries) {
    const found = await searchQuery(query).catch(() => []);
    hits.push(...found);
  }
  return uniqueHits(hits);
}

function uniqueHits(hits: TorrentHit[]): TorrentHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (!hit.hash || seen.has(hit.hash)) return false;
    seen.add(hit.hash);
    return true;
  });
}

function normalizeList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const object = data as Record<string, unknown>;
    if (Array.isArray(object.torrents)) return object.torrents as Record<string, unknown>[];
    if (Array.isArray(object.results)) return object.results as Record<string, unknown>[];
  }
  return [];
}

function firstString(item: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(item: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = item[key];
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isNaN(number) && number >= 0) return number;
  }
  return 0;
}
