import { TORRENT } from "./lib/constants";
import { readStreamWithCap } from "./lib/readStream";
import { isZipBuffer } from "./lib/validators";

const TORBOX_API_KEY = process.env.TORBOX_API_KEY;
const MAIN_API_URL = "https://api.torbox.app/v1/api";
const SEARCH_API_URL = "https://search-api.torbox.app";
const MAX_TORRENT_BYTES = TORRENT.MAX_FILE_SIZE_BYTES;

interface TorrentHit { name: string; hash: string; size: number; seeds: number; source: string; }

/** Builds a bounded sequence from precise to resilient public-index queries. */
export function buildTorrentSearchQueries(title: string, author: string): string[] {
  const clean = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
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
  ].map((q) => q.replace(/\s+/g, " ").trim()).filter((q) => q !== "epub");
  return [...new Set(variants)].slice(0, 5);
}

/** Searches TorBox first, then aggregates normalized public-index fallbacks. */
export async function searchBookTorrent(title: string, author: string): Promise<string> {
  const queries = buildTorrentSearchQueries(title, author);
  if (!queries.length) throw new Error("A book title is required for torrent search.");
  console.log(`🔍 Searching torrents using ${queries.length} query variant(s): ${queries.map((query) => JSON.stringify(query)).join(", ")}`);
  const errors: string[] = [];
  const providers: Array<{ name: string; run: () => Promise<TorrentHit[]> }> = [
    { name: "torbox", run: () => searchTorBox(queries[0]) },
    { name: "apibay", run: () => searchApibay(queries) },
    { name: "torrents-csv", run: () => searchTorrentsCsv(queries) },
  ];
  for (const provider of providers) {
    try {
      const best = pickBestEpubTorrent(await provider.run(), title, author);
      if (best) {
        console.log(`✅ Selected via ${best.source}: "${best.name}" (${(best.size / (1024 * 1024)).toFixed(2)} MB, ${best.seeds} seeds)`);
        return `magnet:?xt=urn:btih:${best.hash}&dn=${encodeURIComponent(best.name)}`;
      }
      errors.push(`${provider.name}: no suitable EPUB under 200MB`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ Search provider "${provider.name}" failed: ${message}`);
      errors.push(`${provider.name}: ${message}`);
    }
  }
  throw new Error(`Could not find torrent. ${errors.join(" | ")}`);
}

async function searchTorBox(query: string): Promise<TorrentHit[]> {
  if (!TORBOX_API_KEY) throw new Error("TORBOX_API_KEY not set");
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, Math.min(2000 * 2 ** attempt, 15_000)));
    const res = await fetch(`${SEARCH_API_URL}/torrents/search/${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${TORBOX_API_KEY}`, Accept: "application/json" } });
    if (res.status === 429) {
      const body = await res.text().catch(() => "");
      if (/0 per/i.test(body)) throw new Error("TorBox Search API quota is 0 on this account (use fallback indexers)");
      lastError = new Error("Rate limited (429)");
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { data?: unknown; torrents?: unknown; error?: string };
    const rows = normalizeList(json.data ?? json.torrents);
    if (!rows.length) throw new Error(json.error || "No results returned");
    return rows.map((item) => ({ name: str(item, ["name", "titleFull", "title"]) || "Unknown", hash: cleanHash(str(item, ["hash", "info_hash", "infohash"])), size: num(item, ["size", "size_bytes", "filesize"]), seeds: num(item, ["seeds", "seeders", "seed"]), source: "torbox" }));
  }
  throw lastError ?? new Error("TorBox search retries exhausted");
}

async function searchApibay(queries: string[]): Promise<TorrentHit[]> {
  const hits: TorrentHit[] = [];
  for (const query of queries) {
    try {
      const res = await fetch(`https://apibay.org/q.php?q=${encodeURIComponent(query)}&cat=601`, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const data = await res.json() as unknown;
      if (!Array.isArray(data)) continue;
      for (const item of data as Record<string, unknown>[]) {
        if (String(item.id) === "0" || /no results/i.test(String(item.name ?? ""))) continue;
        hits.push({ name: String(item.name ?? "Unknown"), hash: cleanHash(String(item.info_hash ?? "")), size: Number(item.size) || 0, seeds: Number(item.seeders) || 0, source: "apibay" });
      }
    } catch { /* continue with the next variant */ }
  }
  return uniqueHits(hits);
}

async function searchTorrentsCsv(queries: string[]): Promise<TorrentHit[]> {
  const hits: TorrentHit[] = [];
  for (const query of queries) {
    try {
      const res = await fetch(`https://torrents-csv.com/service/search?q=${encodeURIComponent(query)}&size=25`, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const json = await res.json() as { torrents?: Record<string, unknown>[] };
      for (const item of Array.isArray(json.torrents) ? json.torrents : []) hits.push({ name: String(item.name ?? "Unknown"), hash: cleanHash(String(item.infohash ?? item.info_hash ?? "")), size: Number(item.size_bytes ?? item.size) || 0, seeds: Number(item.seeders ?? item.seeds) || 0, source: "torrents-csv" });
    } catch { /* continue with the next variant */ }
  }
  return uniqueHits(hits);
}

function uniqueHits(hits: TorrentHit[]): TorrentHit[] { const seen = new Set<string>(); return hits.filter((hit) => !!hit.hash && !seen.has(hit.hash) && (seen.add(hit.hash), true)); }
function pickBestEpubTorrent(hits: TorrentHit[], title: string, author: string): TorrentHit | null {
  const titleTokens = tokenize(title); const authorTokens = tokenize(author);
  const scored = hits.filter((t) => t.hash.length >= 32 && (t.size <= 0 || t.size <= MAX_TORRENT_BYTES)).map((t) => {
    const name = t.name.toLowerCase(); let score = 0;
    if (/\.epub\b|\bepub\b/i.test(name)) score += 50; if (/\.pdf\b/i.test(name)) score -= 20; if (/\.mobi\b|\.azw/i.test(name)) score -= 5; if (/\baudiobook\b|\bmp3\b|\bm4b\b/i.test(name)) score -= 40;
    for (const token of titleTokens) if (name.includes(token)) score += 8; for (const token of authorTokens) if (name.includes(token)) score += 4;
    score += Math.min(t.seeds, 50); if (t.size > 0 && t.size < 20 * 1024 * 1024) score += 10; if (t.size > 50 * 1024 * 1024) score -= 10;
    return { t, score };
  }).filter(({ t, score }) => /\bepub\b|\.epub\b/i.test(t.name) && (titleTokens.length === 0 || titleTokens.some((token) => t.name.toLowerCase().includes(token))) && score > 0).sort((a, b) => b.score - a.score || b.t.seeds - a.t.seeds);
  return scored[0]?.t ?? null;
}
function tokenize(value: string): string[] { return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 2 && !["the", "and", "for"].includes(word)); }
function cleanHash(hash: string): string { return hash.replace(/^urn:btih:/i, "").replace(/[^a-fA-F0-9]/g, "").toLowerCase(); }
function normalizeList(data: unknown): Record<string, unknown>[] { if (Array.isArray(data)) return data as Record<string, unknown>[]; if (data && typeof data === "object") { const object = data as Record<string, unknown>; if (Array.isArray(object.torrents)) return object.torrents as Record<string, unknown>[]; if (Array.isArray(object.results)) return object.results as Record<string, unknown>[]; } return []; }
function str(item: Record<string, unknown>, keys: string[]): string { for (const key of keys) { const value = item[key]; if (typeof value === "string" && value.trim()) return value.trim(); } return ""; }
function num(item: Record<string, unknown>, keys: string[]): number { for (const key of keys) { const value = item[key]; const number = typeof value === "number" ? value : Number(value); if (!Number.isNaN(number) && number >= 0) return number; } return 0; }

/** Checks if a torrent hash is already cached in TorBox */
export async function isTorrentCached(hash: string): Promise<boolean> {
  if (!TORBOX_API_KEY) return false;
  try {
    const clean = cleanHash(hash.replace("magnet:?xt=urn:btih:", "").split("&")[0]);
    const res = await fetch(`${MAIN_API_URL}/torrents/checkcached?hash=${clean}&format=list`, { headers: { Authorization: `Bearer ${TORBOX_API_KEY}` } });
    if (!res.ok) return false;
    const json = await res.json() as { success?: boolean; data?: Record<string, { cached?: boolean }> };
    return !!(json.success && json.data && json.data[clean]?.cached);
  } catch { return false; }
}

/** Downloads an EPUB through TorBox, enforcing a streamed 200MB limit. */
export async function downloadBookFromTorrent(magnetOrHash: string, onProgress?: (message: string) => void): Promise<{ buffer: Buffer; filename: string }> {
  if (!TORBOX_API_KEY) throw new Error("TorBox API Key is not configured in .env file.");
  let magnet = magnetOrHash;
  if (!magnet.startsWith("magnet:") && /^[0-9a-fA-F]{40}$/.test(magnet)) magnet = `magnet:?xt=urn:btih:${magnet}`;
  onProgress?.("Checking cache status...");
  const cached = await isTorrentCached(magnet);
  console.log(`TorBox cache state: ${cached ? "CACHED" : "UNCACHED"}`);
  onProgress?.("Adding torrent to TorBox...");
  const form = new FormData(); form.append("magnet", magnet); form.append("seed", "3");
  const createRes = await fetch(`${MAIN_API_URL}/torrents/createtorrent`, { method: "POST", headers: { Authorization: `Bearer ${TORBOX_API_KEY}` }, body: form });
  if (!createRes.ok) throw new Error(`TorBox failed to add torrent: ${errorResText(await createRes.text())}`);
  const created = await createRes.json() as { success?: boolean; data?: { torrent_id?: number }; detail?: string };
  const torrentId = created.data?.torrent_id;
  if (!created.success || torrentId == null) throw new Error(`TorBox create failed: ${created.detail || "Unknown error"}`);
  onProgress?.("Waiting for torrent to download...");
  type FileRow = { id?: number; name?: string; short_name?: string; size?: number };
  type TorrentRow = { progress?: number; status?: string; download_state?: string; download_finished?: boolean; download_present?: boolean; files?: FileRow[] };
  let torrent: TorrentRow | null = null;
  for (let poll = 0; poll < TORRENT.MAX_POLLS; poll++) {
    const result = await fetch(`${MAIN_API_URL}/torrents/mylist?id=${torrentId}`, { headers: { Authorization: `Bearer ${TORBOX_API_KEY}` } });
    if (result.ok) {
      const json = await result.json() as { data?: TorrentRow | TorrentRow[] };
      torrent = Array.isArray(json.data) ? json.data[0] ?? null : json.data ?? null;
      const state = torrent?.download_state || torrent?.status || "";
      const ready = !!torrent && (torrent.download_finished || torrent.download_present || state === "cached" || state === "completed" || (torrent.progress ?? 0) >= 1);
      if (ready) break;
      if (state === "failed" || state === "error") throw new Error("Torrent download failed on TorBox server.");
      onProgress?.(`Downloading torrent: ${((torrent?.progress ?? 0) * 100).toFixed(1)}% (${state})`);
    }
    await new Promise((resolve) => setTimeout(resolve, TORRENT.POLL_INTERVAL_MS));
  }
  const ready = !!torrent && (torrent.download_finished || torrent.download_present || torrent.download_state === "cached" || torrent.download_state === "completed" || torrent.status === "completed" || (torrent.progress ?? 0) >= 1);
  if (!ready || !torrent) throw new Error("Timeout waiting for torrent to download on TorBox.");
  const label = (file: FileRow) => `${file.short_name || ""} ${file.name || ""}`.toLowerCase();
  const target = (torrent.files ?? []).find((file) => label(file).includes(".epub"));
  if (!target?.id) { const hasPdf = (torrent.files ?? []).some((file) => label(file).includes(".pdf")); throw new Error(hasPdf ? "Torrent contains only PDF files. Only EPUB ebooks are supported." : "No EPUB files found inside the torrent archive."); }
  if ((target.size ?? 0) > MAX_TORRENT_BYTES) throw new Error("The target book file exceeds the 200MB size limit.");
  const filename = target.short_name || target.name || "book.epub";
  onProgress?.(`Requesting download link for: ${filename}...`);
  // TorBox's requestdl endpoint rejects header-only auth with a 422
  // ("query.token: field required") — unlike the other endpoints, it demands
  // the API token as a query parameter. The CDN URL it returns already
  // embeds a one-time token in its own query string, so query-string
  // credentials are inherent to this provider's design. Never log this URL.
  const linkResponse = await fetch(`${MAIN_API_URL}/torrents/requestdl?torrent_id=${torrentId}&file_id=${target.id}&zip_link=false&token=${encodeURIComponent(TORBOX_API_KEY)}`, { headers: { Authorization: `Bearer ${TORBOX_API_KEY}` } });
  if (!linkResponse.ok) throw new Error(`Failed to request download link (${linkResponse.status}): ${errorResText(await linkResponse.text()) || linkResponse.statusText}`);
  const linkJson = await linkResponse.json() as { success?: boolean; data?: string | { url?: string }; detail?: string };
  const downloadUrl = typeof linkJson.data === "string" ? linkJson.data : linkJson.data?.url;
  if (!linkJson.success || !downloadUrl) throw new Error(`Download request failed: ${linkJson.detail || "Unknown error"}`);
  const safeDownloadUrl = assertSafeDownloadUrl(downloadUrl);
  const fileResponse = await fetch(safeDownloadUrl);
  if (!fileResponse.ok) throw new Error(`Failed to download file from CDN: ${fileResponse.statusText}`);
  if (Number(fileResponse.headers.get("content-length") ?? 0) > MAX_TORRENT_BYTES) throw new Error("The target book file exceeds the 200MB size limit.");
  const buffer = await readBodyWithCap(fileResponse, MAX_TORRENT_BYTES);
  verifyBookBuffer(buffer, filename);
  return { buffer, filename };
}
async function readBodyWithCap(response: Response, cap: number): Promise<Buffer> { if (!response.body) throw new Error("Empty response body from CDN."); return readStreamWithCap(response.body, cap, () => new Error("The downloaded file exceeds the 200MB size limit.")); }
function verifyBookBuffer(buffer: Buffer, filename: string) { const isPdf = filename.toLowerCase().endsWith(".pdf") || buffer.toString("binary", 0, 4) === "%PDF"; if (isPdf) throw new Error("PDF format detected. Only EPUB ebooks are supported to guarantee high-quality layout and multi-voice generation."); if (!isZipBuffer(buffer)) throw new Error("The file is corrupted or is not a valid EPUB zip archive."); }
function errorResText(text: string): string {
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; error?: unknown };
    const detail = parsed.detail ?? parsed.error;
    if (typeof detail === "string") return detail;
    // FastAPI validation errors put an array of objects in `detail` —
    // stringify so logs show the actual cause instead of "[object Object]".
    if (detail != null) return JSON.stringify(detail);
    return text;
  } catch { return text; }
}

