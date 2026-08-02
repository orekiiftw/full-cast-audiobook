/**
 * Book lifecycle: delete a book (jobs, rows, stored files) and retry a failed
 * book from its persisted EPUB.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { books, chapters, castMembers, pronunciationDict, segments } from "../schema";
import { deleteFile } from "../r2";
import { emitProgressEvent, enqueueIngestion, invalidateBookVoiceContextClusterwide, removeBookJobs } from "../queue";

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
  invalidateBookVoiceContextClusterwide(bookId);

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
  invalidateBookVoiceContextClusterwide(bookId);

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
