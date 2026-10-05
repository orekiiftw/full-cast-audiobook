import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { books, castMembers, chapters, playbackState, pronunciationDict } from "../schema";
import { firstRow } from "../lib/query";

export async function assembleBookDetail(book: typeof books.$inferSelect, bookId: string) {
  const [cast, chapterRows, pronunciation, playback] = await Promise.all([
    db
      .select({
        id: castMembers.id,
        bookId: castMembers.bookId,
        name: castMembers.name,
        aliases: castMembers.aliases,
        importance: castMembers.importance,
        voiceBucket: castMembers.voiceBucket,
        ttsVoiceName: castMembers.ttsVoiceName,
        styleString: castMembers.styleString,
        pronunciationNotes: castMembers.pronunciationNotes,
      })
      .from(castMembers)
      .where(eq(castMembers.bookId, bookId))
      .orderBy(asc(castMembers.name)),
    db.select().from(chapters).where(eq(chapters.bookId, bookId)).orderBy(asc(chapters.chapterIndex)),
    db.select().from(pronunciationDict).where(eq(pronunciationDict.bookId, bookId)),
    firstRow(db.select().from(playbackState).where(eq(playbackState.bookId, bookId)).orderBy(desc(playbackState.updatedAt)).limit(1)),
  ]);

  return {
    book,
    cast,
    chapters: chapterRows,
    pronunciation,
    playbackState: playback ?? null,
    segmentProgress: buildSegmentProgress(chapterRows),
    canRetry: book.status === "failed" && !!book.epubR2Key,
  };
}

function buildSegmentProgress(chapterRows: (typeof chapters.$inferSelect)[]): Record<string, { total: number; done: number }> {
  const segmentProgress: Record<string, { total: number; done: number }> = {};
  for (const chapter of chapterRows) {
    segmentProgress[chapter.id] = { total: chapter.totalCount, done: chapter.voicedCount };
  }
  return segmentProgress;
}
