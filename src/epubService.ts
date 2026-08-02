import AdmZip from "adm-zip";
import { parse } from "node-html-parser";
import * as path from "path";
import { inflateRawSync } from "node:zlib";
import { EPUB_LIMITS, PIPELINE } from "./lib/constants";

export interface BookBlock {
  type: "heading" | "narration" | "dialogue" | "footnote" | "poem" | "letter";
  text: string;
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

/** Filename-stem tokens that mark front/back matter (matched exactly). */
const FRONT_BACK_MATTER_TOKENS = new Set([
  "copyright", "toc", "ncx", "cx", "contents", "nav", "cover", "index",
  "biblio", "references", "about", "author", "ack", "acks", "advert",
  "adverts", "summary", "synopsis", "preface", "foreword", "epigraph",
  "praise", "imprint", "glossary", "appendix", "endnotes", "footnotes",
  "chronology", "intro", "desc", "blurb", "teaser", "half", "title",
  "excerpt", "sample",
]);

/** Stem prefixes for longer matter filenames (acknowledgments, dedication…). */
const FRONT_BACK_STEM_RE =
  /^(?:copy\d+|title\d+|map\d+|half[-_]?title|front[-_]?matter|frontmatter|table[-_]?of[-_]?contents|acknowledg|dedicat|synops|glossar|chronolog|illustrat|appendices|bibliograph)/;

/**
 * Path-based front/back-matter detector. Matches the file's basename stem
 * against exact tokens (or a few prefix families) instead of substring
 * matching on the whole path: the old /ack|desc|intro|title\d/ unanchored
 * regex silently dropped real chapter files like jack.xhtml, descent.xhtml,
 * or attack_ch2.xhtml.
 */
function isFrontBackMatterPath(filePath: string): boolean {
  const stem = (filePath.split("/").pop() ?? filePath).replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  if (FRONT_BACK_STEM_RE.test(stem)) return true;
  return stem.split(/[^a-z0-9]+/).some((part) => FRONT_BACK_MATTER_TOKENS.has(part));
}

/**
 * Heading-text hints for front matter — pages like "Synopsis", "Preface",
 * "Introduction", "Dedication" are skipped so chunking starts at the main text.
 */
const FRONT_MATTER_TITLE_RE =
  /^\s*(synopsis|contents|table of contents|list of (chapters|illustrations)|index|preface|foreword|introduction|dedication|epigraph|acknowledg|about the (author|publisher|book|novel|story|edition)|about this (book|edition|novel|story)|also by|by the same author|praise\b|reviews?|editorial review|description|blurb|publisher'?s note|author'?s note|a note\b|note from|note on the text|copyright|illustrations|chronology|a chronology|the editor|half title|reader'?s guide|cast of characters|dramatis personae|preview|excerpt|sample)\b/i;

/** A single line that looks like a TOC / chapter-list entry. */
const TOC_ENTRY_RE =
  /^(?:chapter|part|book|section|prologue|epilogue|canto|act|volume|story)\s+(?:[ivxlcdm]+|\d+|[a-z]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)(?:\b|[.:)\-–—])/i;

const TOC_NUMBERED_RE = /^(?:[ivxlcdm]+|\d{1,3})[\.\)\:\-–—]\s+\S+/i;

/**
 * Section dividers that mark the END of the main text. Once one appears,
 * everything after it is critical apparatus, not the book.
 */
const BACK_MATTER_SECTION_RE =
  /^\s*(contexts|criticism|critical (essays|contexts|heritage)|appendix|appendices|bibliography|selected bibliography|works cited|endnotes|notes|glossary|index|about the author|about the publisher|afterword|chronology|a chronology)\b/i;

/**
 * Inflates a zip entry with a hard output cap. Deflate (method 8) is the only
 * scheme that can amplify a small declared size into a huge allocation, so it
 * is inflated with zlib's maxOutputLength — a forged header (declared small,
 * inflates gigabytes) throws inside zlib BEFORE the output buffer is fully
 * allocated, instead of materializing it and OOMing the process. Stored (and
 * other rare) methods cannot amplify beyond the archive's own bytes.
 */
