import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getBearerToken } from "@/api/client";
import { audioKeyFromUrl, signAudioKeys, signChapterAudio, signedUrlFor } from "@/api/audio";
import { getBookDetail, getChapterSegments, putPlayback } from "@/api/books";
import { openPipelineStream } from "@/api/sse";
import type { Book, Chapter, Segment } from "@/api/types";
import { useToast } from "@/components/ui";
import {
  chapterDurationMs,
  findNextIndex,
  findPrevIndex,
  hasPendingLines,
  positionMsFor,
  resolveSeekPlan,
  segmentSourceKey,
  sumDurationsBefore,
} from "@/playback/playbackMath";
import { findNextPlayableChapter, resolveStartSegmentIndex } from "@/playback/playbackSelection";
import { createTransport } from "@/playback/audioTransport";
import { patchSegmentReady } from "@/playback/detailsData";
import { SLEEP_OFF, beginSleep, resumeSleep, tickSleep, type SleepState } from "@/playback/sleepTimer";

// Owns the whole listening session: the chapter being played, its segments and their signed
// URLs, which line is current, the sleep timer and the ~10s playback sync. It lives in the
// root layout so audio survives navigating between screens, matching the web client's single
// shared <audio> element.

const POSITION_SYNC_INTERVAL_MS = 10_000;
const STALL_POLL_INTERVAL_MS = 2000;

export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

