import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { books, chapters, castMembers, segments } from "../schema";
import { deleteFiles } from "../storage/r2";
import { segmentAudioKey } from "../storage/keys";
import { sleep } from "../lib/async";
import { firstRow } from "../lib/query";
import {
  acquireLock,
  emitProgressEvent,
  enqueueIngestion,
  ingestionQueue,
  invalidateBookVoiceContextClusterwide,
  releaseLock,
  removeBookJobs,
  segmentQueue,
  stitchQueue,
} from "../queue";

type RetryResult = { ok: true } | { ok: false; error: string };

type BookRow = typeof books.$inferSelect;

const RETRY_IN_PROGRESS: RetryResult = { ok: false, error: "A retry for this book is already in progress." };

// Outlasts removing every job of the largest allowed book plus its audio purge, so one slow retry is never run twice.
const RETRY_LOCK_TTL_MS = 5 * 60_000;

// Outlasts a segment's worst-case synthesis and a slow torrent download, the longest writers a deleted book can still have running.
const RUNNING_WRITER_WAIT_MS = 15 * 60_000;

const RUNNING_WRITER_POLL_MS = 5_000;

export function bookRetryLockName(bookId: string): string {
  return `retry:${bookId}`;
}

export async function deleteBook(bookId: string): Promise<boolean> {
  const [book, outputs] = await Promise.all([firstRow(db.select().from(books).where(eq(books.id, bookId))), loadBookOutputs(bookId)]);
  if (!book) return false;

  await removeOutputJobs(bookId, outputs);

  await db.delete(books).where(eq(books.id, bookId));
  invalidateBookVoiceContextClusterwide(bookId);

  void purgeDeletedBook(bookId, recordedKeys(outputs, book), derivedKeys(bookId, outputs));
  emitProgressEvent(bookId, "status_change", { status: "failed", message: "Book deleted." });
  return true;
}

export async function retryFailedBook(bookId: string): Promise<RetryResult> {
  const lockName = bookRetryLockName(bookId);
  const lockToken = await acquireLock(lockName, RETRY_LOCK_TTL_MS);
  if (!lockToken) return RETRY_IN_PROGRESS;
  try {
    return await restartFailedBook(bookId);
  } finally {
    await releaseLock(lockName, lockToken);
  }
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

async function restartFailedBook(bookId: string): Promise<RetryResult> {
  const book = await firstRow(db.select().from(books).where(eq(books.id, bookId)));
  if (!book) return { ok: false, error: "Book not found" };
  if (book.status !== "failed") return { ok: false, error: "Only failed books can be retried" };

  const outputs = await loadBookOutputs(bookId);
  await removeOutputJobs(bookId, outputs);
  if (!(await resetBookForRetry(bookId))) return RETRY_IN_PROGRESS;
  invalidateBookVoiceContextClusterwide(bookId);

  // The new run writes audio under the same index-based keys, so the old files must be gone before it starts.
  await purgeStoredFiles(bookId, recordedKeys(outputs), chapterKeys(bookId, outputs));

  try {
    await enqueueIngestion(bookId, book.epubR2Key ? {} : { torrentQuery: { title: book.title, author: book.author } });
  } catch (err) {
    console.error(`Could not enqueue ingestion retry for book ${bookId}:`, err);
    await db
      .update(books)
      .set({ status: "failed" })
      .where(and(eq(books.id, bookId), eq(books.status, "discovering")));
    return { ok: false, error: "Could not schedule the retry. Try again in a few seconds." };
  }
  return { ok: true };
}

async function resetBookForRetry(bookId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(books)
      .set({ status: "discovering" })
      .where(and(eq(books.id, bookId), eq(books.status, "failed")))
      .returning({ id: books.id });
    if (claimed.length === 0) return false;

    // Ingestion rebuilds chapters, segments, and cast. The pronunciation dictionary is the user's own and carries over.
    await tx.delete(chapters).where(eq(chapters.bookId, bookId));
    await tx.delete(castMembers).where(eq(castMembers.bookId, bookId));
    return true;
  });
}

interface BookOutputs {
  chapters: Array<{ id: string; chapterIndex: number; audioR2Key: string | null }>;
  segments: Array<{ id: string; chapterIndex: number; segmentIndex: number; audioR2Key: string | null }>;
}

