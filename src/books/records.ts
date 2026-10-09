import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { books } from "../schema";
import { queueBookIngestion } from "../orchestrator";
import { deleteFile, uploadFile } from "../storage/r2";
import { firstRow } from "../lib/query";
import type { BookSubmission } from "./submission";

export function listUserBooks(userId: string) {
  return db.select().from(books).where(eq(books.userId, userId)).orderBy(asc(books.createdAt));
}

export async function findBookBySourceHash(userId: string, sourceHash: string) {
  return firstRow(
    db
      .select()
      .from(books)
      .where(and(eq(books.userId, userId), eq(books.sourceHash, sourceHash))),
  );
}

export async function findBookById(bookId: string) {
  return firstRow(db.select().from(books).where(eq(books.id, bookId)));
}

export async function insertBook(userId: string, submission: BookSubmission, sourceHash: string) {
  try {
    return await firstRow(
      db
        .insert(books)
        .values({
          userId,
          title: submission.title || "Queued Book",
          author: submission.author || "Queued Author",
          sourceHash,
          status: "discovering",
        })
        .returning(),
    );
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "23505") return null;
    throw error;
  }
}

export async function persistAndEnqueue(bookId: string, submission: BookSubmission): Promise<string | undefined> {
  let epubR2Key: string | undefined;
  try {
    if (submission.epubBuffer) {
      epubR2Key = `books/${bookId}/original.epub`;
      await uploadFile(epubR2Key, submission.epubBuffer, "application/epub+zip");
      await db.update(books).set({ epubR2Key }).where(eq(books.id, bookId));
      await queueBookIngestion(bookId, {});
    } else if (submission.providerBook) {
      await queueBookIngestion(bookId, { providerBook: submission.providerBook });
    } else if (submission.magnetOrHash) {
      await queueBookIngestion(bookId, { magnetOrHash: submission.magnetOrHash });
    } else {
      await queueBookIngestion(bookId, { torrentQuery: { title: submission.title, author: submission.author } });
    }
    return epubR2Key;
  } catch (error) {
    if (epubR2Key) await deleteFile(epubR2Key).catch(() => {});
    throw error;
  }
}
