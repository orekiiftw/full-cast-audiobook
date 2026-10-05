import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isPendingStatus, isPlayableSegment } from "../../lib/segmentStatus";
import type { Segment } from "../../types/api";
import { findNextIndex, findPrevIndex, hasPendingLines, resolveSeekPlan, sumDurationsBefore } from "./playbackMath";
import { usePlaybackFollow } from "./usePlaybackFollow";
import { useSegmentSources } from "./useSegmentSources";
import { useSegmentPlaybackRefs, useSegmentSync } from "./useSegmentSync";
import type { AudioTransport } from "./useAudioTransport";

export interface SegmentPlayback {
  isBufferingNext: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  togglePlayPause: () => void;
  goToSegment: (index: number) => void;
  goToPrev: () => void;
  goToNext: () => void;
  seekBy: (seconds: number) => void;
  seekToRatio: (ratio: number) => void;
  handleSegmentEnded: () => void;
  restartSegmentIfActive: (freshSegments: Segment[], segmentId: string) => void;
}

interface UseSegmentPlaybackOptions {
  bookId: string;
  chapterId: string;
  segmentsList: Segment[];
  setSegmentsList: (segments: Segment[]) => void;
  currentSegmentIndex: number;
  setCurrentSegmentIndex: (index: number) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  initialPositionMs: number;
  setPositionMs: (position: number) => void;
  audio: AudioTransport;
  onChapterEnded?: () => void;
}

