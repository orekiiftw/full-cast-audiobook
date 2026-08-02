import { BookBlock } from "./epubService";
import { SEGMENT } from "./lib/constants";

export interface SegmentInfo {
  segmentIndex: number;
  text: string;
  isSceneBreak: boolean;
}

/**
 * Splits chapter blocks into logically chunked segments.
 * Each chapter's first segment is a small lead-in (~LEAD_IN_WORDS) so playback
 * unlocks within seconds; remaining segments stay 150-250 words.
 */
export function segmentChapter(blocks: BookBlock[]): SegmentInfo[] {
  const segments: SegmentInfo[] = [];
  let currentTextParts: string[] = [];
  let currentWordCount = 0;
  let segmentIndex = 1;
  // The lead-in budget stays reserved for the FIRST PROSE segment. A chapter
  // opening with a heading ("Chapter 1") flushes its own tiny segment; without
  // this flag that heading consumed the ~70-word fast-unlock lead-in, and the
  // first real paragraph was built with the full 150-250 word budget — so
  // playback stalled right after the spoken heading.
  let leadInPending = true;

  // Helper to push current segment. A heading's own segment is marked so it
  // doesn't consume the reserved lead-in budget.
  const flushSegment = (isSceneBreak: boolean = false, isHeading: boolean = false) => {
    if (currentTextParts.length > 0) {
      segments.push({
        segmentIndex: segmentIndex++,
        text: currentTextParts.join(" ").trim(),
        isSceneBreak,
      });
      currentTextParts = [];
      currentWordCount = 0;
      if (!isHeading) leadInPending = false;
    }
  };

  // Lead-in limits apply only while the chapter's first prose segment is being
  // built (headings never consume the lead-in).
  const limitsFor = () => {
    const isLeadIn = leadInPending;
    return {
      minWords: isLeadIn ? 1 : SEGMENT.MIN_WORDS,
      targetWords: isLeadIn ? SEGMENT.LEAD_IN_WORDS : SEGMENT.TARGET_WORDS,
      maxWords: isLeadIn ? SEGMENT.LEAD_IN_WORDS : SEGMENT.MAX_WORDS,
    };
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const text = block.text.trim();
    if (!text) continue;

    // Detect explicit scene breaks (e.g., ***, * * *, or custom dividers)
    const isExplicitBreak = /^\s*(\*\s*){3,}\s*$/g.test(text) || text === "---" || text === "___";
    if (isExplicitBreak) {
      flushSegment(true);
      continue;
    }

    // Headings should start a new segment
    if (block.type === "heading") {
      flushSegment();
      currentTextParts.push(text);
      currentWordCount += countWords(text);
      flushSegment(false, true); // headings stay as their own short segments
      continue;
    }

    // Split block into sentences; hard-split any run that still exceeds the cap
    // (e.g. a 500-word sentence with no terminal punctuation).
    const sentences = splitIntoSentences(text).flatMap((s) =>
      splitOversizedUnit(s, SEGMENT.HARD_MAX_WORDS)
    );

    for (let j = 0; j < sentences.length; j++) {
      const sentence = sentences[j];
      const sentenceWords = countWords(sentence);
      const { minWords, maxWords } = limitsFor();

      // Rule: Keep dialogue quotes and their direct attribution (e.g. "he said") in the same segment.
      // If we are about to hit the MAX_WORDS limit but we have a small dialogue/attribution sequence,
      // we check if we should flush.
      const isShortDialogue = block.type === "dialogue" && sentenceWords < SEGMENT.SHORT_DIALOGUE_WORDS;

      // If adding this sentence pushes us past the limit, flush first
      if (currentWordCount + sentenceWords > maxWords && currentWordCount >= minWords) {
        // Avoid flushing if we are in the middle of a short dialogue line (keep with attribution)
        if (!isShortDialogue) {
          flushSegment();
        }
      }

      // A single unit at/over HARD_MAX_WORDS always starts its own segment when
      // something is already buffered, so it cannot inflate a near-full block.
      if (
        sentenceWords >= SEGMENT.HARD_MAX_WORDS &&
        currentWordCount > 0 &&
        !isShortDialogue
      ) {
        flushSegment();
      }

      currentTextParts.push(sentence);
      currentWordCount += sentenceWords;

      // Flush immediately after a hard-capped unit so the next sentence starts fresh
      if (sentenceWords >= SEGMENT.HARD_MAX_WORDS) {
        flushSegment();
      }
    }

    // Keep dialogue and attribution in the same segment:
    // If the next block is a short dialogue line or contains dialogue tags, check if we should keep them together
    const { targetWords, maxWords } = limitsFor();
    const nextBlock = blocks[i + 1];
    if (nextBlock && nextBlock.type === "dialogue") {
      const nextWords = countWords(nextBlock.text);
      if (nextWords < SEGMENT.DIALOGUE_KEEP_WORDS && currentWordCount + nextWords <= maxWords) {
        // Keep looping, do not flush between these blocks
        continue;
      }
    }

    // If we've accumulated sufficient words, prepare for next segment
    if (currentWordCount >= targetWords) {
      flushSegment();
    }
  }

  // Flush any remaining content
  flushSegment();

  return segments;
}

/**
 * Counts the number of words in a string
 */
function countWords(str: string): number {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Splits text into sentences by looking for terminal punctuation followed by spaces.
 * Enforces correct abbreviation handling (e.g., Mr., Mrs., Dr., etc.) to avoid false splits.
 */
function splitIntoSentences(text: string): string[] {
  const sentenceBoundaryRegex = /(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|St|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.)(?<=[.!?])\s+(?=[A-Z"“'‘—])/g;
  return text.split(sentenceBoundaryRegex).map(s => s.trim()).filter(Boolean);
}

/**
 * Breaks a single run of text that exceeds `maxWords` into smaller pieces.
 * Prefers clause boundaries (commas, semicolons, em-dashes); falls back to
 * hard word-count slices so TTS never receives an unbounded block.
 */
function splitOversizedUnit(text: string, maxWords: number): string[] {
  if (countWords(text) <= maxWords) {
    return [text];
  }

  // Prefer natural clause breaks before hard-slicing words
  const clauseParts = text
    .split(/(?<=[,;:—–])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (clauseParts.length > 1) {
    const rebuilt: string[] = [];
    let buf: string[] = [];
    let bufWords = 0;
    for (const part of clauseParts) {
      const w = countWords(part);
      if (bufWords > 0 && bufWords + w > maxWords) {
        rebuilt.push(buf.join(" "));
        buf = [];
        bufWords = 0;
      }
      if (w > maxWords) {
        if (buf.length > 0) {
          rebuilt.push(buf.join(" "));
          buf = [];
          bufWords = 0;
        }
        rebuilt.push(...splitByWordCount(part, maxWords));
        continue;
      }
      buf.push(part);
      bufWords += w;
    }
    if (buf.length > 0) rebuilt.push(buf.join(" "));
    return rebuilt;
  }

  return splitByWordCount(text, maxWords);
}

function splitByWordCount(text: string, maxWords: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [text.trim()];
  const parts: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    parts.push(words.slice(i, i + maxWords).join(" "));
  }
  return parts;
}
