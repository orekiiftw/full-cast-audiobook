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

export function resumePositionFor(playbackState: PlaybackState | null, chapterId: string): number {
  return playbackState?.chapterId === chapterId ? playbackState.positionMs : 0;
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
    targets.setData((prev) => withPartialReadyChapter(prev, payload.chapterId));
  }
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

function withPartialReadyChapter(data: DetailData | null, chapterId: string): DetailData | null {
  if (!data) return data;
  return {
    ...data,
    chapters: data.chapters.map((chapter) => {
      if (chapter.id !== chapterId) return chapter;
      if (chapter.status === "ready" || chapter.status === "partial_ready" || chapter.status === "failed") return chapter;
      return { ...chapter, status: "partial_ready" as Chapter["status"] };
    }),
  };
}
