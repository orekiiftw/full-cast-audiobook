import { TORRENT } from "../lib/constants";
import { fetchWithRedirectGuard, redirectFailureMessage, type RedirectGuard } from "../lib/redirectGuard";
import { readStreamWithCap } from "../lib/readStream";
import { isZipBuffer } from "../lib/validators";
import { isTorrentCached } from "./candidates";
import {
  API_TIMEOUT_MS,
  ERROR_TEXT_CAP,
  MAIN_API_URL,
  TORBOX_API_HOSTS,
  errorResText,
  fetchApiWithValidatedRedirects,
  readBodyText,
  readJson,
  torBoxApiKey,
} from "./client";
import { assertSafeDownloadUrlDns } from "./safety";
import type { TorrentCandidate } from "./types";

export type DownloadAttempt = { ok: true; buffer: Buffer; filename: string } | { ok: false; reason: "failed" | "timeout" };

interface FileRow {
  id?: number;
  name?: string;
  short_name?: string;
  size?: number;
}

interface TorrentRow {
  progress?: number;
  status?: string;
  download_state?: string;
  download_finished?: boolean;
  download_present?: boolean;
  files?: FileRow[];
}

const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const MAX_REDIRECT_HOPS = 5;

function cdnRedirectGuard(): RedirectGuard {
  return {
    maxHops: MAX_REDIRECT_HOPS,
    approve: async (target) => new URL(await assertSafeDownloadUrlDns(target.toString())),
    fail: (failure) => new Error(redirectFailureMessage("CDN download", failure)),
  };
}

async function fetchWithValidatedRedirects(url: string): Promise<Response> {
  return fetchWithRedirectGuard({ url, timeoutMs: DOWNLOAD_TIMEOUT_MS, guard: cdnRedirectGuard() });
}

function verifyBookBuffer(buffer: Buffer, filename: string): void {
  const isPdf = filename.toLowerCase().endsWith(".pdf") || buffer.toString("binary", 0, 4) === "%PDF";
  if (isPdf)
    throw new Error("PDF format detected. Only EPUB ebooks are supported to guarantee high-quality layout and multi-voice generation.");
  if (!isZipBuffer(buffer)) throw new Error("The file is corrupted or is not a valid EPUB zip archive.");
}

export async function readVerifiedBook(response: Response, filename: string): Promise<{ buffer: Buffer; filename: string }> {
  if (Number(response.headers.get("content-length") ?? 0) > TORRENT.MAX_FILE_SIZE_BYTES)
    throw new Error("The target book file exceeds the 200MB size limit.");
  if (!response.body) throw new Error("Empty response body from CDN.");
  const buffer = await readStreamWithCap(
    response.body,
    TORRENT.MAX_FILE_SIZE_BYTES,
    () => new Error("The downloaded file exceeds the 200MB size limit."),
  );
  verifyBookBuffer(buffer, filename);
  return { buffer, filename };
}

function fileLabel(file: FileRow): string {
  return `${file.short_name || ""} ${file.name || ""}`.toLowerCase();
}

function isExactEpubFile(file: FileRow): boolean {
  const label = fileLabel(file);
  return label.includes(".epub") && !label.includes(".epub.") && !/sample/i.test(label);
}

export function selectTorrentFile(files: FileRow[] | undefined, expectedMd5?: string): FileRow | undefined {
  const list = files ?? [];
  if (expectedMd5 != null) {
    const wantedMd5 = expectedMd5.toLowerCase();
    const md5Match =
      list.find((file) => fileLabel(file).includes(wantedMd5)) ??
      list.find((file) =>
        fileLabel(file)
          .replace(/[^a-f0-9]/g, "")
          .includes(wantedMd5),
      );
    if (md5Match) return md5Match;
  }
  return list.find(isExactEpubFile) ?? list.find((file) => fileLabel(file).includes(".epub"));
}

function isDownloadReady(torrent: TorrentRow): boolean {
  const state = torrent.download_state || torrent.status || "";
  return (
    torrent.download_finished || torrent.download_present || state === "cached" || state === "completed" || (torrent.progress ?? 0) >= 1
  );
}

async function addTorrentToTorBox(magnet: string, apiKey: string, addOnlyIfCached: boolean): Promise<number> {
  const form = new FormData();
  form.append("magnet", magnet);
  form.append("seed", "3");
  if (addOnlyIfCached) form.append("add_only_if_cached", "true");
  const createResponse = await fetchApiWithValidatedRedirects(`${MAIN_API_URL}/torrents/createtorrent`, TORBOX_API_HOSTS, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    timeoutMs: API_TIMEOUT_MS,
  });
  if (!createResponse.ok)
    throw new Error(
      `TorBox failed to add torrent: ${errorResText(await readBodyText(createResponse, ERROR_TEXT_CAP, "TorBox add torrent"))}`,
    );
  const created = await readJson<{ success?: boolean; data?: { torrent_id?: number }; detail?: string }>(
    createResponse,
    "TorBox add torrent",
  );
  const torrentId = created.data?.torrent_id;
  if (!created.success || torrentId == null) throw new Error(`TorBox create failed: ${created.detail || "Unknown error"}`);
  return torrentId;
}

