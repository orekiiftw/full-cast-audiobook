import { eq } from "drizzle-orm";
import { db } from "../../db";
import { books } from "../../schema";
import { retryFailedBook } from "../../orchestrator";
import { bookProviders } from "../../acquisition";
import { json } from "../response";
import type { RouteContext } from "../route";
import { searchRateLimited } from "./bookSearch";
import {
  assertSubmissionBounds,
  assertSubmissionHasSource,
  hashSubmission,
  readBookSubmission,
  type BookSubmission,
} from "./bookSubmission";
import { findBookById, findBookBySourceHash, insertBook, persistAndEnqueue } from "./bookRecords";

export async function createBook({ req, user }: RouteContext): Promise<Response> {
  const submission = await readBookSubmission(req);

  if (submission.requestedProviderBook && searchRateLimited(user.id)) {
    return json({ error: "Too many book lookups. Try again later." }, 429);
  }
  await acquireProviderBook(submission);

  assertSubmissionBounds(submission);
  assertSubmissionHasSource(submission);

  const sourceHash = hashSubmission(submission);
  const existing = await findBookBySourceHash(user.id, sourceHash);
  if (existing) {
    return respondWithExistingBook(existing);
  }

  return createAndQueueBook(user.id, submission, sourceHash);
}

async function acquireProviderBook(submission: BookSubmission): Promise<void> {
  const ref = submission.requestedProviderBook;
  if (!ref) return;

  const providerBook = await bookProviders.getBook(ref.provider, ref.id);
  submission.providerBook = providerBook;
  submission.title ||= providerBook.title;
  submission.author ||= providerBook.authors.join(", ");
}

async function respondWithExistingBook(existing: typeof books.$inferSelect): Promise<Response> {
  if (existing.status !== "failed") {
    return json(existing);
  }

  const result = await retryFailedBook(existing.id);
  if (!result.ok) {
    return json({ error: result.error, book: existing }, 400);
  }
  return json(await findBookById(existing.id));
}

async function createAndQueueBook(userId: string, submission: BookSubmission, sourceHash: string): Promise<Response> {
  const created = await insertBook(userId, submission, sourceHash);
  if (!created) {
    const raced = await findBookBySourceHash(userId, sourceHash);
    if (raced) return json(raced);
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

  return json((await findBookById(created.id)) ?? created);
}
