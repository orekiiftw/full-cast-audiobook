import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, deleteBook } from "../../lib/api";
import { useToast } from "../ui";
import type { Book } from "../../types/api";

const PIPELINE_POLL_INTERVAL_MS = 5000;

export function useLibraryBooks(bootBooks?: Promise<Book[] | null> | null) {
  const { showToast } = useToast();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const fetchSeqRef = useRef(0);
  const booksRef = useRef<Book[]>([]);

  const fetchBooks = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      const response = await apiFetch("/api/books");
      if (seq !== fetchSeqRef.current) return;
      if (response.ok) {
        setBooks((await response.json()) as Book[]);
        setLoadError(false);
      } else if (response.status !== 401) {
        setLoadError(true);
      }
    } catch (error) {
      if (seq !== fetchSeqRef.current) return;
      console.error(error);
      setLoadError(true);
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    booksRef.current = books;
  }, [books]);

  useEffect(() => {
    let cancelled = false;

    const primeFromBoot = async (): Promise<boolean> => {
      if (!bootBooks) return false;
      try {
        const bootedBooks = await bootBooks;
        if (cancelled || !bootedBooks) return false;
        setBooks(bootedBooks);
        setLoadError(false);
        setLoading(false);
        return true;
      } catch {
        return false;
      }
    };
    void primeFromBoot().then((primed) => {
      if (!cancelled && !primed) void fetchBooks();
    });

    const tick = () => {
      if (document.hidden) return;
      const hasActivePipeline = booksRef.current.some(
        (book) => book.status === "discovering" || book.status === "casting" || book.status === "in_progress",
      );
      if (hasActivePipeline) void fetchBooks();
    };
    const interval = setInterval(tick, PIPELINE_POLL_INTERVAL_MS);
    const handleVisible = () => {
      if (!document.hidden) void fetchBooks();
    };
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [fetchBooks, bootBooks]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError(false);
    void fetchBooks();
  };

  const removeBook = async (bookId: string, title: string) => {
    if (await deleteBook(bookId, title, showToast)) {
      setBooks((prev) => prev.filter((book) => book.id !== bookId));
    }
  };

  return { books, loading, loadError, reload: fetchBooks, retryLoad, removeBook };
}
