import { createHash } from "crypto";
import { errorMessage } from "../../lib/errors";
import { downloadBookFromCandidates, downloadBookFromTorrent, resolveTorrentCandidates, type TorrentCandidate } from "../../torrent";
import { searchCatalogueTorrentCandidates } from "../../acquisition/catalogue";
import { bookProviders, enabledLibrarySources, UnsupportedFormatError, type BookResult } from "../../acquisition";
import { downloadFile } from "../../storage/r2";
import { TORRENT } from "../../lib/constants";
import { readStreamWithCap } from "../../lib/readStream";
import { inspectEpub } from "../../epub";
import { emitProgressEvent, type IngestionJobData } from "../../queue";

type BookSource = IngestionJobData["source"];

export async function resolveEpubBuffer(bookId: string, epubR2Key: string | null, source: BookSource): Promise<Buffer> {
  if (epubR2Key) return downloadFile(epubR2Key);

  return acquireFromSource(bookId, source);
}

// Every source that produced nothing is recorded, so a book that never gets a readable EPUB fails with the reasons
// instead of a generic message: a rejected TorBox token and a fallback that sent a web page are different problems
// with different fixes.
async function acquireFromSource(bookId: string, source: BookSource): Promise<Buffer> {
  const { providerBook, torrentQuery, magnetOrHash } = source;

  if (providerBook) return acquireFromProvider(bookId, providerBook);

  const attempts: string[] = [];

  if (torrentQuery) {
    const fromTorrentQuery = await acquireFromTorrentQuery(bookId, torrentQuery, attempts);
    if (fromTorrentQuery) return fromTorrentQuery;
  }

  if (magnetOrHash) {
    const fromMagnet = await acquireFromTorrent(bookId, magnetOrHash, attempts);
    if (fromMagnet) return fromMagnet;
  }

  if (attempts.length === 0) {
    throw new Error("No magnet, hash, or title query provided for ingestion.");
  }
  throw new Error(`No source produced a readable EPUB. ${attempts.join(" | ")}`);
}

async function acquireFromTorrent(bookId: string, magnetOrHash: string, attempts: string[]): Promise<Buffer | undefined> {
  try {
    const downloaded = await downloadBookFromTorrent(magnetOrHash, (progressMessage) => {
      emitProgressEvent(bookId, "progress_log", { message: progressMessage });
    });
    return downloaded.buffer;
  } catch (error) {
    const message = errorMessage(error);
    console.warn(`⚠️ Magnet download failed (${message}).`);
    attempts.push(`magnet: ${message}`);
    return undefined;
  }
}

async function acquireFromProvider(bookId: string, providerBook: BookResult): Promise<Buffer> {
  if (providerBook.format !== "epub") {
    throw new UnsupportedFormatError(`Only EPUB acquisition is supported; got ${providerBook.format}.`);
  }

  emitProgressEvent(bookId, "status_change", {
    status: "discovering",
    message: `Acquiring from ${providerBook.provider}...`,
  });

  const acquired = await bookProviders.get(providerBook.provider).acquire(providerBook);
  if (acquired.contentType && !/application\/epub\+zip|application\/zip|application\/octet-stream/i.test(acquired.contentType)) {
    throw new UnsupportedFormatError(`Unexpected provider content type: ${acquired.contentType}`);
  }
  if (acquired.contentLength && acquired.contentLength > TORRENT.MAX_FILE_SIZE_BYTES) {
    throw new UnsupportedFormatError("The provider file exceeds the 200MB EPUB limit.");
  }

  const epubBuffer = await readAcquiredEpub(acquired.stream, TORRENT.MAX_FILE_SIZE_BYTES, acquired.expectedSha256);
  const defect = inspectEpub(epubBuffer);
  if (defect) {
    throw new UnsupportedFormatError(`The provider response is not a readable EPUB (${defect.detail}).`);
  }
  return epubBuffer;
}

async function acquireFromTorrentQuery(
  bookId: string,
  query: { title: string; author: string },
  attempts: string[],
): Promise<Buffer | undefined> {
  const { title, author } = query;

  emitProgressEvent(bookId, "status_change", {
    status: "discovering",
    message: `Searching torrents for "${title}"...`,
  });

  const candidates = await searchTorrentCandidates(bookId, title, author);
  const fromCandidates = await downloadFromCandidates(bookId, candidates, attempts);
  if (fromCandidates) return fromCandidates;
  if (!title) return undefined;

  return downloadFromOpenLibraries(bookId, title, author, attempts);
}

async function searchTorrentCandidates(bookId: string, title: string, author: string): Promise<TorrentCandidate[]> {
  try {
    const liveCandidates = await resolveTorrentCandidates(title, author, (progressMessage) => {
      emitProgressEvent(bookId, "progress_log", { message: progressMessage });
    });
    if (liveCandidates.length > 0) return liveCandidates;
  } catch (error) {
    const message = errorMessage(error);
    console.warn(`⚠️ Live torrent search failed (${message}); continuing to catalogue fallback...`);
  }

  emitProgressEvent(bookId, "status_change", {
    status: "discovering",
    message: `No live torrents; checking catalogue for "${title}"...`,
  });
  return searchCatalogueTorrentCandidates(title, author);
}

async function downloadFromCandidates(bookId: string, candidates: TorrentCandidate[], attempts: string[]): Promise<Buffer | undefined> {
  if (candidates.length === 0) {
    attempts.push("no torrent matched the title");
    return undefined;
  }

  try {
    const downloaded = await downloadBookFromCandidates(candidates, {}, (progressMessage) => {
      emitProgressEvent(bookId, "progress_log", { message: progressMessage });
    });
    return downloaded.buffer;
  } catch (error) {
    const message = errorMessage(error);
    console.warn(`⚠️ Torrent/IPFS candidates failed (${message}); attempting open digital library fallback...`);
    attempts.push(`torrents: ${message}`);
    return undefined;
  }
}

async function downloadFromOpenLibraries(bookId: string, title: string, author: string, attempts: string[]): Promise<Buffer | undefined> {
  const onProgress = (progressMessage: string) => emitProgressEvent(bookId, "progress_log", { message: progressMessage });

  const sources = enabledLibrarySources();
  for (const { label, fetchEpub } of sources) {
    emitProgressEvent(bookId, "progress_log", { message: `Checking ${label} for "${title}"...` });
    const result = await fetchEpub(title, author, onProgress);
    if (result) return result.buffer;
  }
  if (sources.length > 0) {
    attempts.push(`open libraries (${sources.map((source) => source.label).join(", ")}): no readable EPUB`);
  }
  return undefined;
}

async function readAcquiredEpub(stream: ReadableStream<Uint8Array>, maxBytes: number, expectedSha256?: string): Promise<Buffer> {
  const hash = createHash("sha256");
  const buffer = await readStreamWithCap(
    stream,
    maxBytes,
    () => new UnsupportedFormatError("The provider file exceeds the 200MB EPUB limit."),
    (chunk) => hash.update(chunk),
  );
  if (expectedSha256 && hash.digest("hex").toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new UnsupportedFormatError("Provider file hash verification failed.");
  }
  return buffer;
}
