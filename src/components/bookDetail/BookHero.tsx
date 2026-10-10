import { Badge, Icon, Spinner, type IconName } from "../ui";
import { BookCover } from "./BookCover";
import { BookHeroActions } from "./BookHeroActions";
import { isBookWorking, type SegmentProgress } from "./detailsData";
import { bookStatusOf } from "../library/bookStatus";
import { audioUrl } from "../../lib/audioUrl";
import type { Book, BookStatus, CastMember, Chapter } from "../../types/api";

const WORKING_NOTES: Partial<Record<BookStatus, string>> = {
  discovering: "Finding a DRM-free copy and reading its chapters.",
  casting: "Casting the narrator and preparing the first chapter.",
  in_progress: "Performing chapter by chapter. You can listen as lines finish.",
};

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
  const status = bookStatusOf(book.status);
  const coverSrc = book.coverR2Key ? audioUrl(book.coverR2Key) : null;
  const workingNote = isBookWorking(book) ? WORKING_NOTES[book.status] : undefined;

  return (
    <section
      aria-labelledby="book-title"
      className="relative isolate overflow-hidden rounded-stage border border-line-hairline bg-surface-1 shadow-e-2 animate-rise"
    >
      {coverSrc ? (
        <div aria-hidden="true" className="cover-backdrop -z-20" style={{ backgroundImage: `url("${coverSrc}")` }} />
      ) : (
        <div aria-hidden="true" className="atmosphere -z-20" />
      )}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-surface-1/30 via-surface-1/75 to-surface-1" />

      <div className="flex flex-col items-center gap-8 p-6 sm:flex-row sm:items-start sm:gap-10 sm:p-10 lg:gap-12 lg:p-12">
        <BookCover book={book} />

        <div className="flex w-full min-w-0 flex-1 flex-col items-center text-center sm:items-start sm:pt-2 sm:text-left">
          <Badge tone={status.tone} pulse={status.pulse}>
            {status.label}
          </Badge>
          <h1
            id="book-title"
            className="mt-4 max-w-3xl text-balance break-words font-serif text-display-md font-medium text-ink-primary sm:text-display-lg lg:text-display-xl"
          >
            {book.title}
          </h1>
          <p className="mt-2 font-serif text-title-md italic text-ink-secondary">by {book.author.trim() || "Unknown author"}</p>

          <BookMeta narrator={narrator} chapters={chapters} pronunciationCount={pronunciationCount} />

          {workingNote && (
            <p className="mt-6 flex items-center gap-2.5 text-caption text-ink-secondary">
              <Spinner size={14} className="text-gold-300" />
              {workingNote}
            </p>
          )}

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
    </section>
  );
}

interface BookMetaProps {
  narrator: CastMember | null;
  chapters: Chapter[];
  pronunciationCount: number;
}

function BookMeta({ narrator, chapters, pronunciationCount }: BookMetaProps) {
  const runtime = totalRuntime(chapters);
  const items: Array<{ icon: IconName; label: string }> = [
    { icon: "book", label: `${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"}` },
    ...(runtime ? [{ icon: "clock" as const, label: runtime }] : []),
    { icon: "microphone", label: `Voiced by ${narrator?.ttsVoiceName ?? "Mia"}` },
    { icon: "pen", label: `${pronunciationCount} pronunciation ${pronunciationCount === 1 ? "guide" : "guides"}` },
  ];

  return (
    <ul role="list" className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-caption text-ink-secondary sm:justify-start">
      {items.map((item) => (
        <li key={item.icon} className="flex items-center gap-1.5">
          <Icon name={item.icon} size={16} className="text-ink-tertiary" />
          <span className="tabular-nums">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

// Runtime is only meaningful once every chapter has a final duration.
function totalRuntime(chapters: Chapter[]): string | null {
  if (chapters.length === 0 || chapters.some((chapter) => chapter.status !== "ready" || chapter.durationMs == null)) return null;
  const totalMinutes = Math.round(chapters.reduce((sum, chapter) => sum + (chapter.durationMs ?? 0), 0) / 60_000);
  if (totalMinutes < 1) return null;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
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
