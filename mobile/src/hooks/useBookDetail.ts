import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { getBookDetail, retryBook } from "@/api/books";
import type { Book, Chapter, PipelineEvent } from "@/api/types";
import { useBookEvents } from "@/hooks/useBookEvents";
import { readBookSeed } from "@/lib/bookSeed";
import { createCoalescer } from "@/lib/coalesce";
import { perfMark } from "@/lib/perf";
import { createDetailState, reduceDetailEvent, resumePositionFor, type DetailData, type DetailState } from "@/playback/detailsData";

// The detail screen's data flow: one fetch for the payload, then the book's event stream
// patching it in place. A reconnect refetches, because events may have been missed while the
// stream was down — the same contract the web client's `useBookDetail` honours.
//
// Two performance rules live here rather than in the screen. The book row that was tapped is
// handed back as `seed` so the screen can paint real content on its first frame while the
// 1.2–4.1s fetch is in flight. And a burst of status events — the pipeline emits several in a
// row — collapses into one refetch instead of one round trip per event.

// Long enough to swallow a status burst, short enough that a finished pipeline is reflected
// before the listener notices.
export const DETAIL_REFETCH_DELAY_MS = 400;

export interface BookDetailModel {
  loading: boolean;
  loadError: string | null;
  notFound: boolean;
  // The library row this screen was opened from, when there is one.
  seed: Book | null;
  book: Book | null;
  chapters: Chapter[];
  state: DetailState;
  reload: () => Promise<void>;
  resumeMsFor: (chapter: Chapter) => number;
  retry: () => Promise<void>;
  retrying: boolean;
}

export function useBookDetail(bookId: string | undefined): BookDetailModel {
  const seed = useMemo(() => readBookSeed(bookId), [bookId]);
  const [state, setState] = useState<DetailState>(() => createDetailState(null));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const fetchSeqRef = useRef(0);

  const fetchDetail = useCallback(async () => {
    if (!bookId) return;
    const seq = ++fetchSeqRef.current;
    perfMark("detail:fetch-start");
    try {
      const data = (await getBookDetail(bookId)) as DetailData;
      if (seq !== fetchSeqRef.current) return;
      perfMark("detail:fetch-landed");
      setState((previous) => {
        const next = createDetailState(data);
        // Keep the live log across refetches; only the payload and counters are replaced.
        return { ...next, log: previous.log.length > 0 ? previous.log : next.log, nextLogId: previous.nextLogId };
      });
      setLoadError(null);
      setNotFound(false);
    } catch (error) {
      if (seq !== fetchSeqRef.current) return;
      if (error instanceof ApiError && error.status === 404) {
        setNotFound(true);
        setLoadError(null);
      } else {
        setLoadError(error instanceof ApiError ? error.message : "Could not load this book.");
      }
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [bookId]);

  const fetchRef = useRef(fetchDetail);
  fetchRef.current = fetchDetail;

  const refetchSoon = useMemo(() => createCoalescer(() => void fetchRef.current(), DETAIL_REFETCH_DELAY_MS), []);
  useEffect(() => () => refetchSoon.cancel(), [refetchSoon]);

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    perfMark("detail:open");
    setLoading(true);
    void fetchDetail();
  }, [fetchDetail]);

  useBookEvents(
    notFound ? null : bookId,
    (event: PipelineEvent) => {
      const result = reduceDetailEvent(stateRef.current, event);
      setState(result.state);
      if (result.refetch) refetchSoon.schedule();
    },
    () => void fetchRef.current(),
  );

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
    seed,
    book: state.data?.book ?? seed,
    chapters: state.data?.chapters ?? [],
    state,
    reload: fetchDetail,
    resumeMsFor,
    retry,
    retrying,
  };
}
