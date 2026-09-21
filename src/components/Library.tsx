import { AddBookModal, LibraryBody, LibraryHeader, useAddBookForm, useLibraryBooks } from "./library";
import type { Book } from "../types/api";

interface LibraryProps {
  onSelectBook: (bookId: string) => void;
  bootBooks?: Promise<Book[] | null> | null;
}

export function Library({ onSelectBook, bootBooks }: LibraryProps) {
  const books = useLibraryBooks(bootBooks);
  const addBook = useAddBookForm({ onSelectBook, refresh: books.reload });

  const handleDeleteBook = (event: React.MouseEvent, bookId: string, bookTitle: string) => {
    event.stopPropagation();
    void books.removeBook(bookId, bookTitle);
  };

  return (
    <div className="max-w-6xl mx-auto px-5 sm:px-6 py-12 sm:py-16 animate-fade-up">
      <LibraryHeader onAddBook={addBook.open} />

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
