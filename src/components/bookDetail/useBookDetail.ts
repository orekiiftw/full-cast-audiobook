import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useSSE } from "../../hooks/useSSE";
import {
  PROGRESS_LOG_LIMIT,
  applyPipelineEvent,
  isBookWorking,
  resumePositionFor,
  type DetailData,
  type ProgressLogEntry,
  type SegmentProgress,
} from "./detailsData";
import type { Book, CastMember, Chapter, PipelineEvent } from "../../types/api";

export interface BookDetailModel {
  loading: boolean;
  loadError: boolean;
  notFound: boolean;
  book: Book | null;
  chapters: Chapter[];
  pronunciation: DetailData["pronunciation"];
  narrator: CastMember | null;
  isWorking: boolean;
  canRetry: boolean;
  segmentProgress: SegmentProgress;
  progressLog: ProgressLogEntry[];
  reload: () => Promise<void>;
  retryLoad: () => void;
  clearProgressLog: () => void;
  selectChapter: (chapter: Chapter) => void;
}

export function useBookDetail(bookId: string, onPlayChapter: (book: Book, chapter: Chapter, resumeMs?: number) => void): BookDetailModel {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [progressLog, setProgressLog] = useState<ProgressLogEntry[]>([]);
  const [segmentProgress, setSegmentProgress] = useState<SegmentProgress>({});
  const logSeqRef = useRef(0);
  const fetchSeqRef = useRef(0);
  const dataRef = useRef<DetailData | null>(null);

  const fetchDetails = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      const response = await apiFetch(`/api/books/${bookId}`);
      if (seq !== fetchSeqRef.current) return;
      if (response.status === 404) {
        setNotFound(true);
        setLoadError(false);
        return;
      }
      if (response.ok) {
        const body = (await response.json()) as DetailData;
        if (seq !== fetchSeqRef.current) return;
        setData(body);
        setLoadError(false);
        if (body.segmentProgress) {
          setSegmentProgress(body.segmentProgress);
        }
      } else if (response.status !== 401) {
        setLoadError(true);
      }
    } catch (error) {
      console.error(error);
      if (seq === fetchSeqRef.current) setLoadError(true);
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [bookId]);

  const pushLog = useCallback((message: string) => {
    setProgressLog((prev) => [{ id: ++logSeqRef.current, text: message }, ...prev.slice(0, PROGRESS_LOG_LIMIT - 1)]);
  }, []);

  const handlePipelineEvent = useCallback(
    (payload: PipelineEvent) => applyPipelineEvent(payload, { setData, setSegmentProgress, pushLog, refetch: () => void fetchDetails() }),
    [pushLog, fetchDetails],
  );

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const selectChapter = useCallback(
    (chapter: Chapter) => {
      const current = dataRef.current;
      if (!current) return;
      onPlayChapter(current.book, chapter, resumePositionFor(current.playbackState, chapter.id));
    },
    [onPlayChapter],
  );

  useEffect(() => {
    void fetchDetails();
  }, [fetchDetails]);

  useSSE(`/api/books/${bookId}/events`, {
    onEvent: handlePipelineEvent,
    onError: () => console.warn("SSE connection interrupted. Reconnecting…"),
    onReconnect: () => void fetchDetails(),
  });

  const retryLoad = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    void fetchDetails();
  }, [fetchDetails]);

  const clearProgressLog = useCallback(() => setProgressLog([]), []);

  const book = data?.book ?? null;
  const castList = data?.cast ?? [];
  const narrator = castList.find((member) => member.name.toLowerCase() === "narrator") ?? castList[0] ?? null;

  return {
    loading,
    loadError,
    notFound,
    book,
    chapters: data?.chapters ?? [],
    pronunciation: data?.pronunciation ?? [],
    narrator,
    isWorking: book ? isBookWorking(book) : false,
    canRetry: !!(data?.canRetry || book?.epubR2Key),
    segmentProgress,
    progressLog,
    reload: fetchDetails,
    retryLoad,
    clearProgressLog,
    selectChapter,
  };
}