async function waitForTorrentReady(
  torrentId: number,
  pollCap: number,
  apiKey: string,
  onProgress?: (message: string) => void,
): Promise<TorrentRow | null> {
  let torrent: TorrentRow | null = null;
  for (let poll = 0; poll < pollCap; poll++) {
    try {
      const response = await fetchApiWithValidatedRedirects(`${MAIN_API_URL}/torrents/mylist?id=${torrentId}`, TORBOX_API_HOSTS, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: API_TIMEOUT_MS,
      });
      if (response.ok) {
        const json = await readJson<{ data?: TorrentRow | TorrentRow[] }>(response, "TorBox mylist");
        torrent = Array.isArray(json.data) ? (json.data[0] ?? null) : (json.data ?? null);
        const state = torrent?.download_state || torrent?.status || "";
        if (torrent && isDownloadReady(torrent)) break;
        if (state === "failed" || state === "error") break;
        onProgress?.(`Downloading torrent: ${((torrent?.progress ?? 0) * 100).toFixed(1)}% (${state})`);
      }
    } catch (error) {
      console.warn("⚠️ TorBox mylist poll failed:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, TORRENT.POLL_INTERVAL_MS));
  }
  return torrent;
}

async function requestDownloadLink(torrentId: number, fileId: number, apiKey: string): Promise<string> {
  const linkResponse = await fetchApiWithValidatedRedirects(
    `${MAIN_API_URL}/torrents/requestdl?torrent_id=${torrentId}&file_id=${fileId}&zip_link=false&token=${encodeURIComponent(apiKey)}`,
    TORBOX_API_HOSTS,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: API_TIMEOUT_MS,
    },
  );
  if (!linkResponse.ok)
    throw new Error(
      `Failed to request download link (${linkResponse.status}): ${errorResText(await readBodyText(linkResponse, ERROR_TEXT_CAP, "TorBox requestdl")) || linkResponse.statusText}`,
    );
  const linkJson = await readJson<{ success?: boolean; data?: string | { url?: string }; detail?: string }>(
    linkResponse,
    "TorBox requestdl",
  );
  const downloadUrl = typeof linkJson.data === "string" ? linkJson.data : linkJson.data?.url;
  if (!linkJson.success || !downloadUrl) throw new Error(`Download request failed: ${linkJson.detail || "Unknown error"}`);
  return downloadUrl;
}

async function downloadTorrentFile(downloadUrl: string, filename: string): Promise<{ buffer: Buffer; filename: string }> {
  const safeDownloadUrl = await assertSafeDownloadUrlDns(downloadUrl);
  const fileResponse = await fetchWithValidatedRedirects(safeDownloadUrl);
  if (!fileResponse.ok) throw new Error(`Failed to download file from CDN: ${fileResponse.statusText}`);
  return readVerifiedBook(fileResponse, filename);
}

async function attemptDownload(
  magnet: string,
  options: { pollCap: number; expectedMd5?: string; addOnlyIfCached?: boolean },
  onProgress?: (message: string) => void,
): Promise<DownloadAttempt> {
  const apiKey = torBoxApiKey();
  if (!apiKey) throw new Error("TorBox API Key is not configured in .env file.");
  onProgress?.("Checking cache status...");
  const cached = await isTorrentCached(magnet);
  console.log(`TorBox cache state: ${cached ? "CACHED" : "UNCACHED"}`);
  onProgress?.("Adding torrent to TorBox...");
  const torrentId = await addTorrentToTorBox(magnet, apiKey, options.addOnlyIfCached ?? false);
  onProgress?.("Waiting for torrent to download...");
  const torrent = await waitForTorrentReady(torrentId, options.pollCap, apiKey, onProgress);
  const state = torrent?.download_state || torrent?.status || "";
  if (state === "failed" || state === "error") return { ok: false, reason: "failed" };
  if (!torrent || !isDownloadReady(torrent)) return { ok: false, reason: "timeout" };
  const target = selectTorrentFile(torrent.files ?? [], options.expectedMd5);
  if (target?.id == null) return { ok: false, reason: "failed" };
  if ((target.size ?? 0) > TORRENT.MAX_FILE_SIZE_BYTES) throw new Error("The target book file exceeds the 200MB size limit.");
  const filename = target.short_name || target.name || "book.epub";
  onProgress?.(`Requesting download link for: ${filename}...`);
  const downloadUrl = await requestDownloadLink(torrentId, target.id, apiKey);
  const book = await downloadTorrentFile(downloadUrl, filename);
  return { ok: true, buffer: book.buffer, filename: book.filename };
}

export async function attemptTorrentDownload(
  candidate: TorrentCandidate,
  cold: boolean,
  expectedMd5: string | undefined,
  onProgress?: (message: string) => void,
): Promise<DownloadAttempt> {
  return attemptDownload(
    candidate.magnet || `magnet:?xt=urn:btih:${candidate.hash}`,
    {
      pollCap: candidate.cached ? TORRENT.MAX_POLLS : TORRENT.MAX_POLLS_UNCACHED,
      expectedMd5: candidate.md5 ?? expectedMd5,
      addOnlyIfCached: cold,
    },
    onProgress,
  );
}
