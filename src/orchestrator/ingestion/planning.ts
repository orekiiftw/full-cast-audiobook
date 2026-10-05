import type { books } from "../../schema";
import type { ParsedBook } from "../../epub";
import { segmentChapter, type SegmentInfo } from "../../narration/segmenter";
import { EPUB_LIMITS } from "../../lib/constants";

export interface BookIdentity {
  title: string;
  author: string;
}

export interface PlannedChapter {
  chapter: ParsedBook["chapters"][number];
  segments: SegmentInfo[];
}

const PARSED_UNKNOWN_TITLE = "Unknown Title";

const PARSED_UNKNOWN_AUTHOR = "Unknown Author";

type BookRow = typeof books.$inferSelect;

export function resolveBookIdentity(parsedBook: ParsedBook, book: BookRow): BookIdentity {
  return {
    title: parsedBook.title && parsedBook.title !== PARSED_UNKNOWN_TITLE ? parsedBook.title : book.title,
    author: parsedBook.author && parsedBook.author !== PARSED_UNKNOWN_AUTHOR ? parsedBook.author : book.author,
  };
}

export function planChapters(parsedBook: ParsedBook): PlannedChapter[] {
  const planned = parsedBook.chapters.map((chapter) => ({ chapter, segments: segmentChapter(chapter.blocks) }));
  if (planned.length === 0) {
    throw new Error("This book has no chapters to voice.");
  }
  return planned;
}

export function countSegmentsWithinLimits(planned: PlannedChapter[]): number {
  let totalSegmentCount = 0;
  for (const { segments: chapterSegments } of planned) {
    if (chapterSegments.length > EPUB_LIMITS.MAX_SEGMENTS_PER_CHAPTER) {
      throw new Error(`A chapter produced too many segments (over ${EPUB_LIMITS.MAX_SEGMENTS_PER_CHAPTER}).`);
    }
    totalSegmentCount += chapterSegments.length;
    if (totalSegmentCount > EPUB_LIMITS.MAX_SEGMENTS_PER_BOOK) {
      throw new Error(`This book would produce too many segments (over ${EPUB_LIMITS.MAX_SEGMENTS_PER_BOOK}).`);
    }
  }
  return totalSegmentCount;
}
