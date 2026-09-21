import type { BookBlock } from "../epub";
import { SEGMENT } from "../lib/constants";

export interface SegmentInfo {
  segmentIndex: number;
  text: string;
  isSceneBreak: boolean;
}

interface SegmentRun {
  segments: SegmentInfo[];
  bufferedParts: string[];
  bufferedWords: number;
  nextIndex: number;
  isLeadInPending: boolean;
}

interface SegmentLimits {
  minWords: number;
  targetWords: number;
  maxWords: number;
}

type FlushReason = "scene-break" | "heading";

const EXPLICIT_SCENE_BREAK_RE = /^\s*(\*\s*){3,}\s*$/;
const SCENE_BREAK_MARKERS = new Set(["---", "___"]);
const SENTENCE_BOUNDARY_RE = /(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|St|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.)(?<=[.!?।॥…])\s+/;
const CLAUSE_BOUNDARY_RE = /(?<=[,;:—–])\s+/;

export function segmentChapter(blocks: BookBlock[]): SegmentInfo[] {
  const run = createSegmentRun();

  blocks.forEach((block, index) => {
    const text = block.text.trim();
    if (!text) return;

    if (isSceneBreakLine(text)) {
      flushSegment(run, "scene-break");
      return;
    }

    if (block.type === "heading") {
      flushHeading(run, text);
      return;
    }

    appendBlockSentences(run, block, text);

    if (keepsDialogueWithNext(run, blocks[index + 1])) return;
    if (run.bufferedWords >= limitsFor(run).targetWords && endsSentence(run.bufferedParts)) {
      flushSegment(run);
    }
  });

  flushSegment(run);

  return run.segments;
}

function isSceneBreakLine(text: string): boolean {
  return EXPLICIT_SCENE_BREAK_RE.test(text) || SCENE_BREAK_MARKERS.has(text);
}

function flushHeading(run: SegmentRun, text: string): void {
  flushSegment(run);
  appendPart(run, text);
  flushSegment(run, "heading");
}

function keepsDialogueWithNext(run: SegmentRun, nextBlock: BookBlock | undefined): boolean {
  if (nextBlock?.type !== "dialogue") return false;

  const nextWords = countWords(nextBlock.text);
  return nextWords < SEGMENT.DIALOGUE_KEEP_WORDS && run.bufferedWords + nextWords <= limitsFor(run).maxWords;
}

function appendBlockSentences(run: SegmentRun, block: BookBlock, text: string): void {
  const sentences = splitIntoSentences(text).flatMap((sentence) => splitOversizedUnit(sentence, SEGMENT.HARD_MAX_WORDS));

  for (const sentence of sentences) {
    const sentenceWords = countWords(sentence);
    const isShortDialogue = block.type === "dialogue" && sentenceWords < SEGMENT.SHORT_DIALOGUE_WORDS;

    if (needsBreakBefore(run, sentenceWords, isShortDialogue)) flushSegment(run);
    if (needsIsolation(run, sentenceWords, isShortDialogue)) flushSegment(run);

    appendPart(run, sentence);

    if (sentenceWords >= SEGMENT.HARD_MAX_WORDS) flushSegment(run);
  }
}

function needsBreakBefore(run: SegmentRun, sentenceWords: number, isShortDialogue: boolean): boolean {
  if (isShortDialogue || !endsSentence(run.bufferedParts)) return false;

  const { minWords, maxWords } = limitsFor(run);
  return run.bufferedWords + sentenceWords > maxWords && run.bufferedWords >= minWords;
}

function needsIsolation(run: SegmentRun, sentenceWords: number, isShortDialogue: boolean): boolean {
  if (sentenceWords < SEGMENT.HARD_MAX_WORDS || run.bufferedWords === 0) return false;
  return !isShortDialogue && endsSentence(run.bufferedParts);
}

function limitsFor(run: SegmentRun): SegmentLimits {
  if (!run.isLeadInPending) {
    return { minWords: SEGMENT.MIN_WORDS, targetWords: SEGMENT.TARGET_WORDS, maxWords: SEGMENT.MAX_WORDS };
  }
  return { minWords: 1, targetWords: SEGMENT.LEAD_IN_WORDS, maxWords: SEGMENT.LEAD_IN_WORDS };
}

function createSegmentRun(): SegmentRun {
  return { segments: [], bufferedParts: [], bufferedWords: 0, nextIndex: 1, isLeadInPending: true };
}

function appendPart(run: SegmentRun, text: string): void {
  run.bufferedParts.push(text);
  run.bufferedWords += countWords(text);
}

function flushSegment(run: SegmentRun, reason?: FlushReason): void {
  if (run.bufferedParts.length === 0) return;

  run.segments.push({
    segmentIndex: run.nextIndex,
    text: run.bufferedParts.join(" ").trim(),
    isSceneBreak: reason === "scene-break",
  });
  run.nextIndex += 1;
  run.bufferedParts = [];
  run.bufferedWords = 0;
  if (reason !== "heading") run.isLeadInPending = false;
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(SENTENCE_BOUNDARY_RE)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function splitOversizedUnit(text: string, maxWords: number): string[] {
  if (countWords(text) <= maxWords) return [text];

  const clauseParts = text
    .split(CLAUSE_BOUNDARY_RE)
    .map((part) => part.trim())
    .filter(Boolean);
  if (clauseParts.length <= 1) return splitByWordCount(text, maxWords);

  return packClauses(clauseParts, maxWords);
}

function packClauses(clauseParts: string[], maxWords: number): string[] {
  const packed: string[] = [];
  let buffered: string[] = [];
  let bufferedWords = 0;

  for (const part of clauseParts) {
    const words = countWords(part);
    if (bufferedWords > 0 && bufferedWords + words > maxWords) {
      packed.push(buffered.join(" "));
      buffered = [];
      bufferedWords = 0;
    }
    if (words > maxWords) {
      if (buffered.length > 0) {
        packed.push(buffered.join(" "));
        buffered = [];
        bufferedWords = 0;
      }
      packed.push(...splitByWordCount(part, maxWords));
      continue;
    }
    buffered.push(part);
    bufferedWords += words;
  }

  if (buffered.length > 0) packed.push(buffered.join(" "));
  return packed;
}

function splitByWordCount(text: string, maxWords: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [text.trim()];

  const chunks: string[] = [];
  for (let start = 0; start < words.length; start += maxWords) {
    chunks.push(words.slice(start, start + maxWords).join(" "));
  }
  return chunks;
}

function endsSentence(parts: string[]): boolean {
  const last = parts[parts.length - 1];
  return !last || /[.!?।॥…]["'”’»)\]]*$/.test(last.trim());
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
