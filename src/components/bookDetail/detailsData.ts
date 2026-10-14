import type { Dispatch, SetStateAction } from "react";
import type {
  Book,
  BookDetailResponse,
  BookStatus,
  Chapter,
  ChapterStatusEvent,
  PipelineEvent,
  PlaybackState,
  SegmentReadyEvent,
} from "../../types/api";

const RESUME_COMPLETION_SLOP_MS = 1000;

interface SegmentProgressEntry {
  total: number;
  done: number;
}

export type SegmentProgress = Record<string, SegmentProgressEntry>;

export type DetailData = BookDetailResponse & {
  segmentProgress?: SegmentProgress;
  canRetry?: boolean;
};

export interface ProgressLogEntry {
  id: number;
  text: string;
}

export const PROGRESS_LOG_LIMIT = 15;

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

export function isChapterPlayable(chapter: Chapter, progress?: SegmentProgressEntry): boolean {
  const voiced = progress ? progress.done : chapter.voicedCount;
  return (
    chapter.status === "ready" ||
    chapter.status === "partial_ready" ||
    (voiced > 0 && (chapter.status === "processing" || chapter.status === "queued"))
  );
}

export function findLiveChapter(
  chapters: Chapter[],
  segmentProgress: SegmentProgress,
  playbackState?: PlaybackState | null,
): Chapter | undefined {
  if (playbackState?.chapterId) {
    const savedChapter = chapters.find((chapter) => chapter.id === playbackState.chapterId);
    if (savedChapter) {
      if (
        canResumeChapter(playbackState, savedChapter.id, savedChapter.durationMs) &&
        isChapterPlayable(savedChapter, segmentProgress[savedChapter.id])
      ) {
        return savedChapter;
      }
      const nextAfterSaved = chapters.find(
        (chapter) => chapter.chapterIndex > savedChapter.chapterIndex && isChapterPlayable(chapter, segmentProgress[chapter.id]),
      );
      if (nextAfterSaved) return nextAfterSaved;
    }
  }

  return chapters.find((chapter) => isChapterPlayable(chapter, segmentProgress[chapter.id]));
}

export function deriveInitialCues(data: DetailData): string[] {
  const { book, chapters } = data;
  const progress = data.segmentProgress ?? {};

  if (book.status === "casting") {
    return ["Parsing chapters and casting the narrator…"];
  }

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
    const chLabel = `Ch. ${String(activeChapter.chapterIndex).padStart(2, "0")}`;
    cues.push(`${chLabel} · ${done}/${total} lines voiced — studio voices ahead as you listen.`);
  }

  const readyChapters = chapters.filter((chapter) => chapter.status === "ready");
  if (readyChapters.length === 1) {
    const ch = readyChapters[0];
    cues.push(`Ch. ${String(ch.chapterIndex).padStart(2, "0")} (${ch.title}) ready to play.`);
  } else if (readyChapters.length > 1) {
    cues.push(`${readyChapters.length} of ${chapters.length} chapters ready to play.`);
  }

  if (cues.length === 0) {
    const firstChapter = chapters[0];
    if (firstChapter) {
      cues.push(`Voicing opening lines for Ch. ${String(firstChapter.chapterIndex).padStart(2, "0")} (${firstChapter.title})…`);
    } else {
      cues.push("Preparing opening lines for playback…");
    }
  }

  return cues;
}

interface DetailEventTargets {
  setData: Dispatch<SetStateAction<DetailData | null>>;
  setSegmentProgress: Dispatch<SetStateAction<SegmentProgress>>;
  pushLog: (message: string) => void;
  refetch: () => void;
}

export function applyPipelineEvent(payload: PipelineEvent, targets: DetailEventTargets): void {
  if (payload.type === "progress_log") {
    targets.pushLog(payload.message);
    return;
  }

  if (payload.type === "status_change") {
    targets.setData((prev) => withBookStatus(prev, payload.status));
    targets.pushLog(payload.message ?? `System status: ${payload.status}`);
    targets.refetch();
    return;
  }

  if (payload.type === "chapter_status") {
    targets.setData((prev) => withChapterStatus(prev, payload));
    const cue = formatChapterStatusCue(payload);
    if (cue) targets.pushLog(cue);
    return;
  }

  if (payload.type === "segment_failed") {
    targets.pushLog(`Segment failed: ${payload.error}`);
    return;
  }

  if (payload.type === "quota_exceeded") {
    targets.pushLog(payload.message ?? "TTS quota exhausted — generation paused.");
    return;
  }

  if (payload.type === "segment_ready") {
    targets.setSegmentProgress((prev) => withSegmentProgress(prev, payload));
    targets.setData((prev) => withPartialReadyChapter(prev, payload));
    targets.pushLog(formatSegmentReadyCue(payload));
  }
}

function formatSegmentReadyCue(event: SegmentReadyEvent): string {
  const chapterPrefix = event.chapterIndex ? `Ch. ${String(event.chapterIndex).padStart(2, "0")} · ` : "";
  const total = event.total > 0 ? event.total : "?";
  return `${chapterPrefix}Voiced ${event.done}/${total} lines`;
}

function formatChapterStatusCue(event: ChapterStatusEvent): string | null {
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
