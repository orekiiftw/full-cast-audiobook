import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { chapters } from "../schema";
import { firstRow } from "../lib/query";

export const CHAPTER_COUNTERS = {
  voicedCount: chapters.voicedCount,
  failedCount: chapters.failedCount,
  totalCount: chapters.totalCount,
};

export interface ChapterCounters {
  voicedCount: number;
  failedCount: number;
  totalCount: number;
}

export function shouldEnqueueStitch(counters: ChapterCounters | undefined): boolean {
  return !!counters && counters.totalCount > 0 && counters.voicedCount + counters.failedCount >= counters.totalCount;
}

export async function incrementVoicedCount(chapterId: string): Promise<ChapterCounters | undefined> {
  return firstRow(
    db
      .update(chapters)
      .set({ voicedCount: sql`${chapters.voicedCount} + 1` })
      .where(eq(chapters.id, chapterId))
      .returning(CHAPTER_COUNTERS),
  );
}

export async function incrementFailedCount(chapterId: string): Promise<ChapterCounters | undefined> {
  return firstRow(
    db
      .update(chapters)
      .set({ failedCount: sql`${chapters.failedCount} + 1` })
      .where(eq(chapters.id, chapterId))
      .returning(CHAPTER_COUNTERS),
  );
}

export async function recomputeChapterCounters(chapterId: string): Promise<ChapterCounters | undefined> {
  await db.execute(sql`
    UPDATE chapters c
    SET total_count = s.total, voiced_count = s.voiced, failed_count = s.failed
    FROM (
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'voiced')::int AS voiced,
             COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM segments WHERE chapter_id = ${chapterId}
    ) s
    WHERE c.id = ${chapterId}
  `);
  return firstRow(db.select(CHAPTER_COUNTERS).from(chapters).where(eq(chapters.id, chapterId)));
}
