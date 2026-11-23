import type { Chapter, Segment } from "@/api/types";
import { isPlayableSegment } from "@/lib/segmentStatus";

// Framework-free port of `src/hooks/playbackSelection.ts`: where a chapter starts when the
// listener has a saved position, and which chapter continues after one ends.

const PLAYABLE_CHAPTER_STATUSES = new Set<Chapter["status"]>(["ready", "partial_ready", "processing"]);

export function resolveStartSegmentIndex(segments: Segment[], resumeMs: number): number {
  if (resumeMs <= 0) {
    const firstVoiced = segments.findIndex(isPlayableSegment);
    return firstVoiced >= 0 ? firstVoiced : 0;
  }

  let startIndex = 0;
  let accumulated = 0;
  for (let index = 0; index < segments.length; index++) {
    const duration = segments[index].durationMs ?? 0;
    if (duration <= 0) {
      if (index === segments.length - 1) {
        startIndex = index;
        break;
      }
      continue;
    }
    if (accumulated + duration > resumeMs) {
      startIndex = index;
      break;
    }
    accumulated += duration;
    if (index === segments.length - 1) startIndex = index;
  }

  const target = segments[startIndex];
  if (target?.status === "voiced" && target?.audioUrl) return startIndex;

  const voicedNear = segments.findIndex((segment, index) => index >= startIndex && segment.status === "voiced" && segment.audioUrl);
  if (voicedNear >= 0) return voicedNear;

  const firstVoiced = segments.findIndex(isPlayableSegment);
  return firstVoiced >= 0 ? firstVoiced : startIndex;
}

// Chapters that can be listened to, in order, from just after the one that just ended.
export function findNextPlayableChapter(chapters: Chapter[], currentChapterIndex: number): Chapter | undefined {
  return chapters.find(
    (candidate) =>
      candidate.chapterIndex > currentChapterIndex &&
      candidate.status !== "failed" &&
      (candidate.voicedCount > 0 || candidate.totalCount > 0 || PLAYABLE_CHAPTER_STATUSES.has(candidate.status)),
  );
}

export function isChapterPlayable(chapter: Chapter, done?: number): boolean {
  const voiced = done ?? chapter.voicedCount;
  return (
    chapter.status === "ready" ||
    chapter.status === "partial_ready" ||
    (voiced > 0 && (chapter.status === "processing" || chapter.status === "queued"))
  );
}