function inflateEntryCapped(entry: AdmZip.IZipEntry, maxBytes: number, what: string): Buffer {
  if (entry.header.method === 8) {
    try {
      return inflateRawSync(entry.getCompressedData(), { maxOutputLength: maxBytes + 1 });
    } catch (err) {
      if (err instanceof RangeError) {
        throw new Error(`EPUB ${what} is too large (over ${Math.round(maxBytes / (1024 * 1024))}MB uncompressed).`);
      }
      throw new Error(`EPUB ${what} could not be decompressed (${err instanceof Error ? err.message : String(err)}).`);
    }
  }
  return entry.getData();
}

/**
 * Reads a zip entry as text with a hard cap on its uncompressed size.
 * The declared header size is checked before inflating, and the actual
 * inflated length is checked after (headers can lie).
 */
function readEntryTextCapped(
  entry: AdmZip.IZipEntry,
  maxBytes: number,
  what: string
): string {
  if (entry.header.size > maxBytes) {
    throw new Error(`EPUB ${what} is too large (over ${Math.round(maxBytes / (1024 * 1024))}MB uncompressed).`);
  }
  const data = inflateEntryCapped(entry, maxBytes, what);
  if (data.length > maxBytes) {
    throw new Error(`EPUB ${what} is too large (over ${Math.round(maxBytes / (1024 * 1024))}MB uncompressed).`);
  }
  return data.toString("utf-8");
}

/**
 * Parses an EPUB buffer and extracts structured text blocks chapter-by-chapter.
 */
