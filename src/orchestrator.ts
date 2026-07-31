import { createHash } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import type { Job } from "bullmq";
import { db } from "./db";
import { books, chapters, segments, castMembers, pronunciationDict } from "./schema";
import { eq, and, or, gt, gte, asc, desc, lt, inArray, isNotNull, sql } from "drizzle-orm";
import { downloadBookFromTorrent, searchBookTorrent } from "./torboxService";
import { bookProviders, UnsupportedFormatError } from "./acquisition";
import { parseEpub } from "./epubService";
import { segmentChapter } from "./segmentService";
import { annotateSegment, createNeutralBeat, extractBeats } from "./annotationService";
import { stitchChapter } from "./stitchService";
import { deleteFile, downloadFile, uploadFile } from "./r2";
import { DEFAULT_NARRATOR_VOICE, EPUB_LIMITS, PIPELINE, QUEUE, TEMP, TORRENT } from "./lib/constants";
import { synthesizeSegmentAudio } from "./lib/voiceSegment";
import { getBookVoiceContext, invalidateBookVoiceContext } from "./lib/bookCache";
import {
  emitProgressEvent,
  enqueueIngestion,
  enqueueSegmentJobs,
  enqueueStitch,
  initEventBridge,
  pingRedis,
  pipelineEvents,
  removeBookJobs,
  scheduleSweep,
  segmentJobId,
  segmentQueue,
  startWorkers,
  stopPipeline,
  type IngestionJobData,
  type SegmentJobData,
  type StitchJobData,
} from "./queue";

// Re-exported so existing consumers (SSE route, segment route) keep their imports.
export { pipelineEvents, emitProgressEvent };

