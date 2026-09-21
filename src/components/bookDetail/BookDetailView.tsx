import { BookHero } from "./BookHero";
import { ChapterList } from "./ChapterList";
import { NarratorCard } from "./NarratorCard";
import { PronunciationEditor } from "./PronunciationEditor";
import { StudioConsole } from "./StudioConsole";
import { Icon } from "../ui";
import type { BookDetailModel } from "./useBookDetail";
import type { NarratorPreviewModel } from "./useNarratorPreview";
import type { BookMaintenanceModel } from "./useBookMaintenance";
import type { PronunciationFormModel } from "./usePronunciationForm";
import type { Book } from "../../types/api";

interface BookDetailViewProps {
  book: Book;
  detail: BookDetailModel;
  preview: NarratorPreviewModel;
  dictionary: PronunciationFormModel;
  maintenance: BookMaintenanceModel;
  activeChapterId?: string;
  onBack: () => void;
}

export function BookDetailView({ book, detail, preview, dictionary, maintenance, activeChapterId, onBack }: BookDetailViewProps) {
  return (
    <div className="max-w-6xl mx-auto px-5 sm:px-6 py-10 sm:py-12 animate-fade-up">
      <button
        onClick={onBack}
        className="label-caps text-cinema-400 hover:text-gold-300 mb-10 transition-colors flex items-center gap-1.5 group"
      >
        <Icon name="chevronLeft" size={14} className="transition-transform group-hover:-translate-x-0.5" />
        Library
      </button>

      <BookHero
        book={book}
        narrator={detail.narrator}
        chapters={detail.chapters}
        pronunciationCount={detail.pronunciation.length}
        segmentProgress={detail.segmentProgress}
        activeChapterId={activeChapterId}
        canRetry={detail.canRetry}
        retrying={maintenance.retrying}
        deleting={maintenance.deleting}
        onPlayChapter={detail.selectChapter}
        onRetry={maintenance.retry}
        onDelete={() => void maintenance.remove(book.title)}
      />

      {detail.isWorking && <StudioConsole progressLog={detail.progressLog} bookStatus={book.status} />}

      {detail.narrator && (
        <NarratorCard narrator={detail.narrator} playingPreviewId={preview.playingPreviewId} onPlayPreview={preview.playPreview} />
      )}

      <ChapterList
        chapters={detail.chapters}
        progress={detail.segmentProgress}
        activeChapterId={activeChapterId}
        onSelect={detail.selectChapter}
      />

      <PronunciationEditor terms={detail.pronunciation} form={dictionary} />
    </div>
  );
}
