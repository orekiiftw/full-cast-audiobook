import { eq } from "drizzle-orm";
import { db } from "../../db";
import { books, chapters, segments, castMembers } from "../../schema";
import { uploadFile, deleteFile } from "../../storage/r2";
import { DEFAULT_NARRATOR_VOICE } from "../../lib/constants";
import { emitProgressEvent, invalidateBookVoiceContextClusterwide } from "../../queue";
import type { BookIdentity, PlannedChapter } from "./planning";

export interface StoredEpub {
  epubR2Key: string;
  uploadedInThisRun: boolean;
}

const SEGMENT_INSERT_BATCH_SIZE = 2_000;

export async function uploadEpubIfMissing(bookId: string, epubBuffer: Buffer, existingEpubR2Key: string | null): Promise<StoredEpub> {
  if (existingEpubR2Key) return { epubR2Key: existingEpubR2Key, uploadedInThisRun: false };

  const epubR2Key = `books/${bookId}/original.epub`;
  await uploadFile(epubR2Key, epubBuffer, "application/epub+zip");
  return { epubR2Key, uploadedInThisRun: true };
}

export async function purgeUploadedEpub(bookId: string, storedEpub: StoredEpub): Promise<void> {
  if (!storedEpub.uploadedInThisRun) return;

  await deleteFile(storedEpub.epubR2Key).catch((err) =>
    console.warn(`Could not purge EPUB of book deleted mid-ingestion (${bookId}):`, err),
  );
}

interface MetadataWriteOutcome {
  bookStillExists: boolean;
}

export async function persistBookMetadata(bookId: string, identity: BookIdentity, epubR2Key: string): Promise<MetadataWriteOutcome> {
  const persisted = await db
    .update(books)
    .set({
      title: identity.title,
      author: identity.author,
      epubR2Key: epubR2Key,
    })
    .where(eq(books.id, bookId))
    .returning({ id: books.id });
  if (persisted.length === 0) return { bookStillExists: false };

  await db
    .update(books)
    .set({
      title: identity.title,
      author: identity.author,
      epubR2Key: epubR2Key,
    })
    .where(eq(books.id, bookId));

  return { bookStillExists: true };
}

export async function insertNarratorCastMember(bookId: string): Promise<void> {
  await db
    .insert(castMembers)
    .values({
      bookId,
      name: "Narrator",
      aliases: ["storyteller", "narrator"],
      importance: "main",
      voiceBucket: "female_adult",
      ttsVoiceName: DEFAULT_NARRATOR_VOICE,
      styleString: "warm neutral storyteller, clear, steady, pacing",
      pronunciationNotes: "Standard pronunciation",
    })
    .onConflictDoNothing({ target: [castMembers.bookId, castMembers.name] });

  invalidateBookVoiceContextClusterwide(bookId);
}

export async function insertChapterRows(bookId: string, planned: PlannedChapter[]): Promise<Map<number, string>> {
  const chapterRows = await db
    .insert(chapters)
    .values(
      planned.map(({ chapter, segments: chapterSegments }) => ({
        bookId,
        chapterIndex: chapter.chapterIndex,
        title: chapter.title,
        status: (chapterSegments.length === 0 ? "failed" : "queued") as "failed" | "queued",
        totalCount: chapterSegments.length,
      })),
    )
    .returning({ id: chapters.id, chapterIndex: chapters.chapterIndex });

  return new Map(chapterRows.map((row) => [row.chapterIndex, row.id]));
}

interface SegmentInsert {
  chapterId: string;
  segmentIndex: number;
  rawText: string;
  status: "pending";
  isSceneBreak: number;
}

export async function insertSegmentRows(planned: PlannedChapter[], chapterIdByIndex: Map<number, string>): Promise<void> {
  let segmentBatch: SegmentInsert[] = [];

  const flushSegments = async () => {
    if (segmentBatch.length === 0) return;
    await db.insert(segments).values(segmentBatch);
    segmentBatch = [];
  };

  for (const { chapter, segments: chapterSegments } of planned) {
    const chapterId = chapterIdByIndex.get(chapter.chapterIndex)!;
    for (const segment of chapterSegments) {
      segmentBatch.push({
        chapterId,
        segmentIndex: segment.segmentIndex,
        rawText: segment.text,
        status: "pending",
        isSceneBreak: segment.isSceneBreak ? 1 : 0,
      });
      if (segmentBatch.length >= SEGMENT_INSERT_BATCH_SIZE) {
        await flushSegments();
      }
    }
  }
  await flushSegments();
}

export function emitEmptyChapterFailures(bookId: string, planned: PlannedChapter[], chapterIdByIndex: Map<number, string>): void {
  for (const { chapter, segments: chapterSegments } of planned) {
    if (chapterSegments.length > 0) continue;

    emitProgressEvent(bookId, "chapter_status", {
      chapterId: chapterIdByIndex.get(chapter.chapterIndex)!,
      status: "failed",
      chapterIndex: chapter.chapterIndex,
      error: "Chapter has no segments to voice",
    });
  }
}
