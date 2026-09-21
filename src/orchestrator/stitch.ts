import type { Job } from "bullmq";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { chapters, segments } from "../schema";
import { stitchChapter } from "../audio/stitch";
import { QUEUE } from "../lib/constants";
import { firstRow } from "../lib/query";
import { consumeStitchPending, discardStitchPending, emitProgressEvent, enqueueStitch, type StitchJobData } from "../queue";
import { shouldEnqueueStitch } from "./chapterCounters";
import { maybeMarkBookComplete } from "./lifecycle";

const MAX_STITCH_RERUNS = 5;

export async function runStitchJob(job: Job<StitchJobData>): Promise<void> {
  const { bookId, chapterId, chapterIndex } = job.data;

  await discardStitchPending(chapterId);

  for (let rerun = 0; ; rerun++) {
    const didStitch = await runStitchOnce(job, bookId, chapterId, chapterIndex);
    if (!didStitch) return;

    if (!(await consumeStitchPending(chapterId))) return;

    if (rerun + 1 >= MAX_STITCH_RERUNS) {
      console.warn(
        `Chapter stitch for ${chapterId} hit the rerun cap (${MAX_STITCH_RERUNS}); running a final fresh pass and dropping further re-stitch requests.`,
      );
      await runStitchOnce(job, bookId, chapterId, chapterIndex);
      return;
    }
  }
}

export function restitchChapterInBackground(bookId: string, chapterId: string, chapterIndex: number): void {
  enqueueStitch({ bookId, chapterId, chapterIndex }).catch((err) => console.error("Failed to enqueue re-stitch after regeneration:", err));
}

async function runStitchOnce(job: Job<StitchJobData>, bookId: string, chapterId: string, chapterIndex: number): Promise<boolean> {
  const chapter = await firstRow(db.select().from(chapters).where(eq(chapters.id, chapterId)));
  if (!chapter) return false;

  if (chapter.totalCount === 0) {
    await failChapterIfNotFailed(bookId, chapterId, chapterIndex, chapter.status, "Chapter has no segments to voice");
    return false;
  }

  if (!shouldEnqueueStitch(chapter)) return false;

  if (chapter.voicedCount === 0) {
    await failChapterIfNotFailed(bookId, chapterId, chapterIndex, chapter.status, "All segments failed to generate");
    return false;
  }

  try {
    return await stitchChapterAudio(bookId, chapterId, chapterIndex);
  } catch (err) {
    await handleStitchFailure(job, bookId, chapterId, chapterIndex, err);
    throw err;
  }
}

async function stitchChapterAudio(bookId: string, chapterId: string, chapterIndex: number): Promise<boolean> {
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
    .then((rows) => rows.filter((segment) => segment.audioR2Key));
  if (voicedSegments.length === 0) return false;

  const stitchResult = await stitchChapter(
    bookId,
    chapterIndex,
    voicedSegments.map((segment) => ({
      audioR2Key: segment.audioR2Key!,
      isSceneBreak: segment.isSceneBreak === 1,
    })),
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
  return true;
}

async function failChapterIfNotFailed(
  bookId: string,
  chapterId: string,
  chapterIndex: number,
  currentStatus: string,
  error: string,
): Promise<void> {
  if (currentStatus === "failed") return;

  await db.update(chapters).set({ status: "failed" }).where(eq(chapters.id, chapterId));
  emitProgressEvent(bookId, "chapter_status", {
    chapterId,
    status: "failed",
    chapterIndex,
    error,
  });
  await maybeMarkBookComplete(bookId);
}

async function handleStitchFailure(
  job: Job<StitchJobData>,
  bookId: string,
  chapterId: string,
  chapterIndex: number,
  err: unknown,
): Promise<void> {
  console.error(`Chapter stitch failed for ${chapterId}:`, err);
  if (job.attemptsMade + 1 < QUEUE.MAX_STITCH_ATTEMPTS) return;

  console.error(`Chapter stitch for ${chapterId} exhausted ${QUEUE.MAX_STITCH_ATTEMPTS} attempts; marking failed.`);
  try {
    const failedChapter = await firstRow(db.select().from(chapters).where(eq(chapters.id, chapterId)));
    if (!failedChapter || failedChapter.status === "ready") return;

    await db.update(chapters).set({ status: "failed" }).where(eq(chapters.id, chapterId));
    emitProgressEvent(bookId, "chapter_status", {
      chapterId,
      status: "failed",
      chapterIndex,
      error: "Chapter stitching failed repeatedly",
    });
    await maybeMarkBookComplete(bookId);
  } catch (failErr) {
    console.error(`Failed to mark chapter ${chapterId} as failed after stitch exhaustion:`, failErr);
  }
}