export function parseEpub(buffer: Buffer): ParsedBook {
  const zip = new AdmZip(buffer);

  // Zip-bomb guard: reject archives whose declared uncompressed payload is
  // absurd before we inflate any of it into this process's memory.
  let declaredTotal = 0;
  for (const entry of zip.getEntries()) {
    declaredTotal += entry.header.size;
    if (declaredTotal > EPUB_LIMITS.MAX_TOTAL_DECOMPRESSED_BYTES) {
      throw new Error("This EPUB expands to an unreasonable size and cannot be processed.");
    }
  }

  // 1. Locate container.xml to find the root OPF file path
  const containerEntry = zip.getEntry("META-INF/container.xml");
  if (!containerEntry) {
    throw new Error("Invalid EPUB: Missing META-INF/container.xml");
  }

  const containerContent = readEntryTextCapped(containerEntry, EPUB_LIMITS.MAX_CONTAINER_BYTES, "container.xml");
  // Attribute order and quoting vary across valid EPUBs — match the tag, then
  // find the full-path attribute inside it, rather than demanding it be the
  // first attribute with double quotes.
  const rootfileTag = containerContent.match(/<rootfile\b[^>]*>/i)?.[0] ?? "";
  const rootfilePath = rootfileTag.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!rootfilePath) {
    throw new Error("Invalid container.xml: Cannot find rootfile path");
  }

  const opfPath = rootfilePath.replace(/\\/g, "/").split("#")[0].split("?")[0];
  const opfEntry = zip.getEntry(opfPath);
  if (!opfEntry) {
    throw new Error(`Missing OPF file at path: ${opfPath}`);
  }

  const opfDir = path.dirname(opfPath);
  const opfContent = readEntryTextCapped(opfEntry, EPUB_LIMITS.MAX_OPF_BYTES, "package document");
  const opfDoc = parse(opfContent);

  // 2. Parse Metadata (Title & Author)
  const titleNode = opfDoc.querySelector("dc\\:title") || opfDoc.querySelector("title");
  const authorNode = opfDoc.querySelector("dc\\:creator") || opfDoc.querySelector("creator");

  const title = titleNode ? titleNode.text.trim() : "Unknown Title";
  const author = authorNode ? authorNode.text.trim() : "Unknown Author";

  // 3. Parse Manifest (map ID to relative path)
  const manifestItems = opfDoc.querySelectorAll("manifest item");
  const manifestMap = new Map<string, string>();
  for (const item of manifestItems) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) {
      // Clean and resolve path relative to OPF folder. Strip #fragment and
      // ?query (real EPUBs ship these; the zip entry name never carries them)
      // and normalize Windows-style backslashes.
      const cleanedHref = safeDecodeHref(href).split("#")[0].split("?")[0].replace(/\\/g, "/");
      const resolvedPath = path.posix.join(opfDir, cleanedHref);
      manifestMap.set(id, resolvedPath);
    }
  }

  // 4. Parse Spine (get items in reading order)
  const spineItems = opfDoc.querySelectorAll("spine itemref");
  const readingOrder: string[] = [];
  for (const itemref of spineItems) {
    const idref = itemref.getAttribute("idref");
    if (!idref) continue;
    // linear="no" marks out-of-sequence content (footnote blocks, back-matter
    // trees, popups) — voicing it inline would read the book out of order.
    if ((itemref.getAttribute("linear") ?? "yes").toLowerCase() === "no") continue;
    const filePath = manifestMap.get(idref);
    if (filePath) {
      readingOrder.push(filePath);
    }
  }

  if (readingOrder.length === 0) {
    throw new Error("Invalid EPUB: Spine is empty or could not be mapped to files.");
  }

  // 5. Parse each file in the spine, filtering out front/back matter
  const chapters: ParsedChapter[] = [];
  let chapterIndex = 1;
  let inBackMatter = false;
  let totalTextBytes = 0;
  let totalPageWords = 0;

  for (let spineIdx = 0; spineIdx < readingOrder.length; spineIdx++) {
    const filePath = readingOrder[spineIdx];
    if (isFrontBackMatterPath(filePath)) {
      continue;
    }

    const fileEntry = zip.getEntry(filePath);
    if (!fileEntry) {
      console.warn(`Spine file not found in ZIP: ${filePath}`);
      continue;
    }

    const htmlContent = readEntryTextCapped(fileEntry, EPUB_LIMITS.MAX_SPINE_FILE_BYTES, "chapter file");
    totalTextBytes += htmlContent.length;
    if (totalTextBytes > EPUB_LIMITS.MAX_TOTAL_TEXT_BYTES) {
      throw new Error("This EPUB contains too much text to process.");
    }
    const parsedPage = parse(htmlContent);
    
    // Remove scripts, styles, embedded images etc.
    parsedPage.querySelectorAll("script, style, img, svg").forEach(el => el.remove());
    
    // Strip baked-in page numbers (common markers: epub:type="pagebreak", class="pagebreak", class="page")
    parsedPage.querySelectorAll("[epub\\:type='pagebreak'], .pagebreak, .page").forEach(el => el.remove());
    
    // Strip footnote reference markers like <sup><a href="...">1</a></sup> or [1]
    parsedPage.querySelectorAll("sup").forEach(sup => {
      if (sup.querySelector("a")) {
        sup.remove();
      }
    });

    const bodyNode = parsedPage.querySelector("body");
    if (!bodyNode) continue;

    const rawHeading = detectHeading(bodyNode, title);

    // Section dividers like "CONTEXTS" / "CRITICISM" mark the end of the
    // main text in critical editions & anthologies — everything after them
    // is apparatus (essays, notes, bibliographies), not the book. Only latch
    // this near the end of the spine and after real content: a mid-book part
    // literally titled "Notes"/"Afterword" (or a false-positive heading) used
    // to silently truncate the rest of the book.
    if (rawHeading && BACK_MATTER_SECTION_RE.test(rawHeading)) {
      const spineFraction = (spineIdx + 1) / readingOrder.length;
      if (spineFraction >= 0.6 && totalPageWords >= PIPELINE.MIN_BOOK_WORDS) {
        inBackMatter = true;
      }
    }
    if (inBackMatter) continue;

    // Skip front-matter pages identified by their heading (synopsis, preface…)
    if (rawHeading && FRONT_MATTER_TITLE_RE.test(rawHeading)) {
      continue;
    }

    // nav/epub:type="toc" landmark pages
    const epubType = bodyNode.getAttribute("epub:type") || "";
    if (/\b(toc|contents|landmarks|loi|lot)\b/i.test(epubType)) {
      continue;
    }

    // Structural TOC: nav landmark or dense list of chapter links
    if (isStructuralTocPage(bodyNode, rawHeading)) {
      console.log(`⏭️ Skipping structural TOC page: "${rawHeading || filePath}"`);
      continue;
    }

    let blocks: BookBlock[] = [];

    // Process text paragraphs only (not <li>/<a> — those duplicate TOC noise)
    const paragraphs = bodyNode.querySelectorAll("p, h1, h2, h3, h4, h5, h6, blockquote");
    for (const p of paragraphs) {
      const text = cleanText(p.text);
      if (!text) continue;

      // Drop running heads (bare book title) and stray page numbers
      if (text.length < 60 && text.toLowerCase() === title.toLowerCase()) continue;
      if (/^\d{1,4}$/.test(text)) continue;
      // Drop bare page-number tails like "…… 42" common in TOCs
      if (/^[.…·•\-\s]*\d{1,4}\s*$/.test(text)) continue;

      // Classify the block
      const tagName = p.tagName.toLowerCase();
      let type: BookBlock["type"] = "narration";

      if (/^h[1-6]$/.test(tagName)) {
        type = "heading";
      } else if (p.getAttribute("class")?.includes("footnote") || p.getAttribute("epub:type")?.includes("footnote")) {
        type = "footnote";
      } else if (tagName === "blockquote" || p.getAttribute("class")?.includes("poem")) {
        type = "poem";
      } else if (p.getAttribute("class")?.includes("letter") || p.getAttribute("class")?.includes("epistle")) {
        type = "letter";
      } else if (isDialogue(text)) {
        type = "dialogue";
      }

      blocks.push({ type, text });
    }

    // Whole page is a table of contents / chapter index — never voice it
    if (blocks.length > 0 && looksLikeTableOfContents(blocks, rawHeading)) {
      console.log(`⏭️ Skipping TOC/index page: "${rawHeading || filePath}"`);
      continue;
    }

    // TOC sometimes sits at the top of the first narrative file — strip it
    blocks = stripLeadingTocBlocks(blocks);

    if (blocks.length > 0) {
      // Verify this page is not just metadata (TOC, title) by checking if it has substantial content
      const pageWords = blocks.reduce((acc, b) => acc + b.text.split(/\s+/).length, 0);
      totalPageWords += pageWords;

      // The first accepted page becomes "Chapter 1", so it must be the actual
      // start of the main story — never a description, dedication, "praise"
      // quote list, author's note, or publisher blurb that simply happens to
      // be long. Require either an explicit chapter/narrative-start signal
      // (heading or filename) or enough prose that it cannot be front matter.
      const looksLikeChapterStart =
        /^\s*(prologue|chapter|volume|part|book)\s+/i.test(rawHeading) ||
        /ch(?:apter)?[_-]?\d|part[_-]?\d|prologue/i.test(filePath) ||
        (pageWords >= 400 && !isFrontMatterBody(blocks, rawHeading));

      if (chapters.length === 0 && !looksLikeChapterStart) {
        console.log(`⏭️ Skipping pre-narrative page before Chapter 1: "${rawHeading || filePath}" (${pageWords} words)`);
        continue;
      }

      if (pageWords > 50) {
        if (chapters.length >= EPUB_LIMITS.MAX_CHAPTERS) {
          throw new Error(`This EPUB has too many sections (over ${EPUB_LIMITS.MAX_CHAPTERS}).`);
        }
        const chapterTitle =
          rawHeading &&
          rawHeading.toLowerCase() !== title.toLowerCase() &&
          !FRONT_MATTER_TITLE_RE.test(rawHeading)
            ? rawHeading
            : `Chapter ${chapterIndex}`;

        chapters.push({
          title: chapterTitle,
          chapterIndex: chapterIndex++,
          blocks,
        });
      }
    }
  }

  // Reject books under the minimum word count (main text only)
  const totalWordCount = chapters.reduce(
    (acc, ch) => acc + ch.blocks.reduce((a, b) => a + b.text.split(/\s+/).length, 0),
    0
  );
  if (totalWordCount < PIPELINE.MIN_BOOK_WORDS) {
    throw new Error(`The book content is too short (only ${totalWordCount} words). Minimum word count required is ${PIPELINE.MIN_BOOK_WORDS} words.`);
  }

  console.log(`📚 Parsed "${title}" by ${author}: ${chapters.length} chapters, ${totalWordCount} words.`);

  return {
    title,
    author,
    chapters,
  };
}

