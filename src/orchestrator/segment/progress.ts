import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { chapters, segments } from "../../schema";
import { PIPELINE } from "../../lib/constants";
import { firstRow } from "../../lib/query";
import { emitProgressEvent } from "../../queue";
import type { ChapterCounters } from "../chapterCounters";

type ChapterRow = typeof chapters.$inferSelect;

export async function markChapterProcessing(bookId: string, chapterRow: ChapterRow): Promise<void> {
  if (chapterRow.status !== "queued") return;

  await db.update(chapters).set({ status: "processing" }).where(eq(chapters.id, chapterRow.id));
  emitProgressEvent(bookId, "chapter_status", {
    chapterId: chapterRow.id,
    status: "processing",
    chapterIndex: chapterRow.chapterIndex,
  });
}

export async function maybeMarkPartialReady(
  bookId: string,
  chapterId: string,
  chapterIndex: number,
  currentStatus: string,
  counters: ChapterCounters,
): Promise<void> {
  if (currentStatus !== "processing" && currentStatus !== "queued") return;
  if (!(await isPlayableWindowReady(chapterId, counters))) return;

  const chapter = await firstRow(db.select({ status: chapters.status }).from(chapters).where(eq(chapters.id, chapterId)));
  if (!chapter || chapter.status === "ready" || chapter.status === "partial_ready" || chapter.status === "failed") return;

  await db.update(chapters).set({ status: "partial_ready" }).where(eq(chapters.id, chapterId));
  emitProgressEvent(bookId, "chapter_status", {
    chapterId,
    status: "partial_ready",
    chapterIndex,
  });
}

async function isPlayableWindowReady(chapterId: string, counters: ChapterCounters): Promise<boolean> {
  const threshold = PIPELINE.PARTIAL_READY_THRESHOLD;

  if (counters.totalCount <= threshold) {
    return counters.totalCount > 0 && counters.voicedCount + counters.failedCount >= counters.totalCount && counters.voicedCount > 0;
  }

  const leadingIndexes = Array.from({ length: threshold }, (_, index) => index + 1);
  const leading = await db
    .select({ status: segments.status, segmentIndex: segments.segmentIndex })
    .from(segments)
    .where(and(eq(segments.chapterId, chapterId), inArray(segments.segmentIndex, leadingIndexes)));

  const windowDone = leading.length > 0 && leading.every((row) => row.status === "voiced" || row.status === "failed");
  const anyPlayable = leading.some((row) => row.status === "voiced");
  return windowDone && anyPlayable;
}
