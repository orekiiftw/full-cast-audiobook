import { countBlockWords, type BookBlock } from "./blocks";
import { FRONT_MATTER_TITLE_RE, isFrontMatterBody } from "./filters";
import { endsAtSentenceBoundary } from "./text";
import { EPUB_LIMITS } from "../lib/constants";

export interface SpinePage {
  title: string;
  blocks: BookBlock[];
  words: number;
  hasHeading: boolean;
}

export interface ParsedChapter {
  title: string;
  chapterIndex: number;
  blocks: BookBlock[];
}

export interface ParsedBook {
  title: string;
  author: string;
  chapters: ParsedChapter[];
}

const CHAPTER_START_MIN_WORDS = 400;
const CHAPTER_START_HEADING_RE = /^\s*(prologue|chapter|volume|part|book)\s+/i;
const CHAPTER_START_FILENAME_RE = /ch(?:apter)?[_-]?\d|part[_-]?\d|prologue/i;

export function isChapterStart(heading: string, filePath: string, blocks: BookBlock[], pageWords: number): boolean {
  return (
    CHAPTER_START_HEADING_RE.test(heading) ||
    CHAPTER_START_FILENAME_RE.test(filePath) ||
    (pageWords >= CHAPTER_START_MIN_WORDS && !isFrontMatterBody(blocks, heading))
  );
}

export function aggregateChapters(pages: SpinePage[], bookTitle: string): ParsedChapter[] {
  const minChapterWords = minChapterWordsFor(pages);
  const chapters: ParsedChapter[] = [];

  for (const page of pages) {
    const current = chapters[chapters.length - 1];
    if (current && !startsNewChapter(current, page, minChapterWords)) {
      current.blocks.push(...page.blocks);
      continue;
    }

    assertChapterBudget(chapters);
    chapters.push(openChapter(page, bookTitle, chapters.length + 1));
  }

  return chapters;
}

function minChapterWordsFor(pages: SpinePage[]): number {
  const medianWords = pages.map((page) => page.words).sort((a, b) => a - b)[Math.floor(pages.length / 2)] ?? 0;
  if (medianWords >= EPUB_LIMITS.PAGE_MAX_WORDS) return 0;

  console.log(
    `📖 Page-based spine (median page ${medianWords} words): merging pages into chapters of at least ${EPUB_LIMITS.MIN_CHAPTER_WORDS} words.`,
  );
  return EPUB_LIMITS.MIN_CHAPTER_WORDS;
}

function startsNewChapter(current: ParsedChapter, page: SpinePage, minChapterWords: number): boolean {
  if (page.hasHeading) return true;
  if (countBlockWords(current.blocks) < minChapterWords) return false;
  return endsAtSentenceBoundary(current.blocks[current.blocks.length - 1]?.text ?? "");
}

function assertChapterBudget(chapters: ParsedChapter[]): void {
  if (chapters.length >= EPUB_LIMITS.MAX_CHAPTERS) {
    throw new Error(`This EPUB has too many sections (over ${EPUB_LIMITS.MAX_CHAPTERS}).`);
  }
}

function openChapter(page: SpinePage, bookTitle: string, chapterIndex: number): ParsedChapter {
  const title =
    page.title && page.title.toLowerCase() !== bookTitle.toLowerCase() && !FRONT_MATTER_TITLE_RE.test(page.title)
      ? page.title
      : `Chapter ${chapterIndex}`;

  return { title, chapterIndex, blocks: [...page.blocks] };
}