/**
 * decodeURIComponent throws a URIError on malformed percent-escapes
 * (e.g. a literal "%" not followed by two hex digits). Broken EPUBs ship
 * manifest hrefs like that, so fall back to the raw href instead of
 * aborting the whole ingestion.
 */
function safeDecodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/**
 * Finds a page's heading text. Many EPUBs (e.g. Norton critical editions)
 * mark headings with classes like "partTitle"/"chapterTitle2" on <p> tags
 * instead of h1–h3, so both forms are detected.
 */
function detectHeading(bodyNode: ReturnType<typeof parse>, bookTitle: string): string {
  const isBareTitle = (t: string) => t.toLowerCase() === bookTitle.toLowerCase();

  for (const h of bodyNode.querySelectorAll("h1, h2, h3")) {
    const t = h.text.trim();
    if (t && !isBareTitle(t)) return t;
  }

  for (const el of bodyNode.querySelectorAll("p, div, span")) {
    const cls = el.getAttribute("class") || "";
    if (/title|head/i.test(cls)) {
      const t = el.text.trim();
      if (t && t.length < 120 && !isBareTitle(t)) return t;
    }
  }
  return "";
}

/**
 * Removes double spaces, handles footnote citation cleanups, and normalizes smart quotes.
 */
function cleanText(text: string): string {
  let cleaned = text
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    // Strip citation markers like [1], [23]
    .replace(/\[\d+\]/g, "")
    .trim();

  // Normalize smart quotes to standard single/double formats for consistent parser logic
  cleaned = cleaned
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

  return cleaned;
}

