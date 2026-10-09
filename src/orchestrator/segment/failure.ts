import type { Job } from "bullmq";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { segments } from "../../schema";
import { PIPELINE } from "../../lib/constants";
import { firstRow } from "../../lib/query";
import { emitProgressEvent, enqueueStitch, type SegmentJobData } from "../../queue";
import { incrementFailedCount, recomputeChapterCounters } from "../chapterCounters";
import { isChapterComplete } from "../../lib/chapterStatus";

export async function reportSegmentFailure(job: Job<SegmentJobData>, error: unknown): Promise<void> {
  const { bookId, chapterId, segmentId, chapterIndex } = job.data;

  console.error(`❌ Failed to voice segment ${segmentId}:`, error);

  const current = await firstRow(db.select({ status: segments.status }).from(segments).where(eq(segments.id, segmentId)));
  if (current?.status === "voiced") {
    await repairPostVoicedCounters(bookId, chapterId, chapterIndex);
    throw error;
  }

  const attempts = job.attemptsMade + 1;
  if (attempts >= PIPELINE.MAX_SEGMENT_ATTEMPTS) {
    await failSegmentPermanently(bookId, chapterId, chapterIndex, segmentId, attempts);
  } else {
    await requeueSegmentForRetry(segmentId, attempts);
  }

  throw error;
}

async function repairPostVoicedCounters(bookId: string, chapterId: string, chapterIndex: number): Promise<void> {
  try {
    const counters = await recomputeChapterCounters(chapterId);
    if (isChapterComplete(counters)) {
      await enqueueStitch({ bookId, chapterId, chapterIndex });
    }
  } catch (repairErr) {
    console.error(`Post-voiced counter repair failed for chapter ${chapterId}:`, repairErr);
  }
}

async function failSegmentPermanently(
  bookId: string,
  chapterId: string,
  chapterIndex: number,
  segmentId: string,
  attempts: number,
): Promise<void> {
  const newlyFailed = await db
    .update(segments)
    .set({ attempts, status: "failed" })
    .where(and(eq(segments.id, segmentId), sql`${segments.status} != 'failed'`, sql`${segments.status} != 'voiced'`))
    .returning({ id: segments.id });
  if (newlyFailed.length === 0) return;

  emitProgressEvent(bookId, "segment_failed", {
    segmentId,
    chapterId,
    error: "Narration failed for this paragraph. You can retry it from the reading view.",
  });

  const counters = await incrementFailedCount(chapterId);
  if (isChapterComplete(counters)) {
    await enqueueStitch({ bookId, chapterId, chapterIndex });
  }
}

async function requeueSegmentForRetry(segmentId: string, attempts: number): Promise<void> {
  const requeued = await db
    .update(segments)
    .set({ attempts, status: "queued" })
    .where(and(eq(segments.id, segmentId), inArray(segments.status, ["queued", "processing", "annotated"])))
    .returning({ id: segments.id });
  if (requeued.length === 0) return;

  console.log(`⏳ Segment ${segmentId} requeued by BullMQ backoff (attempt ${attempts}/${PIPELINE.MAX_SEGMENT_ATTEMPTS})`);
}
