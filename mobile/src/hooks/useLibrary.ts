import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import { deleteBook, listBooks } from "@/api/books";
import type { Book } from "@/api/types";

export interface LibraryModel {
  books: Book[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  remove: (book: Book) => Promise<boolean>;
}

export function useLibrary(): LibraryModel {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await listBooks();
      setBooks(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load your library.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = useCallback(async (book: Book) => {
    try {
      await deleteBook(book.id);
      setBooks((current) => current.filter((candidate) => candidate.id !== book.id));
      return true;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not delete this book.");
      return false;
    }
  }, []);

  return { books, loading, error, reload, remove };
}