/**
 * Checks if a string starts or ends with quote marks or standard speech indicators
 */
function isDialogue(text: string): boolean {
  // Dialogue usually starts/ends with double quotes or starts with an em-dash/en-dash
  const trimmed = text.trim();
  return (
    trimmed.startsWith('"') ||
    trimmed.endsWith('"') ||
    trimmed.startsWith("'") ||
    trimmed.endsWith("'") ||
    trimmed.startsWith("—") ||
    trimmed.startsWith("- ")
  );
}

/**
 * Detects TOC pages built as <nav>/<ol>/<ul> link lists (common in EPUB3).
 */
function isStructuralTocPage(bodyNode: ReturnType<typeof parse>, heading: string): boolean {
  if (heading && FRONT_MATTER_TITLE_RE.test(heading)) return true;

  const nav = bodyNode.querySelector("nav, [epub\\:type='toc'], .toc, #toc, #contents");
  if (nav) {
    const links = nav.querySelectorAll("a");
    let chapterish = 0;
    for (const a of links) {
      if (isTocEntryLine(cleanText(a.text)) || /chapter|part|book|prologue/i.test(a.text)) {
        chapterish++;
      }
    }
    if (links.length >= 4 && chapterish >= 3) return true;
    if (links.length >= 8) return true;
  }

  // Bare ordered/unordered lists of chapter titles (no <nav>)
  const listItems = bodyNode.querySelectorAll("ol > li, ul > li");
  if (listItems.length >= 5) {
    let tocish = 0;
    for (const li of listItems) {
      const t = cleanText(li.text);
      if (isTocEntryLine(t) || (t.split(/\s+/).length <= 12 && /chapter|part|book/i.test(t))) {
        tocish++;
      }
    }
    if (tocish >= 4 && tocish / listItems.length >= 0.5) {
      // Only treat as TOC when the page has little non-list prose
      const prose = bodyNode.querySelectorAll("p");
      let proseWords = 0;
      for (const p of prose) proseWords += cleanText(p.text).split(/\s+/).filter(Boolean).length;
      if (proseWords < 80) return true;
    }
  }

  return false;
}

function isTocEntryLine(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 120) return false;
  // "Chapter 1", "Chapter I. The Beginning", "Part Two"
  if (TOC_ENTRY_RE.test(t)) return true;
  // "1. Arrival", "IV. The Storm"
  if (TOC_NUMBERED_RE.test(t)) return true;
  // Bare "Chapter 3" / "CHAPTER XII"
  if (/^chapter\s+([ivxlcdm]+|\d+)\s*$/i.test(t)) return true;
  // Dotted leaders: "The Beginning .......... 12"
  if (/\S.{2,80}\s+[\.·…]{2,}\s*\d{1,4}\s*$/.test(t)) return true;
  return false;
}