export function useSegmentPlayback({
  bookId,
  chapterId,
  segmentsList,
  setSegmentsList,
  currentSegmentIndex,
  setCurrentSegmentIndex,
  isPlaying,
  setIsPlaying,
  initialPositionMs,
  setPositionMs,
  audio,
  onChapterEnded,
}: UseSegmentPlaybackOptions): SegmentPlayback {
  const [isBufferingNext, setIsBufferingNext] = useState(false);
  const { loadSegmentSource, prefetchNextSegment, queueSeek, isSegmentLoaded, getLoadedSegmentId, restartSegmentSource } =
    useSegmentSources(audio);
  const refs = useSegmentPlaybackRefs(segmentsList, currentSegmentIndex, isPlaying, isBufferingNext);

  const resumeSeekReadyRef = useRef(false);

  useLayoutEffect(() => {
    if (resumeSeekReadyRef.current || initialPositionMs <= 0) return;
    resumeSeekReadyRef.current = true;
    const preceding = sumDurationsBefore(segmentsList, currentSegmentIndex);
    queueSeek(Math.max(0, (initialPositionMs - preceding) / 1000));
  }, [initialPositionMs, currentSegmentIndex, segmentsList, queueSeek]);

  const finishChapter = useCallback(() => {
    refs.awaitingNext.current = false;
    setIsPlaying(false);
    setPositionMs(0);
    setCurrentSegmentIndex(0);
    onChapterEnded?.();
  }, [onChapterEnded, refs, setCurrentSegmentIndex, setIsPlaying, setPositionMs]);

  const handleSegmentEnded = useCallback(() => {
    const index = refs.currentIndex.current;
    const segments = refs.segments.current;
    const next = findNextIndex(segments, index);

    if (next >= 0) {
      refs.awaitingNext.current = false;
      setCurrentSegmentIndex(next);
      return;
    }

    if (hasPendingLines(segments)) {
      refs.awaitingNext.current = true;
      setIsBufferingNext(true);
      return;
    }

    finishChapter();
  }, [finishChapter, refs, setCurrentSegmentIndex]);

  const { isPolling, clearPoll, startPollingForSegment } = useSegmentSync({
    bookId,
    chapterId,
    refs,
    setSegmentsList,
    setCurrentIndex: setCurrentSegmentIndex,
    setBufferingNext: setIsBufferingNext,
    onChapterComplete: finishChapter,
    loadSegmentSource,
    getLoadedSegmentId,
  });

  useEffect(() => {
    const activeSegment = segmentsList[currentSegmentIndex];
    if (!activeSegment) return;

    if (activeSegment.status === "failed") {
      const next = findNextIndex(segmentsList, currentSegmentIndex);
      if (next >= 0) {
        setCurrentSegmentIndex(next);
      } else if (hasPendingLines(segmentsList)) {
        refs.awaitingNext.current = true;
        setIsBufferingNext(true);
        startPollingForSegment(activeSegment.id);
      } else {
        audio.pause();
        setIsPlaying(false);
      }
      return;
    }

    if (isPlayableSegment(activeSegment)) {
      clearPoll();
      if (refs.isBufferingNext.current) setIsBufferingNext(false);
      refs.awaitingNext.current = false;

      if (!isSegmentLoaded(activeSegment)) {
        loadSegmentSource(activeSegment, { autoplay: isPlaying });
      } else if (isPlaying && audio.isActuallyPaused()) {
        void audio.play();
      }
      return;
    }

    if (isPendingStatus(activeSegment.status) || !activeSegment.audioUrl) {
      if (!isPlaying) {
        clearPoll();
        if (refs.isBufferingNext.current) setIsBufferingNext(false);
        refs.awaitingNext.current = false;
        audio.pause();
        return;
      }
      if (!refs.isBufferingNext.current || !isPolling()) {
        audio.pause();
        setIsBufferingNext(true);
        startPollingForSegment(activeSegment.id);
      }
    }
  }, [
    currentSegmentIndex,
    segmentsList,
    refs,
    clearPoll,
    startPollingForSegment,
    isPolling,
    audio,
    isPlaying,
    setIsPlaying,
    setCurrentSegmentIndex,
    isSegmentLoaded,
    loadSegmentSource,
  ]);

  usePlaybackFollow({
    isPlaying,
    isBufferingNext,
    refs,
    audio,
    setIsPlaying,
    segmentsList,
    currentSegmentIndex,
    prefetchNextSegment,
  });

  useEffect(() => () => clearPoll(), [clearPoll]);

  const togglePlayPause = useCallback(() => {
    if (!refs.isPlaying.current) {
      setIsPlaying(true);
      void audio.play();
      return;
    }
    if (refs.isBufferingNext.current) {
      refs.awaitingNext.current = false;
      setIsBufferingNext(false);
      setIsPlaying(false);
      audio.pause();
      return;
    }
    if (audio.isActuallyPaused()) {
      void audio.play();
      return;
    }
    setIsPlaying(false);
  }, [audio, refs, setIsPlaying]);

  const goToSegment = useCallback(
    (index: number) => {
      if (index < 0 || index >= refs.segments.current.length) return;
      queueSeek(null);
      refs.awaitingNext.current = false;
      setCurrentSegmentIndex(index);
      if (!refs.isPlaying.current) setIsPlaying(true);
    },
    [queueSeek, refs, setCurrentSegmentIndex, setIsPlaying],
  );

  const goToPrev = useCallback(() => {
    const previous = findPrevIndex(refs.segments.current, refs.currentIndex.current);
    if (previous >= 0) goToSegment(previous);
  }, [goToSegment, refs]);

  const goToNext = useCallback(() => {
    const segments = refs.segments.current;
    const index = refs.currentIndex.current;
    const next = findNextIndex(segments, index);

    if (next >= 0) {
      goToSegment(next);
      return;
    }

    if (hasPendingLines(segments)) {
      refs.awaitingNext.current = true;
      setIsBufferingNext(true);
      if (!refs.isPlaying.current) setIsPlaying(true);
      startPollingForSegment(segments[index]?.id ?? "");
    }
  }, [goToSegment, refs, setIsPlaying, startPollingForSegment]);

  const seekBy = useCallback(
    (seconds: number) => {
      audio.seekTo(audio.getCurrentTime() + seconds);
      if (refs.isPlaying.current && !refs.isBufferingNext.current) void audio.play();
    },
    [audio, refs],
  );

  const seekToRatio = useCallback(
    (ratio: number) => {
      const plan = resolveSeekPlan(refs.segments.current, refs.currentIndex.current, ratio);
      if (!plan) return;

      if (plan.appliesInPlace) {
        audio.seekTo(plan.offsetSec);
        if (refs.isPlaying.current) void audio.play();
      } else {
        queueSeek(plan.offsetSec);
        refs.awaitingNext.current = false;
        setCurrentSegmentIndex(plan.index);
      }
      setPositionMs(plan.positionMs);
    },
    [audio, queueSeek, refs, setCurrentSegmentIndex, setPositionMs],
  );

  const restartSegmentIfActive = useCallback(
    (freshSegments: Segment[], segmentId: string) => {
      const active = freshSegments[refs.currentIndex.current];
      if (!active || active.id !== segmentId || !isPlayableSegment(active)) return;
      restartSegmentSource(active, refs.isPlaying.current);
    },
    [refs, restartSegmentSource],
  );

  return {
    isBufferingNext,
    canGoPrev: findPrevIndex(segmentsList, currentSegmentIndex) >= 0,
    canGoNext: findNextIndex(segmentsList, currentSegmentIndex) >= 0 || hasPendingLines(segmentsList),
    togglePlayPause,
    goToSegment,
    goToPrev,
    goToNext,
    seekBy,
    seekToRatio,
    handleSegmentEnded,
    restartSegmentIfActive,
  };
}
