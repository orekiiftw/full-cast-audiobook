const SPACELESS_SCRIPT_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });

export function cleanText(text: string): string {
  const collapsed = text
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\[\d+\]/g, "")
    .trim();

  return collapsed.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (!SPACELESS_SCRIPT_RE.test(trimmed)) return trimmed.split(/\s+/).length;
  return segmentedWordStarts(trimmed).length;
}

export function splitByWordCount(text: string, maxWords: number): string[] {
  const trimmed = text.trim();
  const wordStarts = SPACELESS_SCRIPT_RE.test(trimmed)
    ? segmentedWordStarts(trimmed)
    : Array.from(trimmed.matchAll(/\S+/g), (match) => match.index);

  const chunks: string[] = [];
  let chunkStart = 0;
  for (let index = maxWords; index < wordStarts.length; index += maxWords) {
    chunks.push(trimmed.slice(chunkStart, wordStarts[index]).trim());
    chunkStart = wordStarts[index];
  }
  chunks.push(trimmed.slice(chunkStart));
  return chunks;
}

export function isDialogue(text: string): boolean {
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

export function endsAtSentenceBoundary(text: string): boolean {
  return /[.!?।॥…]["'”’»)\]]*$/.test(text.trim());
}

function segmentedWordStarts(text: string): number[] {
  return Array.from(WORD_SEGMENTER.segment(text))
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.index);
}