/**
 * True when a page is (almost) entirely a chapter index / table of contents.
 * Prevents the narrator reading "Chapter 1, Chapter 2, Chapter 3…" as audio.
 */
function looksLikeTableOfContents(blocks: BookBlock[], heading: string): boolean {
  if (heading && FRONT_MATTER_TITLE_RE.test(heading)) return true;
  if (blocks.length < 3) return false;

  let tocish = 0;
  let shortLines = 0;
  let narrativeLong = 0;

  for (const b of blocks) {
    const t = b.text.trim();
    const words = t.split(/\s+/).filter(Boolean).length;
    if (words <= 14) shortLines++;
    if (words >= 40) narrativeLong++;
    if (isTocEntryLine(t)) tocish++;
    // Heading that is itself "Chapter N" counts
    if (b.type === "heading" && /^(chapter|part|book)\b/i.test(t) && words <= 10) tocish++;
  }

  const n = blocks.length;
  // Dense TOC listing with little narrative prose
  if (tocish >= 4 && tocish / n >= 0.45 && narrativeLong <= 1) return true;
  // Short-line index with several chapter-like entries
  if (n >= 5 && shortLines / n >= 0.75 && tocish >= 3 && narrativeLong === 0) return true;
  // Almost every line is a TOC entry
  if (tocish >= 3 && tocish / n >= 0.7) return true;
  return false;
}

/**
 * Detects front-matter pages that slip past the heading regex because they
 * have no recognizable title. These are structurally distinct from a chapter:
 * a single dedication/epigraph (one short blockquote), a "praise"/review
 * page (many short blocks, little prose, often blockquotes/italics), or an
 * about-the-book blurb. A genuine chapter has long prose paragraphs.
 */
function isFrontMatterBody(blocks: BookBlock[], heading: string): boolean {
  if (heading && FRONT_MATTER_TITLE_RE.test(heading)) return true;
  const n = blocks.length;
  if (n === 0) return false;

  // A lone dedication / epigraph line (often a blockquote or short block)
  if (n <= 2) {
    const words = blocks.reduce((a, b) => a + b.text.split(/\s+/).length, 0);
    if (words <= 60) return true;
  }

  // Praise / review / quote list: many short blocks, almost no long prose.
  if (n >= 3) {
    let shortBlocks = 0;
    let longProse = 0;
    let quotedBlocks = 0;
    for (const b of blocks) {
      const words = b.text.split(/\s+/).length;
      if (words <= 25) shortBlocks++;
      if (words >= 60) longProse++;
      if (b.type === "poem" || b.type === "letter" || /^\s*["“]/.test(b.text)) quotedBlocks++;
    }
    if (shortBlocks / n >= 0.7 && longProse === 0) return true;
    if (quotedBlocks / n >= 0.5 && longProse === 0) return true;
  }

  return false;
}

/**
 * Strips a leading run of TOC-style entries when they precede real prose
 * (common when TOC and Chapter 1 share one HTML file).
 */
function stripLeadingTocBlocks(blocks: BookBlock[]): BookBlock[] {
  if (blocks.length < 4) return blocks;

  let cut = 0;
  // Optional "Contents" heading first
  if (blocks[0] && FRONT_MATTER_TITLE_RE.test(blocks[0].text)) {
    cut = 1;
  }

  let consecutive = 0;
  for (let i = cut; i < blocks.length; i++) {
    const t = blocks[i].text;
    const words = t.split(/\s+/).filter(Boolean).length;
    if (isTocEntryLine(t) || (words <= 10 && /^(chapter|part|book)\b/i.test(t))) {
      consecutive++;
      cut = i + 1;
      continue;
    }
    // Stop at first real prose paragraph
    if (words >= 20) break;
    // Short non-TOC filler (blank-ish headings) — keep scanning a bit
    if (words <= 6 && consecutive > 0) {
      cut = i + 1;
      continue;
    }
    break;
  }

  // Only strip when we saw a real TOC run
  if (consecutive < 3) return blocks;
  if (cut >= blocks.length) return [];
  return blocks.slice(cut);
}
