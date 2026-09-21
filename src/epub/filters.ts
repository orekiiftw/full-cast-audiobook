import { cleanText, countWords } from "./text";
import type { BookBlock } from "./blocks";
import type { HTMLElement } from "node-html-parser";
import { PIPELINE } from "../lib/constants";

const FRONT_BACK_MATTER_TOKENS = new Set([
  "copyright",
  "toc",
  "ncx",
  "cx",
  "contents",
  "nav",
  "cover",
  "index",
  "biblio",
  "references",
  "about",
  "author",
  "ack",
  "acks",
  "advert",
  "adverts",
  "summary",
  "synopsis",
  "preface",
  "foreword",
  "epigraph",
  "praise",
  "imprint",
  "glossary",
  "appendix",
  "endnotes",
  "footnotes",
  "chronology",
  "intro",
  "desc",
  "blurb",
  "teaser",
  "half",
  "title",
  "excerpt",
  "sample",
]);

const FRONT_BACK_STEM_RE =
  /^(?:copy\d+|title\d+|map\d+|half[-_]?title|front[-_]?matter|frontmatter|table[-_]?of[-_]?contents|acknowledg|dedicat|synops|glossar|chronolog|illustrat|appendices|bibliograph)/;

export const FRONT_MATTER_TITLE_RE =
  /^\s*(synopsis|contents|table of contents|list of (chapters|illustrations)|index|preface|foreword|introduction|dedication|epigraph|acknowledg|about the (author|publisher|book|novel|story|edition)|about this (book|edition|novel|story)|also by|by the same author|praise\b|reviews?|editorial review|description|blurb|publisher'?s note|author'?s note|a note\b|note from|note on the text|copyright|illustrations|chronology|a chronology|the editor|half title|reader'?s guide|cast of characters|dramatis personae|preview|excerpt|sample)\b/i;

export const BACK_MATTER_SECTION_RE =
  /^\s*(contexts|criticism|critical (essays|contexts|heritage)|appendix|appendices|bibliography|selected bibliography|works cited|endnotes|notes|glossary|index|about the author|about the publisher|afterword|chronology|a chronology)\b/i;

const BACK_MATTER_MIN_SPINE_FRACTION = 0.6;
const FRONT_MATTER_BODY_MAX_WORDS = 60;
const FRONT_MATTER_BODY_SHORT_BLOCK_WORDS = 25;
const FRONT_MATTER_BODY_SHORT_BLOCK_SHARE = 0.7;
const FRONT_MATTER_BODY_LONG_PROSE_WORDS = 60;
const FRONT_MATTER_BODY_QUOTED_BLOCK_SHARE = 0.5;

const TOC_ENTRY_RE =
  /^(?:chapter|part|book|section|prologue|epilogue|canto|act|volume|story)\s+(?:[ivxlcdm]+|\d+|[a-z]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)(?:\b|[.:)\-–—])/i;

const TOC_NUMBERED_RE = /^(?:[ivxlcdm]+|\d{1,3})[\.\)\:\-–—]\s+\S+/i;

const TOC_LINE_MAX_LENGTH = 120;
const TOC_ENTRY_MAX_WORDS = 14;
const TOC_NARRATIVE_MIN_WORDS = 40;
const TOC_HEADING_MAX_WORDS = 10;
const TOC_DENSE_SHARE = 0.45;
const TOC_DENSE_ENTRIES = 4;
const TOC_SHORT_LINE_SHARE = 0.75;
const TOC_SHORT_LINE_MIN_BLOCKS = 5;
const TOC_MIN_ENTRY_LINES = 3;
const TOC_ALMOST_EVERY_LINE_SHARE = 0.7;

const TOC_NAV_LINKS = 4;
const TOC_NAV_CHAPTERISH_LINKS = 3;
const TOC_NAV_LINKS_WITHOUT_CHECK = 8;
const TOC_LIST_ITEMS = 5;
const TOC_LIST_ENTRIES = 4;
const TOC_LIST_ENTRY_SHARE = 0.5;
const TOC_LIST_TITLE_MAX_WORDS = 12;
const TOC_PAGE_MAX_PROSE_WORDS = 80;

const TOC_LEADING_BLOCKS_MIN = 4;
const TOC_LEADING_RUN_MIN = 3;
const TOC_LEADING_FIRST_PROSE_WORDS = 20;
const TOC_LEADING_FILLER_MAX_WORDS = 6;

export function isFrontBackMatterPath(filePath: string): boolean {
  const stem = (filePath.split("/").pop() ?? filePath).replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  if (FRONT_BACK_STEM_RE.test(stem)) return true;
  return stem.split(/[^a-z0-9]+/).some((part) => FRONT_BACK_MATTER_TOKENS.has(part));
}

export function isBackMatterSwitchPoint(heading: string, spineFraction: number, pageWords: number): boolean {
  return BACK_MATTER_SECTION_RE.test(heading) && spineFraction >= BACK_MATTER_MIN_SPINE_FRACTION && pageWords >= PIPELINE.MIN_BOOK_WORDS;
}

