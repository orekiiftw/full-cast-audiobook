import type { Job } from "bullmq";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { chapters, segments } from "../../schema";
import { firstRow } from "../../lib/query";
import type { SegmentJobData } from "../../queue";
import { reportSegmentFailure } from "./failure";
import { voiceSegment } from "./voicing";

type ChapterRow = typeof chapters.$inferSelect;

type SegmentRow = typeof segments.$inferSelect;

export type { ChapterRow, SegmentRow };

export async function runSegmentJob(job: Job<SegmentJobData>): Promise<void> {
  const { bookId, chapterId, segmentId } = job.data;

  try {
    if (job.attemptsMade > 0) {
      await resetClaimedSegment(segmentId);
    }

    const segmentRow = await claimSegment(segmentId, chapterId);
    if (!segmentRow) return;

    const chapterRow = await firstRow(db.select().from(chapters).where(eq(chapters.id, chapterId)));
    if (!chapterRow || chapterRow.bookId !== bookId) {
      console.warn(`⚠️ Segment job ${segmentId}: job data does not match DB lineage (book ${bookId}/chapter ${chapterId}). Skipping.`);
      await db
        .update(segments)
        .set({ status: "queued" })
        .where(and(eq(segments.id, segmentId), eq(segments.status, "processing")));
      return;
    }

    await voiceSegment(job, segmentRow, chapterRow);
  } catch (error: unknown) {
    await reportSegmentFailure(job, error);
  }
}

async function resetClaimedSegment(segmentId: string): Promise<void> {
  await db
    .update(segments)
    .set({ status: "queued" })
    .where(and(eq(segments.id, segmentId), inArray(segments.status, ["processing", "annotated"])));
}

async function claimSegment(segmentId: string, chapterId: string): Promise<SegmentRow | null> {
  const claimed = await db
    .update(segments)
    .set({ status: "processing" })
    .where(and(eq(segments.id, segmentId), eq(segments.chapterId, chapterId), eq(segments.status, "queued")))
    .returning();
  return claimed[0] ?? null;
}
