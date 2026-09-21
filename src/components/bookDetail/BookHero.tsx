import { Badge } from "../ui";
import { BookCover } from "./BookCover";
import { BookHeroActions } from "./BookHeroActions";
import { isBookWorking, type SegmentProgress } from "./detailsData";
import type { Book, CastMember, Chapter } from "../../types/api";

interface BookHeroProps {
  book: Book;
  narrator: CastMember | null;
  chapters: Chapter[];
  pronunciationCount: number;
  segmentProgress: SegmentProgress;
  activeChapterId?: string;
  canRetry: boolean;
  retrying: boolean;
  deleting: boolean;
  onPlayChapter: (chapter: Chapter) => void;
  onRetry: () => void;
  onDelete: () => void;
}

export function BookHero({
  book,
  narrator,
  chapters,
  pronunciationCount,
  segmentProgress,
  activeChapterId,
  canRetry,
  retrying,
  deleting,
  onPlayChapter,
  onRetry,
  onDelete,
}: BookHeroProps) {
  const liveChapter = findLiveChapter(chapters, segmentProgress);

  return (
    <div className="relative flex flex-col sm:flex-row gap-10 items-start mb-16">
      <div className="pointer-events-none absolute -left-16 -top-10 h-56 w-56 rounded-full bg-gold-500/10 blur-3xl" />

      <BookCover book={book} />

      <div className="relative flex-1 text-center sm:text-left space-y-6 w-full">
        <div>
          <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-medium tracking-tight mb-3 text-balance text-gradient leading-[1.1]">
            {book.title}
          </h1>
          <p className="text-cinema-400 text-lg italic font-serif">by {book.author}</p>
        </div>

        <BookMeta book={book} narrator={narrator} chapterCount={chapters.length} pronunciationCount={pronunciationCount} />

        <BookHeroActions
          book={book}
          liveChapter={liveChapter}
          progress={liveChapter ? segmentProgress[liveChapter.id] : undefined}
          isLiveChapterActive={liveChapter?.id === activeChapterId}
          canRetry={canRetry}
          retrying={retrying}
          deleting={deleting}
          onRetry={onRetry}
          onDelete={onDelete}
          onPlayChapter={onPlayChapter}
        />
      </div>
    </div>
  );
}

interface BookMetaProps {
  book: Book;
  narrator: CastMember | null;
  chapterCount: number;
  pronunciationCount: number;
}

function BookMeta({ book, narrator, chapterCount, pronunciationCount }: BookMetaProps) {
  return (
    <div className="flex justify-center sm:justify-start items-center gap-3 flex-wrap">
      <Badge tone={book.status === "ready" ? "emerald" : book.status === "failed" ? "red" : "gold"} pulse={isBookWorking(book)}>
        {book.status}
      </Badge>
      <span className="text-[11px] text-cinema-500 tracking-wide">
        {chapterCount} chapters
        <span className="mx-1.5 text-cinema-700">·</span>
        Voiced by {narrator?.ttsVoiceName ?? "Mia"}
        <span className="mx-1.5 text-cinema-700">·</span>
        {pronunciationCount} guides
      </span>
    </div>
  );
}

function findLiveChapter(chapters: Chapter[], segmentProgress: SegmentProgress): Chapter | undefined {
  const partial = chapters.find((chapter) => chapter.status === "partial_ready");
  if (partial) return partial;

  const ready = chapters.find((chapter) => chapter.status === "ready");
  if (ready) return ready;

  return chapters.find((chapter) => {
    const progress = segmentProgress[chapter.id];
    return (chapter.status === "processing" || chapter.status === "queued") && !!progress && progress.done > 0;
  });
}
