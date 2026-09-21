import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { books } from "../../schema";
import { parseEpub, type ParsedBook } from "../../epub";
import { firstRow } from "../../lib/query";
import { emitProgressEvent, enqueueIngestion, type IngestionJobData } from "../../queue";
import { ensureLookahead } from "../lookahead";
import { maybeMarkBookComplete } from "../lifecycle";
import { resolveEpubBuffer } from "./acquisition";
import { countSegmentsWithinLimits, planChapters, resolveBookIdentity, type PlannedChapter } from "./planning";
import {
  emitEmptyChapterFailures,
  insertChapterRows,
  insertNarratorCastMember,
  insertSegmentRows,
  persistBookMetadata,
  purgeUploadedEpub,
  uploadEpubIfMissing,
  type StoredEpub,
} from "./persistence";
import { reportIngestionFailure } from "./failure";

type BookSource = IngestionJobData["source"];
type BookRow = typeof books.$inferSelect;

interface PreparedBook {
  parsedBook: ParsedBook;
  storedEpub: StoredEpub;
}

export async function queueBookIngestion(bookId: string, source: BookSource): Promise<void> {
  await enqueueIngestion(bookId, source);
}

export async function runIngestionJob(job: Job<IngestionJobData>): Promise<void> {
  const { bookId, source } = job.data;

  const book = await firstRow(db.select().from(books).where(eq(books.id, bookId)));
  if (!book) return;
  if (book.status !== "discovering") return;

  let storedEpub: StoredEpub | undefined;

  try {
    emitProgressEvent(bookId, "status_change", { status: "discovering", message: "Starting ingestion pipeline..." });

    const prepared = await prepareBook(book, source);
    storedEpub = prepared.storedEpub;

    const persisted = await persistBookMetadata(bookId, resolveBookIdentity(prepared.parsedBook, book), storedEpub.epubR2Key);
    if (!persisted.bookStillExists) {
      await purgeUploadedEpub(bookId, storedEpub);
      return;
    }

    await insertNarratorCastMember(bookId);

    const totalSegmentCount = await structureChapters(bookId, prepared.parsedBook);
    await scheduleAudioSynthesis(bookId);
    await ensureLookahead(bookId);

    if (totalSegmentCount === 0) {
      await maybeMarkBookComplete(bookId);
    }
  } catch (error: unknown) {
    await reportIngestionFailure(bookId, error, storedEpub);
  }
}

async function prepareBook(book: BookRow, source: BookSource): Promise<PreparedBook> {
  const epubBuffer = await resolveEpubBuffer(book.id, book.epubR2Key, source);

  emitProgressEvent(book.id, "status_change", { status: "discovering", message: "Parsing EPUB spine and contents..." });
  const parsedBook = parseEpub(epubBuffer);

  const storedEpub = await uploadEpubIfMissing(book.id, epubBuffer, book.epubR2Key);
  return { parsedBook, storedEpub };
}

async function structureChapters(bookId: string, parsedBook: ParsedBook): Promise<number> {
  emitProgressEvent(bookId, "status_change", { status: "in_progress", message: "Structuring chapters and segments..." });

  const planned: PlannedChapter[] = planChapters(parsedBook);
  const totalSegmentCount = countSegmentsWithinLimits(planned);
  const chapterIdByIndex = await insertChapterRows(bookId, planned);

  await insertSegmentRows(planned, chapterIdByIndex);
  emitEmptyChapterFailures(bookId, planned, chapterIdByIndex);

  return totalSegmentCount;
}

async function scheduleAudioSynthesis(bookId: string): Promise<void> {
  await db.update(books).set({ status: "in_progress" }).where(eq(books.id, bookId));
  emitProgressEvent(bookId, "status_change", { status: "in_progress", message: "Book initialized. Scheduling audio synthesis..." });
}
