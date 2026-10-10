import { Icon, Spinner } from "../ui";
import { ChapterRow } from "./ChapterRow";
import type { SegmentProgress } from "./detailsData";
import type { Chapter } from "../../types/api";

interface ChapterListProps {
  chapters: Chapter[];
  progress: SegmentProgress;
  activeChapterId?: string;
  onSelect: (chapter: Chapter) => void;
  working?: boolean;
}

export function ChapterList({ chapters, progress, activeChapterId, onSelect, working = false }: ChapterListProps) {
  const readyCount = chapters.filter((chapter) => chapter.status === "ready").length;

  return (
    <section aria-labelledby="chapters-heading" className="min-w-0">
      <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-line-hairline pb-3">
        <h2 id="chapters-heading" className="font-serif text-title-lg font-medium text-ink-primary">
          Chapters
        </h2>
        {chapters.length > 0 && (
          <span className="eyebrow tabular-nums">
            {readyCount} of {chapters.length} ready
          </span>
        )}
      </div>

      {chapters.length === 0 ? (
        <div className="flex flex-col items-center rounded-panel border border-dashed border-line-strong px-6 py-12 text-center">
          <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-tile border border-line-strong bg-surface-3 text-gold-300">
            {working ? <Spinner size={18} /> : <Icon name="book" size={20} />}
          </span>
          <p className="font-medium text-ink-primary">{working ? "Chapters are on their way" : "No chapters yet"}</p>
          <p className="mt-1 max-w-sm text-caption text-ink-tertiary">
            {working
              ? "They appear here as soon as the book has been read and split into chapters."
              : "This book didn’t produce any chapters to perform."}
          </p>
        </div>
      ) : (
        <ol role="list" className="space-y-2">
          {chapters.map((chapter) => (
            <ChapterRow
              key={chapter.id}
              chapter={chapter}
              progress={progress[chapter.id]}
              isActive={activeChapterId === chapter.id}
              onSelect={onSelect}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
