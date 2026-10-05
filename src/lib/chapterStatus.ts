export interface ChapterCounters {
  voicedCount: number;
  failedCount: number;
  totalCount: number;
}

export function isChapterComplete(counters: ChapterCounters | undefined): boolean {
  return !!counters && counters.totalCount > 0 && counters.voicedCount + counters.failedCount >= counters.totalCount;
}
