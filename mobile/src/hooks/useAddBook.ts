import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { searchBooks, submitBook } from "@/api/books";
import type { Book, BookResult } from "@/api/types";

// Search → pick → submit, the flow the web client's Add Book modal offers for titles it has
// to acquire rather than upload. The mobile app deliberately stops here: no EPUB picker, no
// magnet field.
export interface AddBookModel {
  title: string;
  author: string;
  results: BookResult[] | null;
  searching: boolean;
  submittingId: string | null;
  error: string | null;
  setTitle: (value: string) => void;
  setAuthor: (value: string) => void;
  search: () => Promise<void>;
  addResult: (result: BookResult) => Promise<Book | null>;
  addManual: () => Promise<Book | null>;
}

export function useAddBook(): AddBookModel {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [results, setResults] = useState<BookResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    const trimmedTitle = title.trim();
    const trimmedAuthor = author.trim();
    if (!trimmedTitle && !trimmedAuthor) {
      setError("Enter a title or an author to search.");
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const response = await searchBooks({
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
        ...(trimmedAuthor ? { author: trimmedAuthor } : {}),
      });
      setResults(response.results ?? []);
      if ((response.results ?? []).length === 0) setError("No DRM-free copy found. Try the author, or add it by title.");
    } catch (caught) {
      setResults(null);
      setError(caught instanceof ApiError ? caught.message : "Search failed. Try again.");
    } finally {
      setSearching(false);
    }
  }, [title, author]);

  const addResult = useCallback(async (result: BookResult) => {
    setSubmittingId(result.id);
    setError(null);
    try {
      return await submitBook({
        title: result.title,
        author: result.authors.join(", "),
        providerBook: {
          provider: result.provider,
          id: result.id,
          title: result.title,
          authors: result.authors,
          format: result.format,
        },
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not add this book.");
      return null;
    } finally {
      setSubmittingId(null);
    }
  }, []);

  const addManual = useCallback(async () => {
    const trimmedTitle = title.trim();
    const trimmedAuthor = author.trim();
    if (!trimmedTitle || !trimmedAuthor) {
      setError("A title and an author are both required.");
      return null;
    }

    setSubmittingId("manual");
    setError(null);
    try {
      return await submitBook({ title: trimmedTitle, author: trimmedAuthor });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not add this book.");
      return null;
    } finally {
      setSubmittingId(null);
    }
  }, [title, author]);

  return {
    title,
    author,
    results,
    searching,
    submittingId,
    error,
    setTitle,
    setAuthor,
    search,
    addResult,
    addManual,
  };
}
