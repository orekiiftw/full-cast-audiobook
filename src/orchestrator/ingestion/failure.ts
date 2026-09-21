import { eq } from "drizzle-orm";
import { db } from "../../db";
import { books } from "../../schema";
import { deleteFile } from "../../storage/r2";
import { emitProgressEvent } from "../../queue";
import type { StoredEpub } from "./persistence";

export async function reportIngestionFailure(bookId: string, error: unknown, storedEpub: StoredEpub | undefined): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Ingestion failed for Book ${bookId}:`, error);

  await db.update(books).set({ status: "failed" }).where(eq(books.id, bookId));

  if (storedEpub?.uploadedInThisRun) {
    await persistUploadedEpubOrPurge(bookId, storedEpub.epubR2Key);
  }

  emitProgressEvent(bookId, "status_change", { status: "failed", error: describeIngestionFailure(message) });
}

async function persistUploadedEpubOrPurge(bookId: string, epubR2Key: string): Promise<void> {
  try {
    const persisted = await db.update(books).set({ epubR2Key }).where(eq(books.id, bookId)).returning({ id: books.id });
    if (persisted.length === 0) {
      await deleteFile(epubR2Key).catch((err) => console.warn(`Could not purge orphaned EPUB of deleted book (${bookId}):`, err));
    }
  } catch {}
}

function describeIngestionFailure(message: string): string {
  if (/torrent|torbox/i.test(message)) return "Could not download this book. Try a different search or upload an EPUB.";
  if (/epub|parse|spine/i.test(message)) return "This book's EPUB could not be parsed.";
  if (/too short|word count/i.test(message)) return message;
  return "Ingestion failed unexpectedly.";
}