async function loadBookOutputs(bookId: string): Promise<BookOutputs> {
  const [chapterRows, segmentRows] = await Promise.all([
    db
      .select({ id: chapters.id, chapterIndex: chapters.chapterIndex, audioR2Key: chapters.audioR2Key })
      .from(chapters)
      .where(eq(chapters.bookId, bookId)),
    db
      .select({
        id: segments.id,
        chapterIndex: chapters.chapterIndex,
        segmentIndex: segments.segmentIndex,
        audioR2Key: segments.audioR2Key,
      })
      .from(segments)
      .innerJoin(chapters, eq(segments.chapterId, chapters.id))
      .where(eq(chapters.bookId, bookId)),
  ]);
  return { chapters: chapterRows, segments: segmentRows };
}

async function removeOutputJobs(bookId: string, outputs: BookOutputs): Promise<void> {
  await removeBookJobs(
    bookId,
    outputs.segments.map((row) => row.id),
    outputs.chapters.map((row) => row.id),
  );
}

function recordedKeys(outputs: BookOutputs, book?: BookRow): string[] {
  return [
    book?.epubR2Key,
    book?.coverR2Key,
    ...outputs.chapters.map((row) => row.audioR2Key),
    ...outputs.segments.map((row) => row.audioR2Key),
  ].filter((key): key is string => !!key);
}

// Storage cannot list a books/<id>/ prefix, so this enumerates every key a writer derives from the book's layout instead.
function derivedKeys(bookId: string, outputs: BookOutputs): string[] {
  return [
    epubKey(bookId),
    ...chapterKeys(bookId, outputs),
    ...outputs.segments.map((row) => segmentAudioKey(bookId, row.chapterIndex, row.segmentIndex)),
  ];
}

function chapterKeys(bookId: string, outputs: BookOutputs): string[] {
  return outputs.chapters.map((row) => chapterAudioKey(bookId, row.chapterIndex));
}

function epubKey(bookId: string): string {
  return `books/${bookId}/original.epub`;
}

function chapterAudioKey(bookId: string, chapterIndex: number): string {
  return `books/${bookId}/chapters/chapter_${chapterIndex}.mp3`;
}

// Only recorded keys are expected to exist; most derived keys were never written, and local storage counts each miss as a failure.
async function purgeStoredFiles(bookId: string, recorded: string[], derived: string[]): Promise<void> {
  try {
    const failures = await deleteFiles(recorded);
    if (failures > 0) {
      console.warn(`⚠️ ${failures}/${recorded.length} storage file(s) could not be deleted for book ${bookId}.`);
    }
    const recordedSet = new Set(recorded);
    await deleteFiles(derived.filter((key) => !recordedSet.has(key)));
  } catch (err) {
    console.warn(`⚠️ Storage purge failed for book ${bookId}:`, err);
  }
}

// Removing a book's jobs cannot stop the ones already running, and those keep writing under books/<id>/ after its rows
// are gone. Listing them only after the rows are deleted means any other writer either finished before the first purge
// or can no longer claim a row.
async function purgeDeletedBook(bookId: string, recorded: string[], derived: string[]): Promise<void> {
  const writers = await findRunningWriters(bookId).catch((err) => {
    console.warn(`⚠️ Could not list the running jobs of deleted book ${bookId}; files they write may be left behind:`, err);
    return [];
  });
  await purgeStoredFiles(bookId, recorded, derived);
  if (writers.length === 0) return;

  await waitForRunningWriters(writers);
  await purgeStoredFiles(
    bookId,
    [],
    writers.map((writer) => writer.key),
  );
}

interface RunningWriter {
  job: { getState(): Promise<string> };
  key: string;
}

async function findRunningWriters(bookId: string): Promise<RunningWriter[]> {
  const [ingesting, voicing, stitching] = await Promise.all([
    ingestionQueue.getActive(),
    segmentQueue.getActive(),
    stitchQueue.getActive(),
  ]);
  return [
    ...ingesting.filter((job) => job.data.bookId === bookId).map((job) => ({ job, key: epubKey(bookId) })),
    ...voicing
      .filter((job) => job.data.bookId === bookId)
      .map((job) => ({ job, key: segmentAudioKey(bookId, job.data.chapterIndex, job.data.segmentIndex) })),
    ...stitching.filter((job) => job.data.bookId === bookId).map((job) => ({ job, key: chapterAudioKey(bookId, job.data.chapterIndex) })),
  ];
}

async function waitForRunningWriters(writers: RunningWriter[]): Promise<void> {
  const deadline = Date.now() + RUNNING_WRITER_WAIT_MS;
  let running = writers;
  while (running.length > 0 && Date.now() < deadline) {
    await sleep(RUNNING_WRITER_POLL_MS);
    const states = await Promise.all(running.map(({ job }) => job.getState().catch(() => "unknown")));
    running = running.filter((_, index) => states[index] === "active");
  }
}
