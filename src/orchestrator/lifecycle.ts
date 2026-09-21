import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { books, chapters, castMembers, pronunciationDict, segments } from "../schema";
import { deleteFiles } from "../storage/r2";
import { firstRow } from "../lib/query";
import { emitProgressEvent, enqueueIngestion, invalidateBookVoiceContextClusterwide, removeBookJobs } from "../queue";

export async function deleteBook(bookId: string): Promise<boolean> {
  const [book, chapterRows, segmentRows] = await Promise.all([
    firstRow(db.select().from(books).where(eq(books.id, bookId))),
    db
      .select({ id: chapters.id, chapterIndex: chapters.chapterIndex, audioR2Key: chapters.audioR2Key })
      .from(chapters)
      .where(eq(chapters.bookId, bookId)),
    db
      .select({ id: segments.id, audioR2Key: segments.audioR2Key })
      .from(segments)
      .innerJoin(chapters, eq(segments.chapterId, chapters.id))
      .where(eq(chapters.bookId, bookId)),
  ]);
  if (!book) return false;

  await removeBookJobs(
    bookId,
    segmentRows.map((row) => row.id),
    chapterRows.map((row) => row.id),
  );

  const storageKeys = [book.epubR2Key, book.coverR2Key, ...collectAudioKeys(bookId, chapterRows, segmentRows)].filter(
    (key): key is string => !!key,
  );

  await db.delete(books).where(eq(books.id, bookId));
  invalidateBookVoiceContextClusterwide(bookId);

  purgeStoredFiles(bookId, storageKeys);
  emitProgressEvent(bookId, "status_change", { status: "failed", message: "Book deleted." });
  return true;
}

export async function retryFailedBook(bookId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const book = await firstRow(db.select().from(books).where(eq(books.id, bookId)));
  if (!book) return { ok: false, error: "Book not found" };
  if (book.status !== "failed") return { ok: false, error: "Only failed books can be retried" };

  const claimed = await db
    .update(books)
    .set({ status: "discovering" })
    .where(and(eq(books.id, bookId), eq(books.status, "failed")))
    .returning({ id: books.id });
  if (claimed.length === 0) {
    return { ok: false, error: "A retry for this book is already in progress." };
  }

  const [oldChapterRows, oldSegmentRows] = await Promise.all([
    db.select({ chapterIndex: chapters.chapterIndex, audioR2Key: chapters.audioR2Key }).from(chapters).where(eq(chapters.bookId, bookId)),
    db
      .select({ audioR2Key: segments.audioR2Key })
      .from(segments)
      .innerJoin(chapters, eq(segments.chapterId, chapters.id))
      .where(eq(chapters.bookId, bookId)),
  ]);

  await db.delete(chapters).where(eq(chapters.bookId, bookId));
  await db.delete(castMembers).where(eq(castMembers.bookId, bookId));
  await db.delete(pronunciationDict).where(eq(pronunciationDict.bookId, bookId));
  invalidateBookVoiceContextClusterwide(bookId);

  void deleteFiles(collectAudioKeys(bookId, oldChapterRows, oldSegmentRows)).catch((err) => {
    console.warn(`⚠️ Could not purge orphaned audio for book ${bookId}:`, err);
  });

  try {
    await enqueueIngestion(bookId, book.epubR2Key ? {} : { torrentQuery: { title: book.title, author: book.author } });
  } catch (err) {
    console.error(`Could not enqueue ingestion retry for book ${bookId}:`, err);
    await db.update(books).set({ status: "failed" }).where(eq(books.id, bookId));
    return { ok: false, error: "Could not schedule the retry. Try again in a few seconds." };
  }
  return { ok: true };
}

export async function maybeMarkBookComplete(bookId: string): Promise<void> {
  const stats = await firstRow(
    db
      .select({
        total: sql<number>`count(*)::int`,
        terminal: sql<number>`count(*) filter (where ${chapters.status} in ('ready', 'failed'))::int`,
        ready: sql<number>`count(*) filter (where ${chapters.status} = 'ready')::int`,
      })
      .from(chapters)
      .where(eq(chapters.bookId, bookId)),
  );
  if (!stats || stats.total === 0) return;
  if (stats.terminal < stats.total) return;

  const anyReady = stats.ready > 0;
  const nextStatus = anyReady ? "ready" : "failed";

  await db.update(books).set({ status: nextStatus }).where(eq(books.id, bookId));
  emitProgressEvent(bookId, "status_change", {
    status: nextStatus,
    message: anyReady ? "Your book performance is fully generated!" : "Book performance failed — no chapters could be generated.",
  });
}

interface ChapterAudioKeys {
  chapterIndex: number;
  audioR2Key: string | null;
}

interface SegmentAudioKeys {
  audioR2Key: string | null;
}

function collectAudioKeys(bookId: string, chapterRows: ChapterAudioKeys[], segmentRows: SegmentAudioKeys[]): string[] {
  return [
    ...chapterRows.map((row) => row.audioR2Key),
    ...chapterRows.map((row) => `books/${bookId}/chapters/chapter_${row.chapterIndex}.mp3`),
    ...segmentRows.map((row) => row.audioR2Key),
  ].filter((key): key is string => !!key);
}

function purgeStoredFiles(bookId: string, storageKeys: string[]): void {
  void deleteFiles(storageKeys)
    .then((failures) => {
      if (failures > 0) {
        console.warn(`⚠️ ${failures}/${storageKeys.length} storage file(s) could not be deleted for book ${bookId}.`);
      }
    })
    .catch((err) => {
      console.warn(`⚠️ Storage purge failed for book ${bookId}:`, err);
    });
}
