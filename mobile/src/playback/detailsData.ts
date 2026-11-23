import type {
  Book,
  BookDetailResponse,
  BookStatus,
  Chapter,
  ChapterStatusEvent,
  PipelineEvent,
  PlaybackState,
  SegmentReadyEvent,
} from "@/api/types";
import { isChapterPlayable } from "@/playback/playbackSelection";

// Port of `src/components/bookDetail/detailsData.ts`. Everything here is a pure function of
// (state, event) so the live-update rules — which events patch in place, which force a
// refetch — can be reasoned about and tested without rendering the detail screen.

const RESUME_COMPLETION_SLOP_MS = 1000;

export interface SegmentProgressEntry {
  total: number;
  done: number;
}

export type SegmentProgress = Record<string, SegmentProgressEntry>;

export type DetailData = BookDetailResponse & {
  segmentProgress?: SegmentProgress;
};

export interface ProgressLogEntry {
  id: number;
  text: string;
}

export const PROGRESS_LOG_LIMIT = 15;

export interface DetailState {
  data: DetailData | null;
  segmentProgress: SegmentProgress;
  log: ProgressLogEntry[];
  nextLogId: number;
}

export function isBookWorking(book: Book): boolean {
  return book.status !== "ready" && book.status !== "failed";
}

export function canResumeChapter(playbackState: PlaybackState | null | undefined, chapterId: string, durationMs?: number | null): boolean {
  if (!playbackState || playbackState.chapterId !== chapterId || playbackState.positionMs <= 0) return false;
  if (durationMs != null && durationMs > 0) {
    return playbackState.positionMs < Math.max(0, durationMs - RESUME_COMPLETION_SLOP_MS);
  }
  return true;
}

export function resumePositionFor(playbackState: PlaybackState | null | undefined, chapterId: string, durationMs?: number | null): number {
  return canResumeChapter(playbackState, chapterId, durationMs) ? (playbackState?.positionMs ?? 0) : 0;
}

export function findLiveChapter(
  chapters: Chapter[],
  segmentProgress: SegmentProgress,
  playbackState?: PlaybackState | null,
): Chapter | undefined {
  if (playbackState?.chapterId) {
    const savedChapter = chapters.find((chapter) => chapter.id === playbackState.chapterId);
    if (savedChapter) {
      const done = segmentProgress[savedChapter.id]?.done;
      if (canResumeChapter(playbackState, savedChapter.id, savedChapter.durationMs) && isChapterPlayable(savedChapter, done)) {
        return savedChapter;
      }
      const nextAfterSaved = chapters.find(
        (chapter) => chapter.chapterIndex > savedChapter.chapterIndex && isChapterPlayable(chapter, segmentProgress[chapter.id]?.done),
      );
      if (nextAfterSaved) return nextAfterSaved;
    }
  }

  return chapters.find((chapter) => isChapterPlayable(chapter, segmentProgress[chapter.id]?.done));
}

// The first lines of the studio console, so a working book never opens to an empty log.
export function deriveInitialCues(data: DetailData): string[] {
  const { book, chapters } = data;
  const progress = data.segmentProgress ?? {};

  if (book.status === "casting") return ["Parsing chapters and casting the narrator…"];
  if (book.status !== "in_progress") return [];

  const cues: string[] = [];
  const activeChapter = chapters.find((chapter) => {
    const entry = progress[chapter.id];
    const done = entry ? entry.done : chapter.voicedCount;
    return chapter.status === "partial_ready" || (chapter.status === "processing" && done > 0);
  });

  if (activeChapter) {
    const entry = progress[activeChapter.id];
    const done = entry ? entry.done : activeChapter.voicedCount;
    const total = (entry ? entry.total : activeChapter.totalCount) || "?";
    cues.push(
      `Ch. ${String(activeChapter.chapterIndex).padStart(2, "0")} · ${done}/${total} lines voiced — the studio voices ahead as you listen.`,
    );
  }

  const readyChapters = chapters.filter((chapter) => chapter.status === "ready");
  if (readyChapters.length === 1) {
    const ready = readyChapters[0];
    cues.push(`Ch. ${String(ready.chapterIndex).padStart(2, "0")} (${ready.title}) ready to play.`);
  } else if (readyChapters.length > 1) {
    cues.push(`${readyChapters.length} of ${chapters.length} chapters ready to play.`);
  }

  if (cues.length === 0) {
    const firstChapter = chapters[0];
    cues.push(
      firstChapter
        ? `Voicing opening lines for Ch. ${String(firstChapter.chapterIndex).padStart(2, "0")} (${firstChapter.title})…`
        : "Preparing opening lines for playback…",
    );
  }

  return cues;
}

