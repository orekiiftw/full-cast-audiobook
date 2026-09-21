import { Button, Icon } from "../ui";
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
        <div className="flex flex-wrap justify-center sm:justify-start gap-2.5">
          {canRetry && (
            <Button variant="primary" size="sm" isLoading={retrying} onClick={onRetry}>
              <Icon name="refresh" size={14} />
              Retry
            </Button>
          )}
          <Button variant="danger" size="sm" isLoading={deleting} onClick={onDelete}>
            <Icon name="x" size={14} />
            Delete
          </Button>
        </div>
      )}

      {liveChapter && !isLiveChapterActive && (
        <div className="flex flex-wrap justify-center sm:justify-start gap-4 items-center pt-1">
          <Button variant="primary" size="lg" onClick={() => onPlayChapter(liveChapter)}>
            <Icon name="play" size={16} />
            Listen live
          </Button>
          <span className="text-xs text-cinema-400">
            {progress ? `${progress.done}/${progress.total} lines` : "Stream as lines finish"}
            <span className="mx-1.5 text-cinema-600">·</span>
            Ch. {liveChapter.chapterIndex}
          </span>
        </div>
      )}
    </>
  );
}
