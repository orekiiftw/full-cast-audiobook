import { openEpubArchive } from "./archive";
import { readBookMetadata, readPackageDocument, resolvePackagePath, resolveReadingOrder } from "./opf";
import { readSpinePages } from "./spine";
import { aggregateChapters, type ParsedBook } from "./chapters";
import { countBlockWords } from "./blocks";
import { PIPELINE } from "../lib/constants";

export type { BookBlock } from "./blocks";
export type { ParsedChapter, ParsedBook, SpinePage } from "./chapters";

export function parseEpub(buffer: Buffer): ParsedBook {
  const entries = openEpubArchive(buffer);
  const packagePath = resolvePackagePath(entries);
  const packageDocument = readPackageDocument(entries, packagePath);
  const { title, author } = readBookMetadata(packageDocument.content, packageDocument.document);
  const readingOrder = resolveReadingOrder(packageDocument.document, packageDocument.directory);
  const chapters = aggregateChapters(readSpinePages(entries, readingOrder, title), title);

  const wordCount = chapters.reduce((total, chapter) => total + countBlockWords(chapter.blocks), 0);
  if (wordCount < PIPELINE.MIN_BOOK_WORDS) {
    throw new Error(
      `The book content is too short (only ${wordCount} words). Minimum word count required is ${PIPELINE.MIN_BOOK_WORDS} words.`,
    );
  }

  console.log(`📚 Parsed "${title}" by ${author}: ${chapters.length} chapters, ${wordCount} words.`);

  return { title, author, chapters };
}
