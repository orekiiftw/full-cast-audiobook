import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { deleteBook, listBooks } from "@/api/books";
import type { Book } from "@/api/types";
import { forgetBookSeed, rememberBookSeeds } from "@/lib/bookSeed";

export interface LibraryModel {
  books: Book[];
  loading: boolean;
  // A pull-to-refresh is in flight while the list is already on screen.
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
  remove: (book: Book) => Promise<boolean>;
}

export function useLibrary(): LibraryModel {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (mode: "reload" | "refresh") => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (mode === "refresh") setRefreshing(true);
    try {
      const next = await listBooks();
      setBooks(next);
      // The list is what the detail screen opens from: park the rows so it can paint at once.
      rememberBookSeeds(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load your library.");
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const reload = useCallback(() => load("reload"), [load]);
  const refresh = useCallback(() => load("refresh"), [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = useCallback(async (book: Book) => {
    try {
      await deleteBook(book.id);
      forgetBookSeed(book.id);
      setBooks((current) => current.filter((candidate) => candidate.id !== book.id));
      return true;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not delete this book.");
      return false;
    }
  }, []);

  return { books, loading, refreshing, error, reload, refresh, remove };
}
