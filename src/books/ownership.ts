import { and, eq, or } from "drizzle-orm";
import { db } from "../db";
import { books, castMembers, chapters, segments } from "../schema";
import { firstRow } from "../lib/query";

const BOOK_KEY_RE = /^books\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

export async function ownedBook(userId: string, bookId: string) {
  return firstRow(
    db
      .select()
      .from(books)
      .where(and(eq(books.id, bookId), eq(books.userId, userId)))
      .limit(1),
  );
}

export async function ownedChapter(userId: string, chapterId: string) {
  return firstRow(
    db
      .select({ chapter: chapters, book: books })
      .from(chapters)
      .innerJoin(books, eq(chapters.bookId, books.id))
      .where(and(eq(chapters.id, chapterId), eq(books.userId, userId)))
      .limit(1),
  );
}

export async function ownedSegment(userId: string, segmentId: string) {
  return firstRow(
    db
      .select({ segment: segments, chapter: chapters, book: books })
      .from(segments)
      .innerJoin(chapters, eq(segments.chapterId, chapters.id))
      .innerJoin(books, eq(chapters.bookId, books.id))
      .where(and(eq(segments.id, segmentId), eq(books.userId, userId)))
      .limit(1),
  );
}

export async function ownedCastMember(userId: string, castId: string) {
  return firstRow(
    db
      .select({ castMember: castMembers, book: books })
      .from(castMembers)
      .innerJoin(books, eq(castMembers.bookId, books.id))
      .where(and(eq(castMembers.id, castId), eq(books.userId, userId)))
      .limit(1),
  );
}

export async function ownsStorageKey(userId: string, key: string): Promise<boolean> {
  const namespaced = BOOK_KEY_RE.exec(key);
  if (namespaced) {
    return !!(await ownedBook(userId, namespaced[1]));
  }

  const row = await firstRow(
    db
      .select({ id: books.id })
      .from(books)
      .leftJoin(chapters, eq(chapters.bookId, books.id))
      .leftJoin(segments, eq(segments.chapterId, chapters.id))
      .where(
        and(
          eq(books.userId, userId),
          or(eq(books.coverR2Key, key), eq(books.epubR2Key, key), eq(chapters.audioR2Key, key), eq(segments.audioR2Key, key)),
        ),
      )
      .limit(1),
  );
  return !!row;
}
