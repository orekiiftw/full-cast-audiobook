/**
 * Chapter stitching: the BullMQ "stitch" processor — concatenates voiced
 * segments into the chapter audio and marks the book complete when every
 * chapter is terminal.
 */
import type { Job } from "bullmq";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { books, chapters, segments } from "../schema";
import { stitchChapter } from "../stitchService";
import { QUEUE } from "../lib/constants";
import { emitProgressEvent, enqueueStitch, type StitchJobData } from "../queue";

/**
 * Stitch processor. The deterministic jobId (`stitch:{chapterId}`) is the
 * concurrency guard — BullMQ dedupes enqueue calls atomically, so a chapter
 * can never have two queued/running stitch jobs, across ANY number of
 * instances (replacing the per-process stitchingChapters Set). Retries with
 * durable fixed backoff replace the in-memory attempt counter + setTimeout.
 */
export async function runStitchJob(job: Job<StitchJobData>): Promise<void> {
  const { bookId, chapterId, chapterIndex } = job.data;

  const ch = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .then((r) => r[0]);
  // Note: "ready" chapters deliberately fall through — a regen re-stitch job
  // (restitchChapterInBackground) targets exactly that state, and the
  // terminal-counter check below is the real guard against stale/early jobs.
  if (!ch) return;

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
export async function maybeMarkBookComplete(bookId: string) {
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
