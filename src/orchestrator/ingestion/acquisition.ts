import { createHash } from "crypto";
import { errorMessage } from "../../lib/errors";
import { downloadBookFromCandidates, downloadBookFromTorrent, resolveTorrentCandidates, type TorrentCandidate } from "../../torrent";
import { searchCatalogueTorrentCandidates } from "../../acquisition/catalogue";
import { bookProviders, enabledLibrarySources, UnsupportedFormatError, type BookResult } from "../../acquisition";
import { downloadFile } from "../../storage/r2";
import { TORRENT } from "../../lib/constants";
import { readStreamWithCap } from "../../lib/readStream";
import { isZipBuffer } from "../../lib/validators";
import { emitProgressEvent, type IngestionJobData } from "../../queue";

type BookSource = IngestionJobData["source"];

export async function resolveEpubBuffer(bookId: string, epubR2Key: string | null, source: BookSource): Promise<Buffer> {
  if (epubR2Key) return downloadFile(epubR2Key);

  const acquired = await acquireFromSource(bookId, source);
  if (!acquired) throw new Error("Could not retrieve EPUB content buffer.");
  return acquired;
}

async function acquireFromSource(bookId: string, source: BookSource): Promise<Buffer | undefined> {
  const { providerBook, torrentQuery, magnetOrHash } = source;

  if (providerBook) return acquireFromProvider(bookId, providerBook);

  if (torrentQuery) {
    const fromTorrentQuery = await acquireFromTorrentQuery(bookId, torrentQuery);
    if (fromTorrentQuery) return fromTorrentQuery;
  }

  if (!magnetOrHash) {
    throw new Error("No magnet, hash, or title query provided for ingestion.");
  }

  return acquireFromTorrent(bookId, magnetOrHash);
}

async function acquireFromTorrent(bookId: string, magnetOrHash: string): Promise<Buffer> {
  const downloaded = await downloadBookFromTorrent(magnetOrHash, (progressMessage) => {
    emitProgressEvent(bookId, "progress_log", { message: progressMessage });
  });
  return downloaded.buffer;
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
  if (!isZipBuffer(epubBuffer)) {
    throw new UnsupportedFormatError("The provider response is not a valid EPUB zip archive.");
  }
  return epubBuffer;
}

async function acquireFromTorrentQuery(bookId: string, query: { title: string; author: string }): Promise<Buffer | undefined> {
  const { title, author } = query;

  emitProgressEvent(bookId, "status_change", {
    status: "discovering",
    message: `Searching torrents for "${title}"...`,
  });

  const candidates = await searchTorrentCandidates(bookId, title, author);
  const fromCandidates = await downloadFromCandidates(bookId, candidates);
  if (fromCandidates) return fromCandidates;
  if (!title) return undefined;

  return downloadFromOpenLibraries(bookId, title, author);
}

async function searchTorrentCandidates(bookId: string, title: string, author: string): Promise<TorrentCandidate[]> {
  try {
    const liveCandidates = await resolveTorrentCandidates(title, author);
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

async function downloadFromCandidates(bookId: string, candidates: TorrentCandidate[]): Promise<Buffer | undefined> {
  if (candidates.length === 0) return undefined;

  try {
    const downloaded = await downloadBookFromCandidates(candidates, {}, (progressMessage) => {
      emitProgressEvent(bookId, "progress_log", { message: progressMessage });
    });
    return downloaded.buffer;
  } catch (error) {
    const message = errorMessage(error);
    console.warn(`⚠️ Torrent/IPFS candidates failed (${message}); attempting open digital library fallback...`);
    return undefined;
  }
}

async function downloadFromOpenLibraries(bookId: string, title: string, author: string): Promise<Buffer | undefined> {
  const onProgress = (progressMessage: string) => emitProgressEvent(bookId, "progress_log", { message: progressMessage });

  for (const { label, fetchEpub } of enabledLibrarySources()) {
    emitProgressEvent(bookId, "progress_log", { message: `Checking ${label} for "${title}"...` });
    const result = await fetchEpub(title, author, onProgress);
    if (result) return result.buffer;
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
