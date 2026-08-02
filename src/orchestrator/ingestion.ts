/**
 * Ingestion: acquire/load EPUB → parse → persist chapters + segments → queue
 * the opening lookahead window. Runs as the BullMQ "ingestion" processor.
 */
import { createHash } from "crypto";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { books, chapters, segments, castMembers } from "../schema";
import { downloadBookFromTorrent, searchBookTorrent } from "../torboxService";
import { bookProviders, UnsupportedFormatError } from "../acquisition";
import { parseEpub } from "../epubService";
import { segmentChapter } from "../segmentService";
import { downloadFile, uploadFile, deleteFile } from "../r2";
import { DEFAULT_NARRATOR_VOICE, EPUB_LIMITS, TORRENT } from "../lib/constants";
import { readStreamWithCap } from "../lib/readStream";
import { isZipBuffer } from "../lib/validators";
import { emitProgressEvent, enqueueIngestion, invalidateBookVoiceContextClusterwide, type IngestionJobData } from "../queue";
import { ensureLookahead } from "./lookahead";
import { maybeMarkBookComplete } from "./stitch";

/**
 * Enqueue a book ingestion. The EPUB for uploads must already be persisted
 * (books route stores it and sets books.epubR2Key) — job payloads carry no
 * buffers. BullMQ dedupes on the deterministic jobId, replacing the old
 * in-memory ingestingBookIds guard.
 */
export async function queueBookIngestion(bookId: string, source: IngestionJobData["source"]): Promise<void> {
  await enqueueIngestion(bookId, source);
}

/**
 * Ingestion processor: acquire/load EPUB → parse → persist structure →
 * enqueue one segment job per paragraph. Runs at most
 * QUEUE.INGESTION_CONCURRENCY at a time (each holds a whole EPUB buffer).
 * attempts=1: failures mark the book failed and are retried via the explicit
 * retry path (which wipes partial children first), same as before.
 */
