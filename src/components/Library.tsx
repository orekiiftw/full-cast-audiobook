import { AddBookModal, LibraryBody, LibraryHeader, useAddBookForm, useLibraryBooks } from "./library";
import { bookStatusOf } from "./library/bookStatus";
import { LIBRARY_PAGE_CLASS } from "./library/layout";
import type { Book } from "../types/api";

interface LibraryProps {
  onSelectBook: (bookId: string) => void;
  bootBooks?: Promise<Book[] | null> | null;
}

export function Library({ onSelectBook, bootBooks }: LibraryProps) {
  const books = useLibraryBooks(bootBooks);
  const addBook = useAddBookForm({ onSelectBook, refresh: books.reload });
  const settled = !books.loading && !books.loadError;

  const handleDeleteBook = (event: React.MouseEvent, bookId: string, bookTitle: string) => {
    event.stopPropagation();
    void books.removeBook(bookId, bookTitle);
  };

  return (
    <div className={LIBRARY_PAGE_CLASS}>
      <LibraryHeader
        onAddBook={addBook.open}
        bookCount={settled ? books.books.length : undefined}
        performingCount={settled ? books.books.filter((book) => bookStatusOf(book.status).active).length : 0}
      />

      <LibraryBody
        loading={books.loading}
        loadError={books.loadError}
        books={books.books}
        onRetry={books.retryLoad}
        onAddBook={addBook.open}
        onSelectBook={onSelectBook}
        onSelectClassic={addBook.openClassic}
        onDeleteBook={handleDeleteBook}
      />

      <AddBookModal form={addBook} />
    </div>
  );
}
