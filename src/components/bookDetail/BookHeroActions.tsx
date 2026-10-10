import { Button, Icon, LevelMeter } from "../ui";
import { formatDuration } from "../../lib/format";
import type { Book, Chapter } from "../../types/api";

interface BookHeroActionsProps {
  book: Book;
  liveChapter: Chapter | undefined;
  progress: { total: number; done: number } | undefined;
  isLiveChapterActive: boolean;
  canRetry: boolean;
  retrying: boolean;
  deleting: boolean;
  onRetry: () => void;
  onDelete: () => void;
  onPlayChapter: (chapter: Chapter) => void;
}

export function BookHeroActions({
  book,
  liveChapter,
  progress,
  isLiveChapterActive,
  canRetry,
  retrying,
  deleting,
  onRetry,
  onDelete,
  onPlayChapter,
}: BookHeroActionsProps) {
  return (
    <>
      {book.status === "failed" && (
        <div role="alert" className="mt-6 w-full max-w-xl rounded-panel border border-danger-400/30 bg-danger-500/10 p-4 text-left sm:p-5">
          <p className="flex items-center gap-2 font-semibold text-ink-primary">
            <Icon name="alert" size={18} className="text-danger-300" />
            This performance stopped
          </p>
          <p className="mt-1 text-caption text-ink-secondary">
            {canRetry
              ? "Something went wrong while preparing the book. Retry to pick up where it left off, or remove it from your library."
              : "Something went wrong while preparing the book. You can remove it from your library and add it again."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {canRetry && (
              <Button variant="primary" size="sm" isLoading={retrying} disabled={deleting} onClick={onRetry}>
                {!retrying && <Icon name="refresh" size={16} />}
                {retrying ? "Retrying…" : "Retry"}
              </Button>
            )}
            <Button variant="danger" size="sm" isLoading={deleting} disabled={retrying} onClick={onDelete}>
              {!deleting && <Icon name="trash" size={16} />}
              {deleting ? "Deleting…" : "Delete book"}
            </Button>
          </div>
        </div>
      )}

      {liveChapter && !isLiveChapterActive && (
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <Button variant="primary" size="lg" onClick={() => onPlayChapter(liveChapter)}>
            <Icon name="play" size={18} />
            {liveChapter.status === "ready" ? "Play" : "Listen live"}
          </Button>
          <span className="text-caption text-ink-tertiary">
            <span className="font-mono tabular-nums">Ch. {liveChapter.chapterIndex.toString().padStart(2, "0")}</span>
            <span aria-hidden="true" className="mx-1.5">
              ·
            </span>
            <span className="tabular-nums">
              {liveChapter.status === "ready"
                ? formatDuration(liveChapter.durationMs)
                : progress
                  ? `${progress.done}/${progress.total} lines voiced`
                  : "Streams as lines finish"}
            </span>
          </span>
        </div>
      )}

      {liveChapter && isLiveChapterActive && (
        <p className="mt-8 flex h-12 items-center gap-2.5 rounded-full border border-line-accent bg-gold-500/10 px-5 text-caption font-semibold text-gold-200">
          <LevelMeter bars={4} className="h-3.5 text-gold-300" />
          Now playing · Chapter {liveChapter.chapterIndex}
        </p>
      )}
    </>
  );
}