/**
 * Guards the server-side fetch of a TorBox-returned download URL against SSRF:
 * the URL comes from a third-party API influenced by the user's magnet/hash,
 * so a rogue/compromised TorBox could point us at an internal host. Require
 * HTTPS and a torbox-owned hostname, and reject private/loopback/link-local
 * addresses even if DNS resolves them. The token still rides in the original
 * TorBox request, so no credential is sent to the validated URL.
 */
export function assertSafeDownloadUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("TorBox returned an invalid download URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("TorBox returned a non-HTTPS download URL.");
  }
  const host = url.hostname.toLowerCase();
  // TorBox serves files from its own CDNs: historically *.torbox.app, now
  // *.tb-cdn.pw (e.g. https://nexus-008.indi.tb-cdn.pw/dld/...). Both are
  // returned by the authenticated requestdl endpoint; reject anything else.
  const isTorBoxHost = (h: string) => h === "torbox.app" || h.endsWith(".torbox.app") || h === "tb-cdn.pw" || h.endsWith(".tb-cdn.pw");
  if (!isTorBoxHost(host)) {
    throw new Error("TorBox returned a download URL on an unexpected host.");
  }
  // Defense-in-depth: an allowlisted CDN entry pointing at a private IP via
  // DNS still must not be fetched.
  if (isPrivateHost(host)) {
    throw new Error("TorBox returned a download URL resolving to a private address.");
  }
  return url.toString();
}

/** True for loopback / private / link-local / unspecified hostnames. */
function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host === "::1" || host === "[::1]") return true;
  // IPv4 dotted-quad
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const [a] = m.slice(1).map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && Number(m[2]) === 254) return true; // 169.254.0.0/16 link-local
    if (a === 172 && Number(m[2]) >= 16 && Number(m[2]) <= 31) return true; // 172.16.0.0/12
    if (a === 192 && Number(m[2]) === 168) return true; // 192.168.0.0/16
  }
  return false;
}