export function isFrontMatterBody(blocks: BookBlock[], heading: string): boolean {
  if (heading && FRONT_MATTER_TITLE_RE.test(heading)) return true;
  const blockCount = blocks.length;
  if (blockCount === 0) return false;

  if (blockCount <= 2) {
    const words = blocks.reduce((total, block) => total + countWords(block.text), 0);
    if (words <= FRONT_MATTER_BODY_MAX_WORDS) return true;
  }

  if (blockCount >= 3) {
    let shortBlocks = 0;
    let longProse = 0;
    let quotedBlocks = 0;
    for (const block of blocks) {
      const words = countWords(block.text);
      if (words <= FRONT_MATTER_BODY_SHORT_BLOCK_WORDS) shortBlocks++;
      if (words >= FRONT_MATTER_BODY_LONG_PROSE_WORDS) longProse++;
      if (block.type === "poem" || block.type === "letter" || /^\s*["“]/.test(block.text)) quotedBlocks++;
    }

    const isShortBlockPage = shortBlocks / blockCount >= FRONT_MATTER_BODY_SHORT_BLOCK_SHARE && longProse === 0;
    const isQuotedBlockPage = quotedBlocks / blockCount >= FRONT_MATTER_BODY_QUOTED_BLOCK_SHARE && longProse === 0;
    if (isShortBlockPage || isQuotedBlockPage) return true;
  }

  return false;
}

export function isTocTypedBody(body: HTMLElement): boolean {
  const epubType = body.getAttribute("epub:type") || "";
  return /\b(toc|contents|landmarks|loi|lot)\b/i.test(epubType);
}

export function isStructuralTocPage(body: HTMLElement, heading: string): boolean {
  if (heading && FRONT_MATTER_TITLE_RE.test(heading)) return true;
  return hasTocNavLinks(body) || hasTocListItems(body);
}

export function looksLikeTableOfContents(blocks: BookBlock[], heading: string): boolean {
  if (heading && FRONT_MATTER_TITLE_RE.test(heading)) return true;
  if (blocks.length < 3) return false;

  let tocish = 0;
  let shortLines = 0;
  let narrativeLong = 0;
  for (const block of blocks) {
    const text = block.text.trim();
    const words = countWords(text);
    if (words <= TOC_ENTRY_MAX_WORDS) shortLines++;
    if (words >= TOC_NARRATIVE_MIN_WORDS) narrativeLong++;
    if (isTocEntryLine(text)) tocish++;
    if (block.type === "heading" && /^(chapter|part|book)\b/i.test(text) && words <= TOC_HEADING_MAX_WORDS) tocish++;
  }

  const blockCount = blocks.length;
  if (tocish >= TOC_DENSE_ENTRIES && tocish / blockCount >= TOC_DENSE_SHARE && narrativeLong <= 1) return true;
  if (
    blockCount >= TOC_SHORT_LINE_MIN_BLOCKS &&
    shortLines / blockCount >= TOC_SHORT_LINE_SHARE &&
    tocish >= TOC_MIN_ENTRY_LINES &&
    narrativeLong === 0
  ) {
    return true;
  }
  if (tocish >= TOC_MIN_ENTRY_LINES && tocish / blockCount >= TOC_ALMOST_EVERY_LINE_SHARE) return true;
  return false;
}

export function stripLeadingTocBlocks(blocks: BookBlock[]): BookBlock[] {
  if (blocks.length < TOC_LEADING_BLOCKS_MIN) return blocks;

  let cut = 0;
  if (blocks[0] && FRONT_MATTER_TITLE_RE.test(blocks[0].text)) {
    cut = 1;
  }

  let consecutive = 0;
  for (let index = cut; index < blocks.length; index++) {
    const text = blocks[index].text;
    const words = countWords(text);
    if (isTocEntryLine(text) || (words <= TOC_HEADING_MAX_WORDS && /^(chapter|part|book)\b/i.test(text))) {
      consecutive++;
      cut = index + 1;
      continue;
    }
    if (words >= TOC_LEADING_FIRST_PROSE_WORDS) break;
    if (words <= TOC_LEADING_FILLER_MAX_WORDS && consecutive > 0) {
      cut = index + 1;
      continue;
    }
    break;
  }

  if (consecutive < TOC_LEADING_RUN_MIN) return blocks;
  if (cut >= blocks.length) return [];
  return blocks.slice(cut);
}

export function isTocEntryLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > TOC_LINE_MAX_LENGTH) return false;
  return (
    TOC_ENTRY_RE.test(trimmed) ||
    TOC_NUMBERED_RE.test(trimmed) ||
    /^chapter\s+([ivxlcdm]+|\d+)\s*$/i.test(trimmed) ||
    /\S.{2,80}\s+[\.·…]{2,}\s*\d{1,4}\s*$/.test(trimmed)
  );
}

function hasTocNavLinks(body: HTMLElement): boolean {
  const nav = body.querySelector("nav, [epub\\:type='toc'], .toc, #toc, #contents");
  if (!nav) return false;

  const links = nav.querySelectorAll("a");
  let chapterish = 0;
  for (const link of links) {
    if (isTocEntryLine(cleanText(link.text)) || /chapter|part|book|prologue/i.test(link.text)) {
      chapterish++;
    }
  }

  if (links.length >= TOC_NAV_LINKS && chapterish >= TOC_NAV_CHAPTERISH_LINKS) return true;
  return links.length >= TOC_NAV_LINKS_WITHOUT_CHECK;
}

function hasTocListItems(body: HTMLElement): boolean {
  const listItems = body.querySelectorAll("ol > li, ul > li");
  if (listItems.length < TOC_LIST_ITEMS) return false;

  let tocish = 0;
  for (const item of listItems) {
    const text = cleanText(item.text);
    if (isTocEntryLine(text) || (countWords(text) <= TOC_LIST_TITLE_MAX_WORDS && /chapter|part|book/i.test(text))) {
      tocish++;
    }
  }
  if (tocish < TOC_LIST_ENTRIES || tocish / listItems.length < TOC_LIST_ENTRY_SHARE) return false;

  const proseNodes = body.querySelectorAll("p");
  let proseWords = 0;
  for (const paragraph of proseNodes) proseWords += countWords(cleanText(paragraph.text));
  return proseWords < TOC_PAGE_MAX_PROSE_WORDS;
}
