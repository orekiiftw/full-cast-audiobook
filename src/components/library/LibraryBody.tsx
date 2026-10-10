import { LibrarySkeleton } from "./LibrarySkeleton";
import { LibraryLoadError } from "./LibraryLoadError";
import { EmptyLibrary } from "./EmptyLibrary";
import { LibraryBookCard } from "./LibraryBookCard";
import { LIBRARY_GRID_CLASS } from "./layout";
import type { Classic } from "./classics";
import type { Book } from "../../types/api";

interface LibraryBodyProps {
  loading: boolean;
  loadError: boolean;
  books: Book[];
  onRetry: () => void;
  onAddBook: () => void;
  onSelectBook: (bookId: string) => void;
  onSelectClassic: (classic: Classic) => void;
  onDeleteBook: (event: React.MouseEvent, bookId: string, bookTitle: string) => void;
}

export function LibraryBody({
  loading,
  loadError,
  books,
  onRetry,
  onAddBook,
  onSelectBook,
  onSelectClassic,
  onDeleteBook,
}: LibraryBodyProps) {
  if (loading) return <LibrarySkeleton />;
  if (loadError) return <LibraryLoadError onRetry={onRetry} />;
  if (books.length === 0) return <EmptyLibrary onSelectClassic={onSelectClassic} onAddBook={onAddBook} />;

  return (
    <section aria-label="Your books">
      <ul role="list" className={LIBRARY_GRID_CLASS}>
        {books.map((book, i) => (
          <LibraryBookCard key={book.id} book={book} index={i} onSelect={onSelectBook} onDelete={onDeleteBook} />
        ))}
      </ul>
    </section>
  );
}
