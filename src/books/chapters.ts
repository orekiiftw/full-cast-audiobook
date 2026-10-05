import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { chapters, segments } from "../schema";
import { ensureChapterLookahead, prefetchNextChapter } from "../orchestrator";
import { versionedAudioUrl } from "../lib/audioUrl";

export async function listChapterSegments(chapter: typeof chapters.$inferSelect, chapterId: string) {
  const list = await listSegments(chapterId);

  prefetchNextChapter(chapter.bookId, chapter.chapterIndex).catch((err) =>
    console.error(`Lookahead prefetch failed for book ${chapter.bookId} ch ${chapter.chapterIndex}:`, err),
  );
  ensureChapterLookahead(chapter.bookId, chapter.chapterIndex).catch((err) =>
    console.error(`Lookahead ensure failed for book ${chapter.bookId} ch ${chapter.chapterIndex}:`, err),
  );

  return { chapter, segments: list.map((segment) => toSegmentSummary(segment, chapterId)) };
}

function listSegments(chapterId: string) {
  return db
    .select({
      id: segments.id,
      segmentIndex: segments.segmentIndex,
      rawText: segments.rawText,
      status: segments.status,
      audioR2Key: segments.audioR2Key,
      durationMs: segments.durationMs,
    })
    .from(segments)
    .where(eq(segments.chapterId, chapterId))
    .orderBy(asc(segments.segmentIndex));
}

function toSegmentSummary(segment: Awaited<ReturnType<typeof listSegments>>[number], chapterId: string) {
  return {
    id: segment.id,
    chapterId,
    segmentIndex: segment.segmentIndex,
    rawText: segment.rawText,
    status: segment.status,
    audioUrl: segment.audioR2Key ? versionedAudioUrl(segment.audioR2Key, segment.durationMs) : null,
    durationMs: segment.durationMs,
  };
}
