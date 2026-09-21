import {
  BookDetailView,
  DetailFallback,
  DetailLoading,
  useBookDetail,
  useBookMaintenance,
  useNarratorPreview,
  usePronunciationForm,
} from "./bookDetail";
import type { Book, Chapter } from "../types/api";

interface BookDetailProps {
  bookId: string;
  onBack: () => void;
  onPlayChapter: (book: Book, chapter: Chapter, resumeMs?: number) => void;
  activeChapterId?: string;
}

export function BookDetail({ bookId, onBack, onPlayChapter, activeChapterId }: BookDetailProps) {
  const detail = useBookDetail(bookId, onPlayChapter);
  const preview = useNarratorPreview(activeChapterId);
  const dictionary = usePronunciationForm({ bookId, reload: detail.reload });
  const maintenance = useBookMaintenance({
    bookId,
    onBack,
    reload: detail.reload,
    clearProgressLog: detail.clearProgressLog,
  });

  if (detail.loading) return <DetailLoading />;

  if (detail.loadError && !detail.book) {
    return (
      <DetailFallback
        title="Couldn’t load this book"
        message="The server hit an error. This is usually temporary — try again."
        onBack={onBack}
        onRetry={detail.retryLoad}
      />
    );
  }

  const book = detail.book;

  if (detail.notFound || !book) {
    return <DetailFallback title="Book not found" message="This book may have been removed or the link is invalid." onBack={onBack} />;
  }

  return (
    <BookDetailView
      book={book}
      detail={detail}
      preview={preview}
      dictionary={dictionary}
      maintenance={maintenance}
      activeChapterId={activeChapterId}
      onBack={onBack}
    />
  );
}
