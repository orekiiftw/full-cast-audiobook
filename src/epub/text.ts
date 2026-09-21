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
  return trimmed.split(/\s+/).length;
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
