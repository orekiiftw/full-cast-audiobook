import { resolveTorrentCandidates } from "./candidates";
import { sanitizeLogText } from "./client";
import { errorMessage } from "../lib/errors";
import { attemptTorrentDownload, type DownloadAttempt } from "./download";
import { downloadCandidateFromIpfs } from "./ipfs";
import { candidateHealth, isColdCandidate } from "./ranking";
import { infohashFromMagnet } from "./search";
import type { TorrentCandidate } from "./types";

export async function searchBookTorrent(title: string, author: string): Promise<string> {
  const candidates = await resolveTorrentCandidates(title, author);
  if (candidates.length) {
    const best = candidates[0];
    const health = candidateHealth(best);
    console.log(
      `✅ Selected via ${best.source}: "${sanitizeLogText(best.name)}" (${(best.size / (1024 * 1024)).toFixed(2)} MB, ${best.seeds} seeds${
        health ? `, ${health}` : ""
      })`,
    );
    return best.magnet;
  }
  throw new Error("Could not find torrent. No suitable EPUB under 200MB on any indexer.");
}

export async function downloadBookFromCandidates(
  candidates: TorrentCandidate[],
  options: { expectedMd5?: string } = {},
  onProgress?: (message: string) => void,
): Promise<{ buffer: Buffer; filename: string }> {
  if (!candidates.length) throw new Error("No torrent candidates to download — nothing resolved the book to a torrent.");
  const failures: string[] = [];

  for (let index = 0; index < candidates.length; index++) {
    const book = await attemptCandidateDownload(candidates, index, options, failures, onProgress);
    if (book) return book;
  }
  throw new Error(`All ${candidates.length} torrent candidate(s) failed to download: ${failures.join(" | ")}`);
}

export async function downloadBookFromTorrent(
  magnetOrHash: string,
  onProgress?: (message: string) => void,
): Promise<{ buffer: Buffer; filename: string }> {
  let magnet = magnetOrHash;
  if (!magnet.startsWith("magnet:") && /^[0-9a-fA-F]{40}$/.test(magnet)) magnet = `magnet:?xt=urn:btih:${magnet}`;
  const candidates: TorrentCandidate[] = [
    { magnet, hash: infohashFromMagnet(magnet), name: magnet, size: 0, seeds: 0, source: "torrent", cached: null, alive: null },
  ];
  return downloadBookFromCandidates(candidates, {}, onProgress);
}

async function attemptCandidateDownload(
  candidates: TorrentCandidate[],
  index: number,
  options: { expectedMd5?: string },
  failures: string[],
  onProgress?: (message: string) => void,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const candidate = candidates[index];
  const label = sanitizeLogText(candidate.name).slice(0, 120);
  const hasNextCandidate = index < candidates.length - 1;
  const cold = isColdCandidate(candidate);

  if (cold) {
    const fromIpfs = await downloadCandidateFromIpfs(candidate, onProgress);
    if (fromIpfs) return fromIpfs;
    if (hasHealthierCandidateAhead(candidates, index)) {
      console.warn(`⏭️ Skipping cold edition: "${label}" (uncached, no live seeders)`);
      onProgress?.(`Skipping cold edition "${label}" — trying the next edition...`);
      return null;
    }
  }

  let attempt: DownloadAttempt;
  try {
    attempt = await attemptTorrentDownload(candidate, cold, options.expectedMd5, onProgress);
  } catch (error) {
    const message = errorMessage(error);
    failures.push(`${candidate.name}: ${message}`);
    const fromIpfs = await downloadCandidateFromIpfs(candidate, onProgress);
    if (fromIpfs) return fromIpfs;
    if (hasNextCandidate) {
      console.warn(`⚠️ Candidate "${label}" failed (${message}); trying next edition...`);
      onProgress?.(`Candidate "${label}" failed — trying next edition...`);
    }
    return null;
  }
  if (attempt.ok) return { buffer: attempt.buffer, filename: attempt.filename };

  const reason = attempt.reason === "failed" ? "failed on TorBox server" : "timed out waiting";
  const fromIpfs = await downloadCandidateFromIpfs(candidate, onProgress);
  if (fromIpfs) return fromIpfs;
  failures.push(`${candidate.name}: ${reason}`);
  if (hasNextCandidate) {
    console.warn(`⚠️ Candidate "${label}" ${reason}; trying next edition...`);
    onProgress?.(`Candidate "${label}" ${reason} — trying next edition...`);
  }
  return null;
}

function hasHealthierCandidateAhead(candidates: TorrentCandidate[], index: number): boolean {
  return candidates.slice(index + 1).some((candidate) => !isColdCandidate(candidate));
}
