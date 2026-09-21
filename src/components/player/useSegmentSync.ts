import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { apiFetch } from "../../lib/api";
import { applySegmentReady } from "../../lib/segmentPatch";
import { isPlayableSegment } from "../../lib/segmentStatus";
import type { PipelineEvent, Segment, SegmentReadyEvent } from "../../types/api";
import { useSSE } from "../../hooks/useSSE";
import { findNextIndex, hasPendingLines } from "./playbackMath";

const SSE_REFRESH_MIN_MS = 500;
const POLL_INTERVAL_MS = 1200;

export interface SegmentPlaybackRefs {
  segments: MutableRefObject<Segment[]>;
  currentIndex: MutableRefObject<number>;
  isPlaying: MutableRefObject<boolean>;
  awaitingNext: MutableRefObject<boolean>;
  isBufferingNext: MutableRefObject<boolean>;
}

interface UseSegmentSyncOptions {
  bookId: string;
  chapterId: string;
  refs: SegmentPlaybackRefs;
  setSegmentsList: (segments: Segment[]) => void;
  setCurrentIndex: (index: number) => void;
  setBufferingNext: (buffering: boolean) => void;
  onChapterComplete: () => void;
  loadSegmentSource: (segment: Segment, options: { autoplay: boolean }) => void;
  getLoadedSegmentId: () => string | null;
}

export interface SegmentSync {
  isPolling: () => boolean;
  clearPoll: () => void;
  startPollingForSegment: (segmentId: string) => void;
}

export function useSegmentPlaybackRefs(
  segmentsList: Segment[],
  currentSegmentIndex: number,
  isPlaying: boolean,
  isBufferingNext: boolean,
): SegmentPlaybackRefs {
  const segments = useRef(segmentsList);
  const currentIndex = useRef(currentSegmentIndex);
  const isPlayingRef = useRef(isPlaying);
  const isBufferingNextRef = useRef(isBufferingNext);
  const awaitingNext = useRef(false);

  useEffect(() => {
    segments.current = segmentsList;
  }, [segmentsList]);
  useEffect(() => {
    currentIndex.current = currentSegmentIndex;
  }, [currentSegmentIndex]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    isBufferingNextRef.current = isBufferingNext;
  }, [isBufferingNext]);

  return useMemo(() => ({ segments, currentIndex, isPlaying: isPlayingRef, awaitingNext, isBufferingNext: isBufferingNextRef }), []);
}

export function useSegmentSync({
  bookId,
  chapterId,
  refs,
  setSegmentsList,
  setCurrentIndex,
  setBufferingNext,
  onChapterComplete,
  loadSegmentSource,
  getLoadedSegmentId,
}: UseSegmentSyncOptions): SegmentSync {
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);
  const lastRefreshRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);

  const clearPoll = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const refreshSegments = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/chapters/${chapterId}/segments`);
      if (!response.ok) return null;
      const data = (await response.json()) as { segments?: Segment[] };
      const freshSegments = data.segments ?? [];
      setSegmentsList(freshSegments);
      return freshSegments;
    } catch (err) {
      console.error("Error refreshing segments:", err);
      return null;
    }
  }, [chapterId, setSegmentsList]);

  const advanceFromFreshSegments = useCallback(
    (freshSegments: Segment[]) => {
      const index = refs.currentIndex.current;

      if (refs.awaitingNext.current) {
        const next = findNextIndex(freshSegments, index);
        if (next >= 0) {
          refs.awaitingNext.current = false;
          setCurrentIndex(next);
          return;
        }
        if (!hasPendingLines(freshSegments)) {
          refs.awaitingNext.current = false;
          setBufferingNext(false);
          if (refs.isPlaying.current) onChapterComplete();
        }
        return;
      }

      const active = freshSegments[index];
      if (refs.isBufferingNext.current && isPlayableSegment(active) && getLoadedSegmentId() !== active.id) {
        clearPoll();
        setBufferingNext(false);
        loadSegmentSource(active, { autoplay: refs.isPlaying.current });
      }
    },
    [clearPoll, getLoadedSegmentId, loadSegmentSource, onChapterComplete, refs, setBufferingNext, setCurrentIndex],
  );

  const startPollingForSegment = useCallback(
    (segmentId: string) => {
      clearPoll();
      pollIntervalRef.current = setInterval(async () => {
        if (pollInFlightRef.current) return;
        pollInFlightRef.current = true;
        try {
          const freshSegments = await refreshSegments();
          if (!freshSegments) return;

          if (refs.awaitingNext.current || refs.isBufferingNext.current) {
            advanceFromFreshSegments(freshSegments);
            return;
          }

          const currentSegment = freshSegments.find((segment) => segment.id === segmentId);
          if (currentSegment && isPlayableSegment(currentSegment)) {
            clearPoll();
            setBufferingNext(false);
            loadSegmentSource(currentSegment, { autoplay: refs.isPlaying.current });
          }
        } finally {
          pollInFlightRef.current = false;
        }
      }, POLL_INTERVAL_MS);
    },
    [advanceFromFreshSegments, clearPoll, loadSegmentSource, refs, refreshSegments, setBufferingNext],
  );

  const runRefresh = useCallback(() => {
    lastRefreshRef.current = Date.now();
    void refreshSegments().then((fresh) => {
      if (!fresh) return;
      advanceFromFreshSegments(fresh);
    });
  }, [advanceFromFreshSegments, refreshSegments]);

  const handleSegmentReady = useCallback(
    (event: SegmentReadyEvent) => {
      const patched = applySegmentReady(refs.segments.current, event);
      if (patched === refs.segments.current) return;
      setSegmentsList(patched);
      advanceFromFreshSegments(patched);
    },
    [advanceFromFreshSegments, refs, setSegmentsList],
  );

  const handlePipelineEvent = useCallback(
    (payload: PipelineEvent) => {
      if (payload.type !== "segment_ready" && payload.type !== "chapter_status") return;
      if (payload.chapterId && payload.chapterId !== chapterId) return;

      if (payload.type === "segment_ready" && payload.audioUrl) {
        handleSegmentReady(payload);
        return;
      }

      if (refreshTimerRef.current !== null) return;
      const elapsed = Date.now() - lastRefreshRef.current;
      if (elapsed >= SSE_REFRESH_MIN_MS) {
        runRefresh();
        return;
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        runRefresh();
      }, SSE_REFRESH_MIN_MS - elapsed);
    },
    [chapterId, handleSegmentReady, runRefresh],
  );

  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    },
    [],
  );

  useSSE(`/api/books/${bookId}/events`, { onEvent: handlePipelineEvent, onReconnect: runRefresh });

  const isPolling = useCallback(() => pollIntervalRef.current !== null, []);

  return useMemo(() => ({ isPolling, clearPoll, startPollingForSegment }), [clearPoll, isPolling, startPollingForSegment]);
}
