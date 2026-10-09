import { eq } from "drizzle-orm";
import { db } from "../db";
import { books } from "../schema";
import { retryFailedBook } from "../orchestrator";
import { bookProviders } from "../acquisition";
import { assertSubmissionBounds, assertSubmissionHasSource, hashSubmission, type BookSubmission } from "./submission";
import { findBookById, findBookBySourceHash, insertBook, persistAndEnqueue } from "./records";

type BookRow = typeof books.$inferSelect;

type BookCreationResult = { ok: true; book: BookRow | undefined } | { ok: false; error: string; book: BookRow };

export async function submitBook(userId: string, submission: BookSubmission): Promise<BookCreationResult> {
  await acquireProviderBook(submission);
  assertSubmissionBounds(submission);
  assertSubmissionHasSource(submission);

  const sourceHash = hashSubmission(submission);
  const created = await insertBook(userId, submission, sourceHash);
  if (created) return queueCreatedBook(created, submission);

  const existing = await findBookBySourceHash(userId, sourceHash);
  if (!existing) throw new Error("Book insert failed without a conflicting row.");
  return reuseExistingBook(existing);
}

async function acquireProviderBook(submission: BookSubmission): Promise<void> {
  const ref = submission.requestedProviderBook;
  if (!ref) return;

  const providerBook = await bookProviders.getBook(ref.provider, ref.id);
  submission.providerBook = providerBook;
  submission.title ||= providerBook.title;
  submission.author ||= providerBook.authors.join(", ");
}

async function reuseExistingBook(existing: BookRow): Promise<BookCreationResult> {
  if (existing.status !== "failed") return { ok: true, book: existing };

  const result = await retryFailedBook(existing.id);
  if (!result.ok) return { ok: false, error: result.error, book: existing };
  return { ok: true, book: await findBookById(existing.id) };
}

async function queueCreatedBook(created: BookRow, submission: BookSubmission): Promise<BookCreationResult> {
  try {
    const epubR2Key = await persistAndEnqueue(created.id, submission);
    return { ok: true, book: epubR2Key ? { ...created, epubR2Key } : created };
  } catch (error) {
    await db
      .delete(books)
      .where(eq(books.id, created.id))
      .catch(() => {});
    throw error;
  }
}