export function createDetailState(data: DetailData | null): DetailState {
  const log: ProgressLogEntry[] = [];
  let nextLogId = 1;
  if (data) {
    for (const text of deriveInitialCues(data).slice(0, PROGRESS_LOG_LIMIT)) {
      log.push({ id: nextLogId++, text });
    }
  }
  return { data, segmentProgress: data?.segmentProgress ?? {}, log, nextLogId };
}

// Deterministic ordering matters here: the log stays newest-first, and the detail payload is
// only refetched when the server state actually changed (book status), not on every line.
export function reduceDetailEvent(state: DetailState, event: PipelineEvent): { state: DetailState; refetch: boolean } {
  let refetch = false;
  const pushLog = (text: string, next: DetailState) => {
    next.log = [{ id: next.nextLogId, text }, ...next.log.slice(0, PROGRESS_LOG_LIMIT - 1)];
    next.nextLogId += 1;
  };
  const next: DetailState = { ...state, log: state.log, segmentProgress: state.segmentProgress };

  switch (event.type) {
    case "progress_log":
      pushLog(event.message, next);
      break;
    case "status_change":
      next.data = withBookStatus(state.data, event.status);
      pushLog(event.message ?? `System status: ${event.status}`, next);
      refetch = true;
      break;
    case "chapter_status":
      next.data = withChapterStatus(state.data, event);
      if (formatChapterStatusCue(event)) pushLog(formatChapterStatusCue(event) as string, next);
      break;
    case "segment_failed":
      pushLog(`Segment failed: ${event.error}`, next);
      break;
    case "quota_exceeded":
      pushLog(event.message ?? "TTS quota exhausted — generation paused.", next);
      break;
    case "segment_ready":
      next.segmentProgress = withSegmentProgress(state.segmentProgress, event);
      next.data = withPartialReadyChapter(state.data, event);
      pushLog(formatSegmentReadyCue(event), next);
      break;
  }

  return { state: next, refetch };
}

export function formatSegmentReadyCue(event: SegmentReadyEvent): string {
  const chapterPrefix = event.chapterIndex ? `Ch. ${String(event.chapterIndex).padStart(2, "0")} · ` : "";
  const total = event.total > 0 ? event.total : "?";
  return `${chapterPrefix}Voiced ${event.done}/${total} lines`;
}

export function formatChapterStatusCue(event: ChapterStatusEvent): string | null {
  if (event.message) return event.message;
  if (event.status === "ready") return "Chapter audio ready!";
  if (event.status === "failed") return "Chapter failed to finish.";
  return null;
}

function withBookStatus(data: DetailData | null, status: BookStatus): DetailData | null {
  if (!data) return data;
  return { ...data, book: { ...data.book, status } };
}

function withChapterStatus(data: DetailData | null, event: ChapterStatusEvent): DetailData | null {
  if (!data) return data;
  return {
    ...data,
    chapters: data.chapters.map((chapter) =>
      chapter.id === event.chapterId
        ? {
            ...chapter,
            status: event.status,
            durationMs: event.durationMs ?? chapter.durationMs,
            audioR2Key: event.audioR2Key ?? chapter.audioR2Key,
          }
        : chapter,
    ),
  };
}

function withSegmentProgress(progress: SegmentProgress, event: SegmentReadyEvent): SegmentProgress {
  const current = progress[event.chapterId] || { total: 0, done: 0 };
  const total = event.total > 0 ? event.total : current.total;
  return {
    ...progress,
    [event.chapterId]: {
      total,
      done: total > 0 ? Math.min(total, event.done) : event.done,
    },
  };
}

function withPartialReadyChapter(data: DetailData | null, event: SegmentReadyEvent): DetailData | null {
  if (!data) return data;
  return {
    ...data,
    chapters: data.chapters.map((chapter) => {
      if (chapter.id !== event.chapterId) return chapter;
      const totalCount = event.total > 0 ? event.total : chapter.totalCount;
      const voicedCount =
        totalCount > 0 ? Math.min(totalCount, Math.max(chapter.voicedCount, event.done)) : Math.max(chapter.voicedCount, event.done);
      const status =
        chapter.status === "ready" || chapter.status === "partial_ready" || chapter.status === "failed"
          ? chapter.status
          : ("partial_ready" as Chapter["status"]);
      return { ...chapter, status, voicedCount, totalCount };
    }),
  };
}

// A `segment_ready` event carries a fresh URL for one line: patch it into the player's list
// instead of waiting for a full refetch.
export function patchSegmentReady<T extends { id: string; status: string; audioUrl: string | null; durationMs: number | null }>(
  segments: T[],
  event: SegmentReadyEvent,
): T[] {
  let changed = false;
  const patched = segments.map((segment) => {
    if (segment.id !== event.segmentId) return segment;
    changed = true;
    return {
      ...segment,
      status: "voiced" as T["status"],
      audioUrl: event.audioUrl,
      durationMs: event.durationMs,
    };
  });
  return changed ? patched : segments;
}
