import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getBearerToken } from "@/api/client";
import { getBookDetail, retryBook } from "@/api/books";
import { openPipelineStream } from "@/api/sse";
import type { Book, Chapter, PipelineEvent } from "@/api/types";
import { createDetailState, reduceDetailEvent, resumePositionFor, type DetailData, type DetailState } from "@/playback/detailsData";

// The detail screen's data flow: one fetch for the payload, then the book's event stream
// patching it in place. A reconnect refetches, because events may have been missed while the
// stream was down — the same contract the web client's `useBookDetail` honours.

export interface BookDetailModel {
  loading: boolean;
  loadError: string | null;
  notFound: boolean;
  book: Book | null;
  chapters: Chapter[];
  state: DetailState;
  reload: () => Promise<void>;
  resumeMsFor: (chapter: Chapter) => number;
  retry: () => Promise<void>;
  retrying: boolean;
}

export function useBookDetail(bookId: string | undefined): BookDetailModel {
  const [state, setState] = useState<DetailState>(() => createDetailState(null));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const fetchSeqRef = useRef(0);

  const fetchDetail = useCallback(async () => {
    if (!bookId) return;
    const seq = ++fetchSeqRef.current;
    try {
      const data = (await getBookDetail(bookId)) as DetailData;
      if (seq !== fetchSeqRef.current) return;
      setState((previous) => {
        const next = createDetailState(data);
        // Keep the live log across refetches; only the payload and counters are replaced.
        return { ...next, log: previous.log.length > 0 ? previous.log : next.log, nextLogId: previous.nextLogId };
      });
      setLoadError(null);
      setNotFound(false);
    } catch (error) {
      if (seq !== fetchSeqRef.current) return;
      if (error instanceof ApiError && error.status === 404) setNotFound(true);
      else setLoadError(error instanceof ApiError ? error.message : "Could not load this book.");
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [bookId]);

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    setLoading(true);
    void fetchDetail();
  }, [fetchDetail]);

  useEffect(() => {
    if (!bookId || notFound) return;

    return openPipelineStream({
      bookId,
      token: getBearerToken(),
      onEvent: (event: PipelineEvent) => {
        const result = reduceDetailEvent(stateRef.current, event);
        setState(result.state);
        if (result.refetch) void fetchDetail();
      },
      onReconnect: () => void fetchDetail(),
    });
  }, [bookId, notFound, fetchDetail]);

  const resumeMsFor = useCallback(
    (chapter: Chapter) => resumePositionFor(state.data?.playbackState, chapter.id, chapter.durationMs),
    [state.data?.playbackState],
  );

  const retry = useCallback(async () => {
    if (!bookId || retrying) return;
    setRetrying(true);
    try {
      await retryBook(bookId);
      await fetchDetail();
    } finally {
      setRetrying(false);
    }
  }, [bookId, retrying, fetchDetail]);

  return {
    loading,
    loadError,
    notFound,
    book: state.data?.book ?? null,
    chapters: state.data?.chapters ?? [],
    state,
    reload: fetchDetail,
    resumeMsFor,
    retry,
    retrying,
  };
}
