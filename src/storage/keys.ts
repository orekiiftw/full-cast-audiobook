export function segmentAudioKey(bookId: string, chapterIndex: number, segmentIndex: number): string {
  return `books/${bookId}/chapters/ch_${chapterIndex}/segment_${segmentIndex}.wav`;
}

export function isSafeStorageKey(key: string): boolean {
  if (!key || typeof key !== "string") return false;
  if (key.length > 512) return false;
  if (key.includes("..")) return false;
  if (key.startsWith("/") || key.startsWith("\\")) return false;
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key)) return false;
  return true;
}

export function assertSafeKey(key: string): void {
  if (!isSafeStorageKey(key)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}
