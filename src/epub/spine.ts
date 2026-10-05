import { readArchiveEntryText, findArchiveEntry, type ArchiveEntries } from "./archive";
import { countBlockWords, detectHeading, readPageBody, readPageBlocks, type BookBlock } from "./blocks";
import { isChapterStart, type SpinePage } from "./chapters";
import { FRONT_MATTER_TITLE_RE, isBackMatterSwitchPoint, isFrontBackMatterPath } from "./filters";
import { isStructuralTocPage, isTocTypedBody, looksLikeTableOfContents, stripLeadingTocBlocks } from "./filters";
import { EPUB_LIMITS } from "../lib/constants";

interface HeldPage {
  title: string;
  blocks: BookBlock[];
  pageWords: number;
}

const NON_PROSE_PAGE_MAX_WORDS = 50;

interface SpineReadState {
  accepted: SpinePage[];
  held: HeldPage[];
  inBackMatter: boolean;
  totalTextBytes: number;
  totalPageWords: number;
}

export function readSpinePages(entries: ArchiveEntries, readingOrder: string[], bookTitle: string): SpinePage[] {
  const state: SpineReadState = { accepted: [], held: [], inBackMatter: false, totalTextBytes: 0, totalPageWords: 0 };

  readingOrder.forEach((filePath, spineIndex) => {
    readSpineFile(state, entries, filePath, (spineIndex + 1) / readingOrder.length, bookTitle);
  });

  return acceptedPages(state);
}

function readSpineFile(state: SpineReadState, entries: ArchiveEntries, filePath: string, spineFraction: number, bookTitle: string): void {
  if (isFrontBackMatterPath(filePath)) return;
  if (!findArchiveEntry(entries, filePath)) {
    console.warn(`Spine file not found in ZIP: ${filePath}`);
    return;
  }

  const htmlContent = readArchiveEntryText(entries, filePath, EPUB_LIMITS.MAX_SPINE_FILE_BYTES, "chapter file");
  state.totalTextBytes += htmlContent.length;
  if (state.totalTextBytes > EPUB_LIMITS.MAX_TOTAL_TEXT_BYTES) {
    throw new Error("This EPUB contains too much text to process.");
  }

  const body = readPageBody(htmlContent);
  if (!body) return;

  const heading = detectHeading(body, bookTitle);
  if (isBackMatterSwitchPoint(heading, spineFraction, state.totalPageWords)) {
    state.inBackMatter = true;
  }
  if (state.inBackMatter) return;
  if (heading && FRONT_MATTER_TITLE_RE.test(heading)) return;
  if (isTocTypedBody(body)) return;

  if (isStructuralTocPage(body, heading)) {
    console.log(`⏭️ Skipping structural TOC page: "${heading || filePath}"`);
    return;
  }

  const blocks = readPageBlocks(body, bookTitle);
  if (blocks.length > 0 && looksLikeTableOfContents(blocks, heading)) {
    console.log(`⏭️ Skipping TOC/index page: "${heading || filePath}"`);
    return;
  }

  const trimmedBlocks = stripLeadingTocBlocks(blocks);
  if (trimmedBlocks.length === 0) return;

  acceptOrHoldPage(state, heading, trimmedBlocks, filePath);
}

function acceptOrHoldPage(state: SpineReadState, title: string, blocks: BookBlock[], filePath: string): void {
  const pageWords = countBlockWords(blocks);
  state.totalPageWords += pageWords;

  if (state.accepted.length === 0 && !isChapterStart(title, filePath, blocks, pageWords)) {
    console.log(`⏭️ Holding pre-narrative page before Chapter 1: "${title || filePath}" (${pageWords} words)`);
    state.held.push({ title, blocks, pageWords });
    return;
  }

  if (pageWords > NON_PROSE_PAGE_MAX_WORDS) {
    state.accepted.push({ title, blocks, words: pageWords, hasHeading: blocks.some((block) => block.type === "heading") });
  }
}

function acceptedPages(state: SpineReadState): SpinePage[] {
  if (state.accepted.length > 0 || state.held.length === 0) return state.accepted;

  console.log(`📄 No chapter-start signal found; using ${state.held.length} held pages as content.`);
  return state.held
    .filter((page) => page.pageWords > NON_PROSE_PAGE_MAX_WORDS)
    .map((page) => ({
      title: page.title,
      blocks: page.blocks,
      words: page.pageWords,
      hasHeading: page.blocks.some((block) => block.type === "heading"),
    }));
}
