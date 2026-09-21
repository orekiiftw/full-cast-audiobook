import { ChapterRow } from "./ChapterRow";
import type { SegmentProgress } from "./detailsData";
import type { Chapter } from "../../types/api";

interface ChapterListProps {
  chapters: Chapter[];
  progress: SegmentProgress;
  activeChapterId?: string;
  onSelect: (chapter: Chapter) => void;
}

export function ChapterList({ chapters, progress, activeChapterId, onSelect }: ChapterListProps) {
  return (
    <section className="mb-14">
      <div className="flex items-baseline justify-between pb-4 mb-5 border-b border-white/[0.05]">
        <h2 className="font-serif text-2xl font-medium tracking-tight">Chapters</h2>
        <span className="label-caps">
          {chapters.filter((chapter) => chapter.status === "ready").length}/{chapters.length} ready
        </span>
      </div>
      <div className="space-y-2">
        {chapters.map((chapter) => (
          <ChapterRow
            key={chapter.id}
            chapter={chapter}
            progress={progress[chapter.id]}
            isActive={activeChapterId === chapter.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