/**
 * Pipeline orchestration on top of the durable BullMQ queues (see queue.ts).
 *
 * State vs. scheduling split:
 * - Postgres owns pipeline STATE: segment/chapter/book status, terminal
 *   counters. The atomic segment claim (queued → processing) remains the
 *   final guard against double execution — BullMQ can re-deliver a job
 *   (stalled recovery), the DB claim cannot be fooled by it.
 * - Redis/BullMQ owns SCHEDULING: ordering (priority = chapterIndex), retries
 *   with durable backoff, distribution across instances, stalled recovery.
 *
 * Recovery layers (no in-memory state is required for correctness):
 * 1. BullMQ stalled-job detection re-runs jobs of a dead worker (~30-60s).
 * 2. The segment processor resets its own row on retry (attemptsMade > 0),
 *    covering the crash-between-claim-and-failure-handler window.
 * 3. The maintenance sweep (every QUEUE.SWEEP_INTERVAL_MS) requeues DB rows
 *    left mid-flight whose job no longer exists, refills the queue after
 *    Redis data loss, re-enqueues due stitches, and fails stuck ingestions.
 * 4. resumePendingWork() at boot repairs counters and re-enqueues all queued
 *    segments (jobId dedupe makes this idempotent).
 */

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

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
async function runIngestionJob(job: Job<IngestionJobData>): Promise<void> {
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
        if (epubBuffer.length < 4 || epubBuffer.readUInt32LE(0) !== 0x04034b50) {
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
    if (!epubR2Key) {
      epubR2Key = `books/${bookId}/original.epub`;
      await uploadFile(epubR2Key, epubBuffer, "application/epub+zip");
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
    // segment worker reads the fresh narrator/pronunciation rows.
    invalidateBookVoiceContext(bookId);

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
    // lines). Playback position syncs re-center and top up the window from
    // here on; the DB rows above remain the system of record.
    await ensureLookahead(bookId);
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
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  const hash = createHash("sha256");
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new UnsupportedFormatError("The provider file exceeds the 200MB EPUB limit.");
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      hash.update(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = Buffer.concat(chunks);
  if (expectedSha256 && hash.digest("hex").toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new UnsupportedFormatError("Provider file hash verification failed.");
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Segment voicing
// ---------------------------------------------------------------------------

/**
 * Atomically claim a segment for this worker.
 * Returns null if another worker already claimed it (or it was deleted).
 */
async function claimSegment(segmentId: string) {
  const claimed = await db
    .update(segments)
    .set({ status: "processing" })
    .where(and(eq(segments.id, segmentId), eq(segments.status, "queued")))
    .returning();
  return claimed[0] ?? null;
}

/**
 * Segment processor: Annotation -> TTS beat generations -> merge -> upload.
 * BullMQ owns retries with durable exponential backoff (previously in-memory
 * setTimeout, lost on crash); the DB attempts column is kept in sync for
 * observability and the sweeper's exhaustion check.
 */
async function runSegmentJob(job: Job<SegmentJobData>): Promise<void> {
  const { bookId, chapterId, segmentId } = job.data;

  try {
    // Crash-window recovery: a retry (attemptsMade > 0) can follow a crash
    // that left the row claimed mid-flight (between the atomic claim and the
    // failure handler). Reset it so the claim below can succeed. A live
    // worker holding this exact job is impossible — BullMQ runs one job
    // record on one worker at a time.
    if (job.attemptsMade > 0) {
      await db
        .update(segments)
        .set({ status: "queued" })
        .where(and(eq(segments.id, segmentId), inArray(segments.status, ["processing", "annotated"])));
    }

    // Atomic claim — prevents double TTS if the same ID was enqueued twice
    const segmentData = await claimSegment(segmentId);
    if (!segmentData) {
      return;
    }

    const chapterData = await db
      .select()
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .then((rows) => rows[0]);

    if (!chapterData) {
      // Book/chapter was deleted while the job was in flight. Not an error —
      // do not burn retry attempts on it.
      console.warn(`⚠️ Segment job ${segmentId}: chapter ${chapterId} gone (book deleted?). Skipping.`);
      return;
    }

    const chapterIndex = chapterData.chapterIndex;

    // Narrator + pronunciation dict are per-book invariants — served from the
    // short-TTL cache instead of two Postgres queries per segment.
    const { narratorId, narratorVoice, narratorBaseStyle, pDict } =
      await getBookVoiceContext(bookId);

    // Mark chapter processing
    if (chapterData.status === "queued") {
      await db.update(chapters).set({ status: "processing" }).where(eq(chapters.id, chapterId));
      emitProgressEvent(bookId, "chapter_status", {
        chapterId,
        status: "processing",
        chapterIndex,
      });
    }

    // Previous 2 segments by index (true narrative context, not "any voiced").
    // Bounded queries via the (chapterId, segmentIndex) index — the old
    // "fetch every prior segment's full text, keep the last two" scan made
    // annotation context O(segments²) row reads per chapter.
    const prevSegs = await db
      .select({ rawText: segments.rawText })
      .from(segments)
      .where(
        and(eq(segments.chapterId, chapterId), lt(segments.segmentIndex, segmentData.segmentIndex))
      )
      .orderBy(desc(segments.segmentIndex))
      .limit(2);
    const prevTexts = prevSegs.map((s) => s.rawText).reverse();

    // Running summary from the nearest prior segment that has one
    const summaryRow = await db
      .select({ sceneSummary: segments.sceneSummary })
      .from(segments)
      .where(
        and(
          eq(segments.chapterId, chapterId),
          lt(segments.segmentIndex, segmentData.segmentIndex),
          isNotNull(segments.sceneSummary)
        )
      )
      .orderBy(desc(segments.segmentIndex))
      .limit(1)
      .then((rows) => rows[0]);
    const runningSummary = summaryRow?.sceneSummary || "A scene in the book.";

    // Annotate if needed (reuse prior annotation when present)
    let beats = extractBeats(segmentData.annotatedJson);
    let sceneSummary = segmentData.sceneSummary || runningSummary;

    if (beats.length === 0) {
      try {
        const annotationRes = await annotateSegment(
          segmentData.rawText,
          prevTexts,
          runningSummary
        );

        beats = annotationRes.beats;
        sceneSummary = annotationRes.scene_summary || runningSummary;
      } catch (err) {
        // Annotation failure must not burn a segment attempt — voice it plainly
        console.warn(
          `⚠️ Annotation failed for segment ${segmentId}; falling back to a single neutral beat.`,
          err
        );
      }

      if (beats.length === 0) {
        beats = [createNeutralBeat(segmentData.rawText)];
      }

      await db
        .update(segments)
        .set({
          annotatedJson: { scene_summary: sceneSummary, beats },
          sceneSummary,
          speakerCastId: narratorId,
          status: "annotated",
        })
        .where(eq(segments.id, segmentId));
    } else {
      await db
        .update(segments)
        .set({ status: "annotated" })
        .where(eq(segments.id, segmentId));
    }

    if (!beats || beats.length === 0) {
      throw new Error("No beats available for TTS after annotation");
    }

    console.log(`🎙️ Voicing segment ${segmentData.segmentIndex} (contains ${beats.length} beats)`);

    // Beats synthesize CONCURRENTLY (the TTS provider's global slot limiter
    // still bounds total in-flight requests account-wide) and merge in
    // memory — no per-segment ffmpeg spawn unless a WAV can't be spliced.
    const { wav: finalBytes, durationMs } = await synthesizeSegmentAudio(beats, {
      narratorVoice,
      narratorBaseStyle,
      pDict,
      tempDirPrefix: "seg_tts_",
      onBeatStart: (i, total) => {
        emitProgressEvent(bookId, "progress_log", {
          message: `Synthesizing segment ${segmentData.segmentIndex}, part ${i + 1} of ${total}...`,
        });
      },
    });

    const segmentR2Key = `books/${bookId}/chapters/ch_${chapterIndex}/segment_${segmentData.segmentIndex}.wav`;
    await uploadFile(segmentR2Key, finalBytes, "audio/wav");

    // Duplicate-execution guard: a stalled-job race (worker frozen past its
    // lock, job recovered elsewhere) could run TTS twice for one segment.
    // Only the execution that flips the row to "voiced" may bump counters —
    // the other stops here. (Cost of the race: one duplicate synthesis.)
    const voicedRows = await db
      .update(segments)
      .set({
        audioR2Key: segmentR2Key,
        durationMs,
        status: "voiced",
      })
      .where(and(eq(segments.id, segmentId), sql`${segments.status} != 'voiced'`))
      .returning({ id: segments.id });
    if (voicedRows.length === 0) {
      console.warn(`⚠️ Segment ${segmentId} was already voiced by a duplicate execution — skipping counter update.`);
      return;
    }

    // Atomically bump the chapter's terminal counter; the fresh counters drive
    // progress events and the stitch/partial-ready decisions — replacing the
    // old "re-select every segment of the chapter" per completion (O(n) → O(1)).
    const counters = await db
      .update(chapters)
      .set({ voicedCount: sql`${chapters.voicedCount} + 1` })
      .where(eq(chapters.id, chapterId))
      .returning({
        voicedCount: chapters.voicedCount,
        failedCount: chapters.failedCount,
        totalCount: chapters.totalCount,
      })
      .then((rows) => rows[0]);
    const progress = counters ?? { voicedCount: 0, failedCount: 0, totalCount: 0 };

    // Absolute chapter progress so the UI never drifts on reconnect/duplicate events
    emitProgressEvent(bookId, "segment_ready", {
      chapterId,
      chapterIndex,
      segmentId,
      segmentIndex: segmentData.segmentIndex,
      audioR2Key: segmentR2Key,
      done: progress.voicedCount,
      total: progress.totalCount,
      voicedCount: progress.voicedCount,
    });

    // Partial ready only when the leading consecutive segments are voiced
    await maybeMarkPartialReady(bookId, chapterId, chapterIndex, chapterData.status, progress);

    // Stitch once every segment is terminal (voiced or permanently failed)
    if (
      progress.totalCount > 0 &&
      progress.voicedCount + progress.failedCount >= progress.totalCount
    ) {
      await enqueueStitch({ bookId, chapterId, chapterIndex });
    }
  } catch (error: unknown) {
    console.error(`❌ Failed to voice segment ${segmentId}:`, error);

    const attempts = job.attemptsMade + 1;
    const permanentlyFailed = attempts >= PIPELINE.MAX_SEGMENT_ATTEMPTS;

    if (permanentlyFailed) {
      // Fail only this segment — keep the chapter playable for voiced lines.
      // Only bump failedCount when THIS execution flipped the row to failed
      // (guards a stalled-job race where two attempts both hit the terminal path).
      const newlyFailed = await db
        .update(segments)
        .set({ attempts, status: "failed" })
        .where(and(eq(segments.id, segmentId), sql`${segments.status} != 'failed'`))
        .returning({ id: segments.id });

      if (newlyFailed.length > 0) {
        emitProgressEvent(bookId, "segment_failed", {
          segmentId,
          chapterId,
          error: "Narration failed for this paragraph. You can retry it from the reading view.",
        });
        const counters = await db
          .update(chapters)
          .set({ failedCount: sql`${chapters.failedCount} + 1` })
          .where(eq(chapters.id, chapterId))
          .returning({
            voicedCount: chapters.voicedCount,
            failedCount: chapters.failedCount,
            totalCount: chapters.totalCount,
          })
          .then((rows) => rows[0]);
        if (
          counters &&
          counters.totalCount > 0 &&
          counters.voicedCount + counters.failedCount >= counters.totalCount
        ) {
          await enqueueStitch({ bookId, chapterId, chapterIndex: job.data.chapterIndex });
        }
      }
    } else {
      // Non-terminal failures go back to "queued" so BullMQ's delayed retry can
      // re-claim them; the backoff itself lives in Redis (survives restarts),
      // replacing the old in-memory setTimeout re-queue.
      await db
        .update(segments)
        .set({ attempts, status: "queued" })
        .where(eq(segments.id, segmentId));
      console.log(
        `⏳ Segment ${segmentId} requeued by BullMQ backoff (attempt ${attempts}/${PIPELINE.MAX_SEGMENT_ATTEMPTS})`
      );
    }

    // Let BullMQ record the failure and schedule the next delayed attempt.
    throw error;
  }
}

/**
 * Unlock progressive "Listen Live" playback once the leading segment window is ready.
 * Default window is 1 segment so listeners can start as soon as the first line is voiced.
 */
async function maybeMarkPartialReady(
  bookId: string,
  chapterId: string,
  chapterIndex: number,
  currentStatus: string,
  counters: { voicedCount: number; failedCount: number; totalCount: number }
) {
  if (currentStatus !== "processing" && currentStatus !== "queued") return;

  const threshold = PIPELINE.PARTIAL_READY_THRESHOLD;

  if (counters.totalCount <= threshold) {
    // Chapter has fewer segments than the unlock window: require the whole
    // chapter terminal with at least one playable line (a single permanent
    // failure must not block progressive playback forever).
    if (counters.totalCount === 0) return;
    if (counters.voicedCount + counters.failedCount < counters.totalCount) return;
    if (counters.voicedCount === 0) return;
  } else {
    const leadingIndexes = Array.from({ length: threshold }, (_, i) => i + 1);
    const leading = await db
      .select({ status: segments.status, segmentIndex: segments.segmentIndex })
      .from(segments)
      .where(and(eq(segments.chapterId, chapterId), inArray(segments.segmentIndex, leadingIndexes)));

    // Unlock once the leading window is terminal and at least one line is playable
    const windowDone =
      leading.length > 0 && leading.every((s) => s.status === "voiced" || s.status === "failed");
    const anyPlayable = leading.some((s) => s.status === "voiced");
    if (!windowDone || !anyPlayable) return;
  }

  // Re-read chapter to avoid overwriting ready/failed
  const ch = await db
    .select({ status: chapters.status })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .then((r) => r[0]);
  if (!ch || ch.status === "ready" || ch.status === "partial_ready" || ch.status === "failed") {
    return;
  }

  await db.update(chapters).set({ status: "partial_ready" }).where(eq(chapters.id, chapterId));
  emitProgressEvent(bookId, "chapter_status", {
    chapterId,
    status: "partial_ready",
    chapterIndex,
  });
}

// ---------------------------------------------------------------------------
// Chapter stitching
// ---------------------------------------------------------------------------

/**
 * Stitch processor. The deterministic jobId (`stitch:{chapterId}`) is the
 * concurrency guard — BullMQ dedupes enqueue calls atomically, so a chapter
 * can never have two queued/running stitch jobs, across ANY number of
 * instances (replacing the per-process stitchingChapters Set). Retries with
 * durable fixed backoff replace the in-memory attempt counter + setTimeout.
 */
async function runStitchJob(job: Job<StitchJobData>): Promise<void> {
  const { bookId, chapterId, chapterIndex } = job.data;

  const ch = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .then((r) => r[0]);
  if (!ch || ch.status === "ready") return;

  if (ch.totalCount === 0) {
    // A chapter with no segments (e.g. a decorative/blank EPUB spine item)
    // must still reach a terminal state, otherwise maybeMarkBookComplete
    // waits forever for it and the whole book is stuck in "in_progress".
    if (ch.status !== "failed") {
      await db.update(chapters).set({ status: "failed" }).where(eq(chapters.id, chapterId));
      emitProgressEvent(bookId, "chapter_status", {
        chapterId,
        status: "failed",
        chapterIndex,
        error: "Chapter has no segments to voice",
      });
      await maybeMarkBookComplete(bookId);
    }
    return;
  }

  // Terminal = every segment is voiced or permanently failed. A stale or
  // early stitch job simply goes away; the next segment completion (or the
  // sweep) enqueues a fresh one when the chapter is actually done.
  if (ch.voicedCount + ch.failedCount < ch.totalCount) return;

  if (ch.voicedCount === 0) {
    // Nothing usable — mark chapter failed without blocking the rest of the book
    if (ch.status !== "failed") {
      await db.update(chapters).set({ status: "failed" }).where(eq(chapters.id, chapterId));
      emitProgressEvent(bookId, "chapter_status", {
        chapterId,
        status: "failed",
        chapterIndex,
        error: "All segments failed to generate",
      });
      await maybeMarkBookComplete(bookId);
    }
    return;
  }

  try {
    emitProgressEvent(bookId, "chapter_status", {
      chapterId,
      status: "processing",
      message: "Stitching chapter segments...",
      chapterIndex,
    });

    const voicedSegments = await db
      .select({ audioR2Key: segments.audioR2Key, isSceneBreak: segments.isSceneBreak })
      .from(segments)
      .where(and(eq(segments.chapterId, chapterId), eq(segments.status, "voiced")))
      .orderBy(asc(segments.segmentIndex))
      .then((rows) => rows.filter((s) => s.audioR2Key));
    if (voicedSegments.length === 0) return;

    const stitchResult = await stitchChapter(
      bookId,
      chapterIndex,
      voicedSegments.map((s) => ({
        audioR2Key: s.audioR2Key!,
        isSceneBreak: s.isSceneBreak === 1,
      }))
    );

    await db
      .update(chapters)
      .set({
        status: "ready",
        audioR2Key: stitchResult.r2Key,
        durationMs: stitchResult.durationMs,
      })
      .where(eq(chapters.id, chapterId));

    emitProgressEvent(bookId, "chapter_status", {
      chapterId,
      status: "ready",
      chapterIndex,
      audioR2Key: stitchResult.r2Key,
      durationMs: stitchResult.durationMs,
    });

    await maybeMarkBookComplete(bookId);
  } catch (err) {
    console.error(`Chapter stitch failed for ${chapterId}:`, err);

    if (job.attemptsMade + 1 >= QUEUE.MAX_STITCH_ATTEMPTS) {
      // Exhausted — give up rather than retry forever (disk full, R2 outage,
      // corrupt audio). Mark the chapter failed so the book can still resolve.
      console.error(
        `Chapter stitch for ${chapterId} exhausted ${QUEUE.MAX_STITCH_ATTEMPTS} attempts; marking failed.`
      );
      try {
        const chFail = await db
          .select()
          .from(chapters)
          .where(eq(chapters.id, chapterId))
          .then((r) => r[0]);
        if (chFail && chFail.status !== "ready") {
          await db.update(chapters).set({ status: "failed" }).where(eq(chapters.id, chapterId));
          emitProgressEvent(bookId, "chapter_status", {
            chapterId,
            status: "failed",
            chapterIndex,
            error: "Chapter stitching failed repeatedly",
          });
          await maybeMarkBookComplete(bookId);
        }
      } catch (failErr) {
        console.error(`Failed to mark chapter ${chapterId} as failed after stitch exhaustion:`, failErr);
      }
    }

    // Rethrow so BullMQ records the failure and schedules the next attempt.
    throw err;
  }
}

/**
 * Re-stitch a chapter in the background after a segment regeneration.
 * Enqueueing through the durable queue shares the stitch:{chapterId} jobId
 * guard with the pipeline, so it can never overlap a pipeline stitch (or
 * another regen re-stitch) for this chapter — on any instance.
 */
export function restitchChapterInBackground(bookId: string, chapterId: string, chapterIndex: number): void {
  enqueueStitch({ bookId, chapterId, chapterIndex }).catch((err) =>
    console.error("Failed to enqueue re-stitch after regeneration:", err)
  );
}

/** Mark book ready when every chapter is terminal (ready or failed). */
async function maybeMarkBookComplete(bookId: string) {
  // Single aggregate row instead of fetching every chapter row (up to 2,000)
  // on each chapter completion.
  const stats = await db
    .select({
      total: sql<number>`count(*)::int`,
      terminal: sql<number>`count(*) filter (where ${chapters.status} in ('ready', 'failed'))::int`,
      ready: sql<number>`count(*) filter (where ${chapters.status} = 'ready')::int`,
    })
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .then((rows) => rows[0]);
  if (!stats || stats.total === 0) return;
  if (stats.terminal < stats.total) return;

  const anyReady = stats.ready > 0;
  const nextStatus = anyReady ? "ready" : "failed";

  await db.update(books).set({ status: nextStatus }).where(eq(books.id, bookId));
  emitProgressEvent(bookId, "status_change", {
    status: nextStatus,
    message: anyReady
      ? "Your book performance is fully generated!"
      : "Book performance failed — no chapters could be generated.",
  });
}

// ---------------------------------------------------------------------------
// Maintenance sweep (runs every QUEUE.SWEEP_INTERVAL_MS via the repeatable job)
// ---------------------------------------------------------------------------

/** Job states in which BullMQ owns the row's lifecycle — never touch these. */
const LIVE_JOB_STATES = new Set(["wait", "delayed", "prioritized", "active", "waiting-children"]);

/**
 * Self-healing pass over DB state that outlived its queue job. Each check is
 * idempotent and safe to run on any instance at any time:
 * 1. Segments stuck processing/annotated whose job is gone (Redis data loss,
 *    stalled-out jobs) → requeue (or fail when attempts are exhausted).
 * 2. Queue depth near zero while the DB still has queued rows (Redis flush)
 *    → re-materialize segment jobs from the DB.
 * 3. Chapters that are counter-terminal but never stitched → enqueue stitch.
 * 4. Books stuck "discovering" beyond INGESTION_STUCK_MS → failed.
 */
export async function runPipelineSweep(): Promise<void> {
  // 1. Orphaned mid-flight segments. Bounded: normally this set is tiny
  //    (≤ live workers), so a per-row getJob is cheap.
  const midflight = await db
    .select({
      segmentId: segments.id,
      chapterId: chapters.id,
      bookId: chapters.bookId,
      chapterIndex: chapters.chapterIndex,
      segmentIndex: segments.segmentIndex,
      attempts: segments.attempts,
    })
    .from(segments)
    .innerJoin(chapters, eq(segments.chapterId, chapters.id))
    .where(inArray(segments.status, ["processing", "annotated"]))
    .limit(500);

  for (const row of midflight) {
    try {
      const job = await segmentQueue.getJob(segmentJobId(row.segmentId));
      const state = job ? await job.getState() : "unknown";
      if (LIVE_JOB_STATES.has(state)) continue; // BullMQ owns it (incl. stalled recovery)
      // The job is gone or terminally failed — the row is orphaned.
      if (job) await job.remove().catch(() => {});
      if (row.attempts >= PIPELINE.MAX_SEGMENT_ATTEMPTS) {
        const newlyFailed = await db
          .update(segments)
          .set({ status: "failed" })
          .where(and(eq(segments.id, row.segmentId), sql`${segments.status} != 'failed'`))
          .returning({ id: segments.id });
        if (newlyFailed.length > 0) {
          const counters = await db
            .update(chapters)
            .set({ failedCount: sql`${chapters.failedCount} + 1` })
            .where(eq(chapters.id, row.chapterId))
            .returning({
              voicedCount: chapters.voicedCount,
              failedCount: chapters.failedCount,
              totalCount: chapters.totalCount,
            })
            .then((rows) => rows[0]);
          if (counters && counters.totalCount > 0 && counters.voicedCount + counters.failedCount >= counters.totalCount) {
            await enqueueStitch({ bookId: row.bookId, chapterId: row.chapterId, chapterIndex: row.chapterIndex });
          }
        }
        console.warn(`🧹 Sweep marked orphaned segment ${row.segmentId} failed (job state: ${state}).`);
      } else {
        await db.update(segments).set({ status: "queued" }).where(eq(segments.id, row.segmentId));
        await enqueueSegmentJobs([row]);
        console.warn(`🧹 Sweep requeued orphaned segment ${row.segmentId} (job state: ${state}).`);
      }
    } catch (err) {
      console.error(`Sweep failed for segment ${row.segmentId}:`, err);
    }
  }

  // 2. Watermark refill: the queue should hold work whenever the DB does.
  const counts = await segmentQueue.getJobCounts("wait", "active", "delayed", "prioritized");
  const depth = counts.wait + counts.active + counts.delayed + counts.prioritized;
  if (depth < QUEUE.QUEUED_REFILL_WATERMARK) {
    const queuedRows = await db
      .select({
        segmentId: segments.id,
        chapterId: chapters.id,
        bookId: chapters.bookId,
        chapterIndex: chapters.chapterIndex,
        segmentIndex: segments.segmentIndex,
      })
      .from(segments)
      .innerJoin(chapters, eq(segments.chapterId, chapters.id))
      .innerJoin(books, eq(chapters.bookId, books.id))
      .where(and(eq(segments.status, "queued"), eq(books.status, "in_progress")))
      .orderBy(asc(chapters.bookId), asc(chapters.chapterIndex), asc(segments.segmentIndex))
      .limit(2000);
    if (queuedRows.length > 0) {
      await enqueueSegmentJobs(queuedRows);
      console.log(`🧹 Sweep refilled ${queuedRows.length} queued segment job(s) (queue depth was ${depth}).`);
    }
  }

  // 3. Chapters that finished voicing but never stitched.
  const stitchCandidates = await db
    .select()
    .from(chapters)
    .where(inArray(chapters.status, ["processing", "partial_ready"]))
    .limit(500);
  for (const ch of stitchCandidates) {
    try {
      await enqueueStitch({ bookId: ch.bookId, chapterId: ch.id, chapterIndex: ch.chapterIndex });
    } catch (err) {
      console.error(`Failed to enqueue stitch for chapter ${ch.id} during sweep:`, err);
    }
  }

  // 4. Ingestions whose worker died before marking the book failed.
  const stuckBefore = new Date(Date.now() - QUEUE.INGESTION_STUCK_MS);
  const interrupted = await db
    .update(books)
    .set({ status: "failed" })
    .where(and(inArray(books.status, ["discovering", "casting"]), lt(books.createdAt, stuckBefore)))
    .returning({ id: books.id });
  for (const book of interrupted) {
    emitProgressEvent(book.id, "status_change", { status: "failed", error: "Ingestion was interrupted. Use Retry." });
  }
  if (interrupted.length > 0) {
    console.warn(`⚠️ Sweep marked ${interrupted.length} stuck ingestion(s) as failed.`);
  }
}

// ---------------------------------------------------------------------------
// Boot recovery
// ---------------------------------------------------------------------------

/**
 * Best-effort sweep of orphaned pipeline temp dirs (seg_tts_*, seg_regen_*,
 * stitch_*) left in os.tmpdir() by a crashed/killed process. Per-job finally
 * blocks remain the primary cleanup path; this only removes dirs older than
 * TEMP.SWEEP_AGE_MS so a still-running job is never touched.
 */
async function cleanupStaleTempDirs() {
  let entries: string[];
  try {
    entries = await fs.readdir(tmpdir());
  } catch (err) {
    console.warn("⚠️ Could not scan os.tmpdir() for stale pipeline dirs:", err);
    return;
  }

  const now = Date.now();
  let removed = 0;
  for (const entry of entries) {
    if (!TEMP.DIR_PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;
    const fullPath = path.join(tmpdir(), entry);
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isDirectory()) continue;
      if (now - stat.mtimeMs < TEMP.SWEEP_AGE_MS) continue;
      await fs.rm(fullPath, { recursive: true, force: true });
      removed++;
    } catch {
      // best-effort: ignore per-entry failures
    }
  }
  if (removed > 0) {
    console.log(`🧹 Swept ${removed} stale pipeline temp dir(s) from os.tmpdir().`);
  }
}

/**
 * Boot-time recovery. Multi-instance safe: unlike the old in-process version
 * it does NOT blanket-reset mid-flight rows — another instance may be
 * legitimately processing them. Live jobs are owned by BullMQ (stalled
 * recovery re-runs dead workers' jobs within ~a minute); rows whose job is
 * gone entirely are handled by the sweep, which also runs once here.
 */
export async function resumePendingWork() {
  console.log("🔄 Checking for pending pipeline work...");

  await cleanupStaleTempDirs();

  // Recompute chapter counters from ground truth. Atomic increments keep them
  // exact at runtime; this boot-time sweep repairs anything left inconsistent
  // by a crash (e.g. segments force-failed without bumping counters).
  await db.execute(sql`
    UPDATE chapters c
    SET total_count = COALESCE(s.total, 0),
        voiced_count = COALESCE(s.voiced, 0),
        failed_count = COALESCE(s.failed, 0)
    FROM (
      SELECT chapter_id,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'voiced')::int AS voiced,
             COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM segments
      GROUP BY chapter_id
    ) s
    WHERE c.id = s.chapter_id
  `);
  await db.execute(sql`
    UPDATE chapters c
    SET total_count = 0, voiced_count = 0, failed_count = 0
    WHERE NOT EXISTS (SELECT 1 FROM segments s WHERE s.chapter_id = c.id)
  `);

  // Re-enqueue every queued segment of every in-progress book. Deterministic
  // jobIds make this idempotent: jobs still in Redis are not duplicated, and
  // jobs lost to a Redis flush are recreated. This is what makes "restart the
  // server" sufficient recovery for any queue-level loss. ("pending" rows are
  // deliberately untouched: they have no job by design — the lookahead window
  // promotes them only as listening approaches.)
  let offset = 0;
  const PAGE = 5000;
  for (;;) {
    const queuedRows = await db
      .select({
        segmentId: segments.id,
        chapterId: chapters.id,
        bookId: chapters.bookId,
        chapterIndex: chapters.chapterIndex,
        segmentIndex: segments.segmentIndex,
      })
      .from(segments)
      .innerJoin(chapters, eq(segments.chapterId, chapters.id))
      .innerJoin(books, eq(chapters.bookId, books.id))
      .where(and(eq(segments.status, "queued"), eq(books.status, "in_progress")))
      .orderBy(asc(segments.id))
      .limit(PAGE)
      .offset(offset);
    if (queuedRows.length === 0) break;
    await enqueueSegmentJobs(queuedRows);
    offset += queuedRows.length;
    if (queuedRows.length < PAGE) break;
  }
  if (offset > 0) {
    console.log(`♻️ Re-enqueued ${offset} queued segment job(s) from the DB.`);
  }

  // One immediate sweep for orphaned mid-flight rows, due stitches, and
  // stuck ingestions (the periodic sweep continues from here).
  await runPipelineSweep();
}

// ---------------------------------------------------------------------------
// Book lifecycle
// ---------------------------------------------------------------------------

/**
 * Delete a book, its queued jobs, and its stored files.
 */
export async function deleteBook(bookId: string): Promise<boolean> {
  const existing = await db.select().from(books).where(eq(books.id, bookId)).then((r) => r[0]);
  if (!existing) return false;

  // Collect job ids before the cascade wipes the rows. Only queued segments
  // have removable jobs; active jobs are locked and will no-op against the
  // deleted rows (claim finds nothing, chapter lookup finds nothing).
  const [chapterRows, segmentRows] = await Promise.all([
    db
      .select({ id: chapters.id, audioR2Key: chapters.audioR2Key })
      .from(chapters)
      .where(eq(chapters.bookId, bookId)),
    db
      .select({ id: segments.id, audioR2Key: segments.audioR2Key })
      .from(segments)
      .innerJoin(chapters, eq(segments.chapterId, chapters.id))
      .where(eq(chapters.bookId, bookId)),
  ]);
  await removeBookJobs(
    bookId,
    segmentRows.map((r) => r.id),
    chapterRows.map((r) => r.id)
  );

  const storageKeys = [
    existing.epubR2Key,
    existing.coverR2Key,
    ...chapterRows.map((r) => r.audioR2Key),
    ...segmentRows.map((r) => r.audioR2Key),
  ].filter((k): k is string => !!k);

  await db.delete(books).where(eq(books.id, bookId));
  invalidateBookVoiceContext(bookId);

  // Purge stored audio/EPUB best-effort so storage doesn't leak orphaned files.
  // Bounded batches: a large book can have ~100k segment files, and firing
  // that many deletes at once would exhaust sockets/file handles.
  const DELETE_BATCH = 16;
  let purgeFailures = 0;
  for (let i = 0; i < storageKeys.length; i += DELETE_BATCH) {
    const purged = await Promise.allSettled(
      storageKeys.slice(i, i + DELETE_BATCH).map((key) => deleteFile(key))
    );
    purgeFailures += purged.filter((r) => r.status === "rejected").length;
  }
  if (purgeFailures > 0) {
    console.warn(`⚠️ ${purgeFailures}/${storageKeys.length} storage file(s) could not be deleted for book ${bookId}.`);
  }

  emitProgressEvent(bookId, "status_change", { status: "failed", message: "Book deleted." });
  return true;
}

/**
 * Retry a failed book that still has its EPUB in storage.
 * Wipes pipeline children and re-runs the performance pipeline from the saved EPUB.
 */
export async function retryFailedBook(bookId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const book = await db.select().from(books).where(eq(books.id, bookId)).then((r) => r[0]);
  if (!book) return { ok: false, error: "Book not found" };
  if (book.status !== "failed") {
    return { ok: false, error: "Only failed books can be retried" };
  }
  if (!book.epubR2Key) {
    return {
      ok: false,
      error: "No saved EPUB for this book. Delete it and re-upload or re-search.",
    };
  }

  // Atomically claim the retry in the DB: only one concurrent request can flip
  // failed → discovering. Without this, two simultaneous retries both pass the
  // status check above and the loser wipes the winner's freshly inserted
  // chapters (or crashes it on the chapter unique constraint).
  const claimed = await db
    .update(books)
    .set({ status: "discovering" })
    .where(and(eq(books.id, bookId), eq(books.status, "failed")))
    .returning({ id: books.id });
  if (claimed.length === 0) {
    return { ok: false, error: "A retry for this book is already in progress." };
  }

  // Clear prior pipeline data (chapters cascade → segments; cast/pronunciation explicit)
  await db.delete(chapters).where(eq(chapters.bookId, bookId));
  await db.delete(castMembers).where(eq(castMembers.bookId, bookId));
  await db.delete(pronunciationDict).where(eq(pronunciationDict.bookId, bookId));
  invalidateBookVoiceContext(bookId);

  try {
    // The ingestion worker loads the EPUB via books.epubR2Key — no buffer in
    // the request path, and the job survives a crash between enqueue and run.
    await enqueueIngestion(bookId, {});
  } catch (err) {
    console.error(`Could not enqueue ingestion retry for book ${bookId}:`, err);
    await db.update(books).set({ status: "failed" }).where(eq(books.id, bookId));
    return { ok: false, error: "Could not schedule the retry. Try again in a few seconds." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lookahead window (just-in-time voicing)
// ---------------------------------------------------------------------------

/** Per book+anchor-chapter throttle — playback syncs arrive every few seconds
 *  and buffering players poll the segments endpoint, but the window only
 *  advances as segments are voiced, so repeated evaluations within a couple
 *  of seconds are pure churn. Keyed by anchor chapter so a cross-chapter seek
 *  is never throttled by the previous chapter's recent evaluation. */
const lookaheadThrottle = new Map<string, number>();
const LOOKAHEAD_THROTTLE_MS = 2_000;

export interface LookaheadAnchor {
  chapterIndex: number;
  segmentIndex: number;
}

/**
 * Just-in-time scheduling: promote the first PIPELINE.LOOKAHEAD_SEGMENTS
 * unvoiced segments at/after the listener's anchor from "pending" to
 * "queued" and give each a BullMQ job. Everything further out stays
 * "pending" — no job, no TTS spend — until listening actually approaches it.
 * Seeking re-centers the window, so skipped-ahead parts voice from there and
 * abandoned parts are never paid for.
 *
 * Drivers: ingestion (anchor = book start), PUT /api/playback (anchor = the
 * listener's current line), and GET /api/chapters/:id/segments?at= (anchor =
 * the line the buffering player is waiting on). Idempotent: promotion is an
 * atomic pending→queued update and BullMQ dedupes on the segment-id jobId,
 * so overlapping calls can never double-schedule.
 */
export async function ensureLookahead(
  bookId: string,
  anchor: LookaheadAnchor = { chapterIndex: 1, segmentIndex: 1 }
): Promise<void> {
  const throttleKey = `${bookId}:${anchor.chapterIndex}`;
  const now = Date.now();
  if (now - (lookaheadThrottle.get(throttleKey) ?? 0) < LOOKAHEAD_THROTTLE_MS) {
    return;
  }
  lookaheadThrottle.set(throttleKey, now);
  // Soft cap so a long-lived process doesn't accumulate stale keys.
  if (lookaheadThrottle.size > 5000) lookaheadThrottle.clear();

  // chapterIndex and segmentIndex are both 1-based (epubService/segmentService).
  const windowRows = await db
    .select({
      segmentId: segments.id,
      chapterId: chapters.id,
      chapterIndex: chapters.chapterIndex,
      segmentIndex: segments.segmentIndex,
      status: segments.status,
    })
    .from(segments)
    .innerJoin(chapters, eq(segments.chapterId, chapters.id))
    .where(
      and(
        eq(chapters.bookId, bookId),
        inArray(segments.status, ["pending", "queued", "processing", "annotated"]),
        or(
          gt(chapters.chapterIndex, anchor.chapterIndex),
          and(eq(chapters.chapterIndex, anchor.chapterIndex), gte(segments.segmentIndex, anchor.segmentIndex))
        )
      )
    )
    .orderBy(asc(chapters.chapterIndex), asc(segments.segmentIndex))
    .limit(PIPELINE.LOOKAHEAD_SEGMENTS);

  const pendingIds = windowRows.filter((r) => r.status === "pending").map((r) => r.segmentId);
  if (pendingIds.length === 0) return;

  // Atomic claim of the scheduling decision: concurrent ensureLookahead calls
  // (playback sync + buffering poll) select the same pending rows, but only
  // rows this call actually flips get jobs enqueued by it.
  const promoted = await db
    .update(segments)
    .set({ status: "queued" })
    .where(and(inArray(segments.id, pendingIds), eq(segments.status, "pending")))
    .returning({ id: segments.id });
  if (promoted.length === 0) return;

  const promotedIds = new Set(promoted.map((r) => r.id));
  const tasks: SegmentJobData[] = windowRows
    .filter((r) => promotedIds.has(r.segmentId))
    .map((r) => ({
      bookId,
      chapterId: r.chapterId,
      chapterIndex: r.chapterIndex,
      segmentId: r.segmentId,
      segmentIndex: r.segmentIndex,
    }));
  await enqueueSegmentJobs(tasks);
}

// ---------------------------------------------------------------------------
// Playback prefetch
// ---------------------------------------------------------------------------

/** Per book+chapter throttle — the chapters endpoint (which triggers this) is
 *  polled by buffering players, but the prefetch decision only changes when
 *  segments transition, so repeated evaluations within a few seconds are pure
 *  churn. */
const prefetchThrottle = new Map<string, number>();
const PREFETCH_THROTTLE_MS = 10_000;

/**
 * Playback prefetch: once chapter N is fully voiced, lift chapter N+1's
 * queued jobs so the next listen starts sooner. Never steals from unfinished
 * earlier chapters (that caused vol/ch N+1 to synthesize while N still had
 * gaps). Priorities are chapterIndex (lower runs first), so the boost moves
 * N+1's jobs up to N's level — ties break FIFO, keeping N's stragglers ahead.
 */
export async function prefetchNextChapter(bookId: string, currentChapterIndex: number) {
  const throttleKey = `${bookId}:${currentChapterIndex}`;
  const now = Date.now();
  if (now - (prefetchThrottle.get(throttleKey) ?? 0) < PREFETCH_THROTTLE_MS) {
    return;
  }
  prefetchThrottle.set(throttleKey, now);
  // Soft cap so a long-lived process doesn't accumulate stale keys.
  if (prefetchThrottle.size > 5000) prefetchThrottle.clear();

  const nextChapterIndex = currentChapterIndex + 1;

  // Still working on the chapter the user is listening to — keep natural
  // chapterIndex order so remaining lines of N finish before N+1 starts.
  const currentIncomplete = await db
    .select({ id: segments.id })
    .from(segments)
    .innerJoin(chapters, eq(segments.chapterId, chapters.id))
    .where(
      and(
        eq(chapters.bookId, bookId),
        eq(chapters.chapterIndex, currentChapterIndex),
        inArray(segments.status, ["queued", "processing", "annotated"])
      )
    )
    .limit(1);
  if (currentIncomplete.length > 0) {
    return;
  }

  const nextQueued = await db
    .select({ id: segments.id })
    .from(segments)
    .innerJoin(chapters, eq(segments.chapterId, chapters.id))
    .where(
      and(
        eq(chapters.bookId, bookId),
        eq(chapters.chapterIndex, nextChapterIndex),
        eq(segments.status, "queued")
      )
    )
    .limit(EPUB_LIMITS.MAX_SEGMENTS_PER_CHAPTER);

  // Best-effort re-prioritization of waiting jobs; jobs already active or
  // completed (or lost to a flush, later refilled by the sweep) are skipped.
  const BATCH = 64;
  for (let i = 0; i < nextQueued.length; i += BATCH) {
    await Promise.allSettled(
      nextQueued.slice(i, i + BATCH).map(async ({ id }) => {
        const job = await segmentQueue.getJob(segmentJobId(id));
        if (job) await job.changePriority({ priority: currentChapterIndex });
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Pipeline lifecycle
// ---------------------------------------------------------------------------

/**
 * Connect Redis, recover pending work, then start workers and the sweep.
 * Recovery runs BEFORE workers start so re-enqueued rows are ready to claim;
 * BullMQ's own stalled recovery covers jobs whose worker died mid-attempt.
 */
export async function startPipeline(): Promise<void> {
  await pingRedis();
  await initEventBridge();
  // Recovery needs the DB; a transiently unreachable database at boot must
  // not prevent the server from coming up — the periodic sweep re-runs the
  // same healing logic every QUEUE.SWEEP_INTERVAL_MS.
  try {
    await resumePendingWork();
  } catch (err) {
    console.error("❌ Boot recovery failed (the periodic sweep will retry it):", err);
  }
  startWorkers({
    ingest: runIngestionJob,
    voice: runSegmentJob,
    stitch: runStitchJob,
    sweep: async () => {
      try {
        await runPipelineSweep();
      } catch (err) {
        console.error("Pipeline sweep failed (will run again on schedule):", err);
      }
    },
  });
  await scheduleSweep();
  console.log("🧵 Durable pipeline workers started (BullMQ/Redis).");
}

export { stopPipeline };
