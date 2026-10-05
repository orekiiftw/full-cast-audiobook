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
  const existing = await findBookBySourceHash(userId, sourceHash);
  if (existing) return reuseExistingBook(existing);

  return createAndQueueBook(userId, submission, sourceHash);
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

async function createAndQueueBook(userId: string, submission: BookSubmission, sourceHash: string): Promise<BookCreationResult> {
  const created = await insertBook(userId, submission, sourceHash);
  if (!created) {
    const raced = await findBookBySourceHash(userId, sourceHash);
    if (raced) return { ok: true, book: raced };
    throw new Error("Book insert failed without a conflicting row.");
  }

  try {
    await persistAndEnqueue(created.id, submission);
  } catch (error) {
    await db
      .delete(books)
      .where(eq(books.id, created.id))
      .catch(() => {});
    throw error;
  }

  return { ok: true, book: (await findBookById(created.id)) ?? created };
}
