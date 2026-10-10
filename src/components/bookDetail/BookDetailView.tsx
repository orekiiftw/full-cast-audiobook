import { BookHero } from "./BookHero";
import { ChapterList } from "./ChapterList";
import { NarratorCard } from "./NarratorCard";
import { PronunciationEditor } from "./PronunciationEditor";
import { StudioConsole } from "./StudioConsole";
import { DETAIL_GRID_CLASS, DETAIL_PAGE_CLASS } from "./layout";
import { Button, Icon } from "../ui";
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
    <div className={DETAIL_PAGE_CLASS}>
      <Button variant="ghost" size="sm" onClick={onBack} className="group -ml-2 mb-6 pl-2 pr-3.5">
        <Icon name="chevronLeft" size={16} className="transition-transform duration-base group-hover:-translate-x-0.5" />
        Library
      </Button>

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

      {detail.isWorking && (
        <div className="mt-8">
          <StudioConsole progressLog={detail.progressLog} bookStatus={book.status} />
        </div>
      )}

      <div className={DETAIL_GRID_CLASS}>
        <div className="min-w-0 lg:col-span-2">
          <ChapterList
            chapters={detail.chapters}
            progress={detail.segmentProgress}
            activeChapterId={activeChapterId}
            onSelect={detail.selectChapter}
            working={detail.isWorking}
          />
        </div>

        <aside aria-label="Performance settings" className="min-w-0 space-y-10">
          {detail.narrator && (
            <NarratorCard narrator={detail.narrator} playingPreviewId={preview.playingPreviewId} onPlayPreview={preview.playPreview} />
          )}
          <PronunciationEditor terms={detail.pronunciation} form={dictionary} />
        </aside>
      </div>
    </div>
  );
}