interface PlayerContextValue {
  activeBook: Book | null;
  activeChapter: Chapter | null;
  segments: Segment[];
  signedUrls: Record<string, string>;
  currentIndex: number;
  currentSegment: Segment | null;
  isPlaying: boolean;
  isBufferingNext: boolean;
  playbackSpeed: number;
  positionMs: number;
  chapterTotalMs: number;
  sleep: SleepState;
  playChapter: (book: Book, chapter: Chapter, resumeMs?: number) => Promise<void>;
  togglePlayPause: () => void;
  goToSegment: (index: number) => void;
  goToPrev: () => void;
  goToNext: () => void;
  seekToRatio: (ratio: number) => void;
  setSpeed: (rate: number) => void;
  setSleepPreset: (seconds: number | null) => void;
  stop: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const transport = useMemo(() => createTransport(), []);

  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBufferingNext, setIsBufferingNext] = useState(false);
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [positionMs, setPositionMs] = useState(0);
  const [sleep, setSleep] = useState<SleepState>(SLEEP_OFF);

  const loadedKeyRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  const positionRef = useRef(0);
  const segmentsRef = useRef<Segment[]>([]);
  const signedRef = useRef<Record<string, string>>({});
  const currentIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const speedRef = useRef(1);
  const sleepRef = useRef<SleepState>(SLEEP_OFF);
  const bookRef = useRef<Book | null>(null);
  const chapterRef = useRef<Chapter | null>(null);
  const lastPublishedPositionRef = useRef(0);

  segmentsRef.current = segments;
  signedRef.current = signedUrls;
  currentIndexRef.current = currentIndex;
  isPlayingRef.current = isPlaying;
  speedRef.current = playbackSpeed;
  sleepRef.current = sleep;
  bookRef.current = activeBook;
  chapterRef.current = activeChapter;

  const mergeSigned = useCallback((additions: Record<string, string>) => {
    if (Object.keys(additions).length === 0) return;
    setSignedUrls((previous) => ({ ...previous, ...additions }));
  }, []);

  const syncPosition = useCallback((notifyOnUnauthorized = true) => {
    const book = bookRef.current;
    const chapter = chapterRef.current;
    if (!book || !chapter) return;
    const segment = segmentsRef.current[currentIndexRef.current];
    void putPlayback(
      {
        bookId: book.id,
        chapterId: chapter.id,
        positionMs: Math.max(0, Math.round(positionRef.current)),
        segmentIndex: segment?.segmentIndex ?? 1,
      },
      notifyOnUnauthorized,
    ).catch(() => {
      // Progress sync is best-effort; the next tick retries.
    });
  }, []);

  const applySegments = useCallback(
    async (fresh: Segment[]) => {
      const missing = fresh
        .filter((segment) => segment.status === "voiced")
        .map((segment) => audioKeyFromUrl(segment.audioUrl))
        .filter((key): key is string => !!key && !signedRef.current[key]);

      const additions = missing.length > 0 ? await signAudioKeys([...new Set(missing)]) : {};
      setSegments(fresh);
      mergeSigned(additions);
    },
    [mergeSigned],
  );

  const refreshSegments = useCallback(
    async (anchor?: number) => {
      const chapter = chapterRef.current;
      if (!chapter) return;
      try {
        const data = await getChapterSegments(chapter.id, anchor);
        await applySegments(data.segments);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) showToast("This chapter is no longer available.", "error");
      }
    },
    [applySegments, showToast],
  );

  const playChapter = useCallback(
    async (book: Book, chapter: Chapter, resumeMs = 0) => {
      const requestId = ++requestRef.current;
      try {
        // `at` moves the server's voicing window to the line the listener needs next.
        const data = await getChapterSegments(chapter.id, resumeMs <= 0 ? 1 : undefined);
        if (requestId !== requestRef.current) return;

        if (data.segments.length === 0) {
          showToast("This chapter has no lines yet. Try again shortly.", "error");
          return;
        }

        const signed = await signChapterAudio(data.segments);
        if (requestId !== requestRef.current) return;

        const startIndex = resolveStartSegmentIndex(data.segments, resumeMs);
        const preceding = sumDurationsBefore(data.segments, startIndex);
        pendingSeekRef.current = resumeMs > 0 ? Math.max(0, (resumeMs - preceding) / 1000) : null;
        loadedKeyRef.current = null;

        transport.pause();
        setActiveBook(book);
        setActiveChapter(data.chapter ?? chapter);
        setSegments(data.segments);
        setSignedUrls(signed);
        setCurrentIndex(startIndex);
        setPositionMs(resumeMs);
        positionRef.current = resumeMs;
        setAwaitingNext(false);
        setIsBufferingNext(false);
        setIsPlaying(true);
      } catch (error) {
        if (requestId !== requestRef.current) return;
        setIsPlaying(false);
        showToast(error instanceof ApiError ? error.message : "Could not open this chapter.", "error");
      }
    },
    [showToast, transport],
  );

  const playChapterRef = useRef(playChapter);
  playChapterRef.current = playChapter;

  const finishChapter = useCallback(async () => {
    transport.pause();
    setIsPlaying(false);
    setPositionMs(0);
    positionRef.current = 0;

    const book = bookRef.current;
    const chapter = chapterRef.current;
    if (!book || !chapter) return;

    try {
      const detail = await getBookDetail(book.id);
      const next = findNextPlayableChapter(detail.chapters, chapter.chapterIndex);
      if (!next) {
        showToast("You've reached the end of the voiced lines.");
        return;
      }
      showToast(`Continuing · ${next.title}`);
      await playChapterRef.current(book, next, 0);
    } catch {
      showToast("Could not continue to the next chapter.", "error");
    }
  }, [showToast, transport]);

  const finishChapterRef = useRef(finishChapter);
  finishChapterRef.current = finishChapter;

  // A finished line: move to the next playable one, or wait for the studio to voice it.
  const handleSegmentEnded = useCallback(() => {
    const list = segmentsRef.current;
    const index = currentIndexRef.current;
    const next = findNextIndex(list, index);

    if (next >= 0) {
      setCurrentIndex(next);
      return;
    }
    if (hasPendingLines(list)) {
      setAwaitingNext(true);
      setIsBufferingNext(true);
      return;
    }
    void finishChapterRef.current();
  }, []);

  const handleSegmentEndedRef = useRef(handleSegmentEnded);
  handleSegmentEndedRef.current = handleSegmentEnded;

  useEffect(() => {
    return transport.subscribe({
      // The player reports every few hundred milliseconds; only publish a changed quarter
      // second to the UI so the transcript does not re-render on every tick.
      onProgress: (currentTimeSec, isLoaded) => {
        if (!isLoaded) return;
        const absolute = positionMsFor(segmentsRef.current, currentIndexRef.current, currentTimeSec);
        positionRef.current = absolute;
        if (Math.abs(absolute - lastPublishedPositionRef.current) >= 250) {
          lastPublishedPositionRef.current = absolute;
          setPositionMs(absolute);
        }
      },
      onFinished: () => handleSegmentEndedRef.current(),
    });
  }, [transport]);

  // Source of truth for "what should be loaded": the current line, once its URL is signed.
  useEffect(() => {
    const segment = segments[currentIndex];
    if (!segment || !activeChapter) return;

    if (segment.status === "failed") {
      const next = findNextIndex(segments, currentIndex);
      if (next >= 0) setCurrentIndex(next);
      return;
    }
    if (segment.status !== "voiced") return;

    const url = signedUrlFor(segment, signedUrls);
    if (!url) return;

    const key = segmentSourceKey(segment, url);
    if (loadedKeyRef.current === key) return;

    loadedKeyRef.current = key;
    transport.load(url, { seekSec: pendingSeekRef.current, autoplay: isPlayingRef.current });
    pendingSeekRef.current = null;
    transport.setRate(speedRef.current);
    setIsBufferingNext(false);

    const nextSegment = segments[findNextIndex(segments, currentIndex)];
    transport.prefetch(nextSegment ? signedUrlFor(nextSegment, signedUrls) : null);
  }, [segments, signedUrls, currentIndex, activeChapter, transport]);

  useEffect(() => {
    if (!activeChapter) return;
    if (isPlaying) transport.play();
    else transport.pause();
  }, [isPlaying, activeChapter, transport]);

  // Waiting on the studio: poll the chapter until the next line is voiced. The `at` anchor
  // tells the server which line to voice next.
  useEffect(() => {
    if (!activeChapter || !isPlaying) return;
    const segment = segments[currentIndex];
    const needsCurrent = segment && segment.status !== "voiced" && segment.status !== "failed";
    if (!needsCurrent && !awaitingNext) return;

    setIsBufferingNext(true);
    const anchor = awaitingNext ? segments[currentIndex]?.segmentIndex : segment?.segmentIndex;
    void refreshSegments(anchor);
    const timer = setInterval(() => void refreshSegments(anchor), STALL_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeChapter, isPlaying, segments, currentIndex, awaitingNext, refreshSegments]);

  // A waited-for line landed: take it.
  useEffect(() => {
    if (!awaitingNext) return;
    const next = findNextIndex(segments, currentIndex);
    if (next < 0) return;
    const candidate = segments[next];
    if (candidate.status !== "voiced" || !signedUrlFor(candidate, signedUrls)) return;
    setAwaitingNext(false);
    setIsBufferingNext(false);
    setCurrentIndex(next);
  }, [awaitingNext, segments, signedUrls, currentIndex]);

  // Live pipeline updates keep the open chapter's lines current without a poll.
  useEffect(() => {
    if (!activeBook) return;
    return openPipelineStream({
      bookId: activeBook.id,
      token: getBearerToken(),
      onEvent: (event) => {
        if (event.type !== "segment_ready" || event.chapterId !== chapterRef.current?.id) return;
        const patched = patchSegmentReady(segmentsRef.current, event);
        if (patched === segmentsRef.current) return;

        const key = audioKeyFromUrl(event.audioUrl);
        setSegments(patched);
        if (key) {
          void signAudioKeys([key])
            .then(mergeSigned)
            .catch(() => {
              // The poll that follows a reconnect will retry the signature.
            });
        }
      },
      onReconnect: () => void refreshSegments(),
    });
  }, [activeBook, mergeSigned, refreshSegments]);

  // ~10s position sync, plus a final write whenever the active chapter changes or unmounts.
  useEffect(() => {
    if (!activeBook || !activeChapter) return;
    const timer = setInterval(() => syncPosition(), POSITION_SYNC_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      syncPosition(false);
    };
  }, [activeBook, activeChapter, syncPosition]);

  // Sleep timer: one tick per second while playing; zero stops playback and resets to Off.
  useEffect(() => {
    if (sleep.remainingSeconds === null || !isPlaying) return;
    setSleep((previous) => resumeSleep(previous, Date.now()));

    const timer = setInterval(() => {
      const result = tickSleep(sleepRef.current, Date.now(), isPlayingRef.current);
      if (result.pauseNow) {
        setSleep(SLEEP_OFF);
        setIsPlaying(false);
        transport.pause();
        syncPosition();
        return;
      }
      setSleep(result.state);
    }, 1000);
    return () => clearInterval(timer);
  }, [sleep.remainingSeconds !== null, isPlaying, syncPosition, transport]);

  const togglePlayPause = useCallback(() => {
    if (!chapterRef.current) return;
    if (isPlayingRef.current) {
      setIsPlaying(false);
      transport.pause();
      syncPosition();
      return;
    }
    setAwaitingNext(false);
    setIsPlaying(true);
  }, [syncPosition, transport]);

  const goToSegment = useCallback((index: number) => {
    if (index < 0 || index >= segmentsRef.current.length) return;
    pendingSeekRef.current = null;
    setAwaitingNext(false);
    setCurrentIndex(index);
    if (!isPlayingRef.current) setIsPlaying(true);
  }, []);

  const goToPrev = useCallback(() => {
    const previous = findPrevIndex(segmentsRef.current, currentIndexRef.current);
    if (previous >= 0) goToSegment(previous);
  }, [goToSegment]);

  const goToNext = useCallback(() => {
    const list = segmentsRef.current;
    const next = findNextIndex(list, currentIndexRef.current);
    if (next >= 0) {
      goToSegment(next);
      return;
    }
    if (hasPendingLines(list)) {
      setAwaitingNext(true);
      setIsBufferingNext(true);
      setIsPlaying(true);
    }
  }, [goToSegment]);

  const seekToRatio = useCallback(
    (ratio: number) => {
      const list = segmentsRef.current;
      const plan = resolveSeekPlan(list, currentIndexRef.current, ratio);
      if (!plan) return;

      if (plan.appliesInPlace) {
        transport.seekTo(plan.offsetSec);
      } else {
        pendingSeekRef.current = plan.offsetSec;
        setAwaitingNext(false);
        setCurrentIndex(plan.index);
      }
      setPositionMs(plan.positionMs);
      positionRef.current = plan.positionMs;
    },
    [transport],
  );

  const setSpeed = useCallback(
    (rate: number) => {
      setPlaybackSpeed(rate);
      speedRef.current = rate;
      transport.setRate(rate);
    },
    [transport],
  );

  const setSleepPreset = useCallback((seconds: number | null) => {
    setSleep(beginSleep(seconds, Date.now()));
  }, []);

  const stop = useCallback(() => {
    transport.pause();
    setIsPlaying(false);
    setActiveBook(null);
    setActiveChapter(null);
    setSegments([]);
    setSignedUrls({});
    setCurrentIndex(0);
    setPositionMs(0);
    setSleep(SLEEP_OFF);
    loadedKeyRef.current = null;
  }, [transport]);

  const chapterTotalMs = chapterDurationMs(segments) || (activeChapter?.durationMs ?? 0);

  const value = useMemo<PlayerContextValue>(
    () => ({
      activeBook,
      activeChapter,
      segments,
      signedUrls,
      currentIndex,
      currentSegment: segments[currentIndex] ?? null,
      isPlaying,
      isBufferingNext,
      playbackSpeed,
      positionMs,
      chapterTotalMs,
      sleep,
      playChapter,
      togglePlayPause,
      goToSegment,
      goToPrev,
      goToNext,
      seekToRatio,
      setSpeed,
      setSleepPreset,
      stop,
    }),
    [
      activeBook,
      activeChapter,
      segments,
      signedUrls,
      currentIndex,
      isPlaying,
      isBufferingNext,
      playbackSpeed,
      positionMs,
      chapterTotalMs,
      sleep,
      playChapter,
      togglePlayPause,
      goToSegment,
      goToPrev,
      goToNext,
      seekToRatio,
      setSpeed,
      setSleepPreset,
      stop,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used inside PlayerProvider");
  return context;
}