export async function runIngestionJob(job: Job<IngestionJobData>): Promise<void> {
  const { bookId, source } = job.data;

  // Idempotent re-delivery / stale enqueue guard: ingestion only ever runs
  // on a book waiting to be discovered. (Retry flips failed → discovering
  // before re-enqueueing; a completed ingestion leaves in_progress/ready.)
  const book = await db.select().from(books).where(eq(books.id, bookId)).then((r) => r[0]);
  if (!book) return; // deleted while queued
  if (book.status !== "discovering") return;

  try {
    emitProgressEvent(bookId, "status_change", { status: "discovering", message: "Starting ingestion pipeline..." });

    let epubBuffer: Buffer | undefined;
    let bookTitle = "Unknown";
    let bookAuthor = "Unknown";
    let epubR2Key = book.epubR2Key;

    if (epubR2Key) {
      // Upload path / retry path: EPUB was persisted before enqueueing.
      epubBuffer = await downloadFile(epubR2Key);
    }

    if (!epubBuffer) {
      if (source.providerBook) {
        if (source.providerBook.format !== "epub") {
          throw new UnsupportedFormatError(`Only EPUB acquisition is supported; got ${source.providerBook.format}.`);
        }
        emitProgressEvent(bookId, "status_change", {
          status: "discovering",
          message: `Acquiring from ${source.providerBook.provider}...`,
        });
        const acquired = await bookProviders.get(source.providerBook.provider).acquire(source.providerBook);
        if (acquired.contentType && !/application\/epub\+zip|application\/zip|application\/octet-stream/i.test(acquired.contentType)) {
          throw new UnsupportedFormatError(`Unexpected provider content type: ${acquired.contentType}`);
        }
        const maxBytes = TORRENT.MAX_FILE_SIZE_BYTES;
        if (acquired.contentLength && acquired.contentLength > maxBytes) {
          throw new UnsupportedFormatError("The provider file exceeds the 200MB EPUB limit.");
        }
        epubBuffer = await readAcquiredEpub(acquired.stream, maxBytes, acquired.expectedSha256);
        if (!isZipBuffer(epubBuffer)) {
          throw new UnsupportedFormatError("The provider response is not a valid EPUB zip archive.");
        }
      }

      let magnet = source.magnetOrHash;
      if (!epubBuffer && source.torrentQuery) {
        const { title, author } = source.torrentQuery;
        emitProgressEvent(bookId, "status_change", {
          status: "discovering",
          message: `Searching torrents for "${title}"...`,
        });
        magnet = await searchBookTorrent(title, author);
      }

      if (!epubBuffer) {
        if (!magnet) {
          throw new Error("No magnet, hash, or title query provided for ingestion.");
        }
        const dlResult = await downloadBookFromTorrent(magnet, (progressMsg) => {
          emitProgressEvent(bookId, "progress_log", { message: progressMsg });
        });
        epubBuffer = dlResult.buffer;
      }
    }

    if (!epubBuffer) {
      throw new Error("Could not retrieve EPUB content buffer.");
    }

    // Parse EPUB
    emitProgressEvent(bookId, "status_change", {
      status: "discovering",
      message: "Parsing EPUB spine and contents...",
    });
    const parsedBook = parseEpub(epubBuffer);
    bookTitle = parsedBook.title;
    bookAuthor = parsedBook.author;

    // Upload original EPUB to storage immediately and persist the key, so a
    // crash anywhere below is resumable via retryFailedBook. Pre-persisted
    // uploads already have their key.
    let uploadedEpubHere = false;
    if (!epubR2Key) {
      epubR2Key = `books/${bookId}/original.epub`;
      await uploadFile(epubR2Key, epubBuffer, "application/epub+zip");
      uploadedEpubHere = true;
    }

    const bookStillThere = await db
      .update(books)
      .set({
        title: bookTitle,
        author: bookAuthor,
        epubR2Key: epubR2Key,
      })
      .where(eq(books.id, bookId))
      .returning({ id: books.id });
    if (bookStillThere.length === 0) {
      // The book was deleted while the download/parse was in flight.
      // deleteBook collected storage keys before this EPUB existed, so purge
      // the object we just uploaded or it orphans in storage permanently.
      if (uploadedEpubHere && epubR2Key) {
        await deleteFile(epubR2Key).catch((err) =>
          console.warn(`Could not purge EPUB of book deleted mid-ingestion (${bookId}):`, err)
        );
      }
      return;
    }

    await db
      .update(books)
      .set({
        title: bookTitle,
        author: bookAuthor,
        epubR2Key: epubR2Key,
      })
      .where(eq(books.id, bookId));

    // Single narrator voices the whole book — no casting step
    await db
      .insert(castMembers)
      .values({
        bookId,
        name: "Narrator",
        aliases: ["storyteller", "narrator"],
        importance: "main",
        voiceBucket: "female_adult",
        ttsVoiceName: DEFAULT_NARRATOR_VOICE,
        styleString: "warm neutral storyteller, clear, steady, pacing",
        pronunciationNotes: "Standard pronunciation",
      })
      .onConflictDoNothing({ target: [castMembers.bookId, castMembers.name] });
    // A retry may have raced a stale cached context — drop it so the next
    // segment worker reads the fresh narrator/pronunciation rows. Cluster-wide:
    // this worker may not be the instance that served the retry/pronunciation
    // write, and other instances' caches are just as stale.
    invalidateBookVoiceContextClusterwide(bookId);

    // Create chapters and segments in database
    emitProgressEvent(bookId, "status_change", {
      status: "in_progress",
      message: "Structuring chapters and segments...",
    });

    // Plan segmentation for the whole book up front (CPU-only) so chapters
    // and segments can be written in a few large batches instead of one
    // awaited round-trip per chapter (up to 2,000 sequential inserts).
    const planned = parsedBook.chapters.map((ch) => ({ ch, segs: segmentChapter(ch.blocks) }));
    if (planned.length === 0) {
      throw new Error("This book has no chapters to voice.");
    }
    let totalSegmentCount = 0;
    for (const p of planned) {
      if (p.segs.length > EPUB_LIMITS.MAX_SEGMENTS_PER_CHAPTER) {
        throw new Error(
          `A chapter produced too many segments (over ${EPUB_LIMITS.MAX_SEGMENTS_PER_CHAPTER}).`
        );
      }
      totalSegmentCount += p.segs.length;
      if (totalSegmentCount > EPUB_LIMITS.MAX_SEGMENTS_PER_BOOK) {
        throw new Error(
          `This book would produce too many segments (over ${EPUB_LIMITS.MAX_SEGMENTS_PER_BOOK}).`
        );
      }
    }

    // One multi-row chapter insert. Empty chapters (decorative/blank spine
    // items) are marked terminal now so they never block book completion
    // (see runStitchJob's empty-state guard).
    const chapterRows = await db
      .insert(chapters)
      .values(
        planned.map((p) => ({
          bookId,
          chapterIndex: p.ch.chapterIndex,
          title: p.ch.title,
          status: (p.segs.length === 0 ? "failed" : "queued") as "failed" | "queued",
          totalCount: p.segs.length,
        }))
      )
      .returning({ id: chapters.id, chapterIndex: chapters.chapterIndex });
    const chapterIdByIndex = new Map(chapterRows.map((r) => [r.chapterIndex, r.id]));

    // Segments in bounded batches (parameter-count friendly). Every segment
    // starts as "pending" — deliberately NOT scheduled. Only the lookahead
    // window ahead of the listener is ever promoted to "queued" and given a
    // BullMQ job (see ensureLookahead), so we never pay to voice parts of the
    // book the user never listens to.
    const SEGMENT_INSERT_BATCH = 2000;
    let segmentBatch: Array<{
      chapterId: string;
      segmentIndex: number;
      rawText: string;
      status: "pending";
      isSceneBreak: number;
    }> = [];
    const flushSegments = async () => {
      if (segmentBatch.length === 0) return;
      await db.insert(segments).values(segmentBatch);
      segmentBatch = [];
    };
    for (const p of planned) {
      const chapterId = chapterIdByIndex.get(p.ch.chapterIndex)!;
      for (const seg of p.segs) {
        segmentBatch.push({
          chapterId,
          segmentIndex: seg.segmentIndex,
          rawText: seg.text,
          status: "pending",
          isSceneBreak: seg.isSceneBreak ? 1 : 0,
        });
        if (segmentBatch.length >= SEGMENT_INSERT_BATCH) {
          await flushSegments();
        }
      }
    }
    await flushSegments();

    // Surface empty chapters the same way the row-by-row path did.
    for (const p of planned) {
      if (p.segs.length === 0) {
        emitProgressEvent(bookId, "chapter_status", {
          chapterId: chapterIdByIndex.get(p.ch.chapterIndex)!,
          status: "failed",
          chapterIndex: p.ch.chapterIndex,
          error: "Chapter has no segments to voice",
        });
      }
    }

    // Update book status to in_progress
    await db.update(books).set({ status: "in_progress" }).where(eq(books.id, bookId));
    emitProgressEvent(bookId, "status_change", {
      status: "in_progress",
      message: "Book initialized. Scheduling audio synthesis...",
    });

    // Prime only the opening lookahead window (the first LOOKAHEAD_SEGMENTS
    // lines) for fast first-audio. The rest of the book stays "pending" until
    // the listener starts a chapter — ensureChapterLookahead then voices the
    // current chapter fully plus the next, capping TTS spend at two chapters
    // ahead instead of transcribing the whole book.
    await ensureLookahead(bookId);

    // A book whose chapters ALL produced zero segments has no segment or
    // stitch jobs at all, so nothing else can ever mark it complete — it
    // would sit "in_progress" forever. Finalize it now (idempotent).
    if (totalSegmentCount === 0) {
      await maybeMarkBookComplete(bookId);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Ingestion failed for Book ${bookId}:`, error);
    await db.update(books).set({ status: "failed" }).where(eq(books.id, bookId));
    // Emit only a generic failure reason to clients; details (R2 bucket/path,
    // provider errors) stay server-side. Map a few known classes for UX.
    let reason = "Ingestion failed unexpectedly.";
    if (/torrent|torbox/i.test(msg)) reason = "Could not download this book. Try a different search or upload an EPUB.";
    else if (/epub|parse|spine/i.test(msg)) reason = "This book's EPUB could not be parsed.";
    else if (/too short|word count/i.test(msg)) reason = msg;
    emitProgressEvent(bookId, "status_change", { status: "failed", error: reason });
  }
}

async function readAcquiredEpub(stream: ReadableStream<Uint8Array>, maxBytes: number, expectedSha256?: string): Promise<Buffer> {
  const hash = createHash("sha256");
  const buffer = await readStreamWithCap(
    stream,
    maxBytes,
    () => new UnsupportedFormatError("The provider file exceeds the 200MB EPUB limit."),
    (chunk) => hash.update(chunk)
  );
  if (expectedSha256 && hash.digest("hex").toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new UnsupportedFormatError("Provider file hash verification failed.");
  }
  return buffer;
}
