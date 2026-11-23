import { useCallback, useState } from "react";
import { searchBooks, submitBook } from "@/api/books";
import type { Book, BookResult } from "@/api/types";
import { describeAddFailure, describeSearchFailure, type SearchFailure } from "@/lib/searchFeedback";

// Search → pick → submit, the flow the web client's Add Book modal offers for titles it has
// to acquire rather than upload. The mobile app deliberately stops here: no EPUB picker, no
// magnet field. Picking a result hands back the book row; narrating what happens next is the
// staging panel's job (`useBookStaging`).
export interface AddBookModel {
  title: string;
  author: string;
  results: BookResult[] | null;
  searching: boolean;
  submittingId: string | null;
  failure: SearchFailure | null;
  // The server answers inside a budget and names the providers still working; null when the
  // answer was complete.
  pending: string[] | null;
  providers: string[] | null;
  searched: boolean;
  setTitle: (value: string) => void;
  setAuthor: (value: string) => void;
  search: () => Promise<void>;
  addResult: (result: BookResult) => Promise<Book | null>;
  addManual: () => Promise<Book | null>;
  reset: () => void;
}

export function useAddBook(): AddBookModel {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [results, setResults] = useState<BookResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<SearchFailure | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);
  const [providers, setProviders] = useState<string[] | null>(null);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async () => {
    const trimmedTitle = title.trim();
    const trimmedAuthor = author.trim();
    if (!trimmedTitle && !trimmedAuthor) {
      setFailure({ kind: "unknown", title: "Nothing to search", detail: "Enter a title or an author." });
      return;
    }

    setSearching(true);
    setFailure(null);
    setSearched(true);
    try {
      const response = await searchBooks({
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
        ...(trimmedAuthor ? { author: trimmedAuthor } : {}),
      });
      setResults(response.results ?? []);
      setPending(response.partial ? (response.pending ?? []) : null);
      setProviders(response.providers ?? null);
    } catch (caught) {
      setResults(null);
      setPending(null);
      setFailure(describeSearchFailure(caught));
    } finally {
      setSearching(false);
    }
  }, [title, author]);

  const addResult = useCallback(async (result: BookResult) => {
    setSubmittingId(result.id);
    setFailure(null);
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
      setSubmittingId(null);
      setFailure(describeAddFailure(caught));
      return null;
    }
  }, []);

  const addManual = useCallback(async () => {
    const trimmedTitle = title.trim();
    const trimmedAuthor = author.trim();
    if (!trimmedTitle || !trimmedAuthor) {
      setFailure({ kind: "unknown", title: "Two fields to go", detail: "A title and an author are both required." });
      return null;
    }

    setSubmittingId("manual");
    setFailure(null);
    try {
      return await submitBook({ title: trimmedTitle, author: trimmedAuthor });
    } catch (caught) {
      setFailure(describeAddFailure(caught));
      return null;
    }
  }, [title, author]);

  const reset = useCallback(() => {
    setTitle("");
    setAuthor("");
    setResults(null);
    setSearching(false);
    setSubmittingId(null);
    setFailure(null);
    setPending(null);
    setProviders(null);
    setSearched(false);
  }, []);

  return {
    title,
    author,
    results,
    searching,
    submittingId,
    failure,
    pending,
    providers,
    searched,
    setTitle,
    setAuthor,
    search,
    addResult,
    addManual,
    reset,
  };
}
