import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "@/api/client";
import { audioKeyFromUrl, audioKeysOf, signAudioKeys, signedUrlFor } from "@/api/audio";
import { getBookDetail, getChapterSegments, putPlayback } from "@/api/books";
import type { Book, Chapter, Segment } from "@/api/types";
import { useToast } from "@/components/ui";
import { useBookEvents } from "@/hooks/useBookEvents";
import { createSignBatcher } from "@/lib/signBatch";
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
import {
  getPositionSnapshot,
  positionRatio,
  resetPosition,
  setChapterTotal,
  setPosition,
  subscribePosition,
} from "@/playback/positionStore";
import { SLEEP_OFF, beginSleep, resumeSleep, tickSleep, type SleepState } from "@/playback/sleepTimer";

// Owns the whole listening session: the chapter being played, its segments and their signed
// URLs, which line is current, the sleep timer and the ~10s playback sync. It lives in the
// root layout so audio survives navigating between screens, matching the web client's single
// shared <audio> element.
//
// Two things about its shape are deliberate. First, the play head is not in this state: it
// moves four times a second while a line plays, and holding it in the provider's state meant
// every tick re-rendered the provider and therefore the whole navigator. It lives in
// `positionStore`, and only the components that display a position subscribe (`usePlayerPosition`).
// Second, signed URLs are signed in batches and remembered for the life of the session, so a
// chapter that streams in line by line costs one media-token request per burst instead of one
// per line, and nothing that is already signed is ever signed twice.

const POSITION_SYNC_INTERVAL_MS = 10_000;
const STALL_POLL_INTERVAL_MS = 2000;

export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

interface PlayerSessionValue {
  activeBook: Book | null;
  activeChapter: Chapter | null;
  segments: Segment[];
  signedUrls: Record<string, string>;
  currentIndex: number;
  currentSegment: Segment | null;
  isPlaying: boolean;
  isBufferingNext: boolean;
  playbackSpeed: number;
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

const PlayerContext = createContext<PlayerSessionValue | null>(null);

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
  const [sleep, setSleep] = useState<SleepState>(SLEEP_OFF);

  const signBatcher = useMemo(() => createSignBatcher((keys) => signAudioKeys(keys)), []);
  useEffect(() => () => signBatcher.dispose(), [signBatcher]);

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

  // The chart of the play head: the store is what the dock, the scrubber and the clock read.
  const publishPosition = useCallback((absolute: number) => {
    positionRef.current = absolute;
    if (Math.abs(absolute - lastPublishedPositionRef.current) < 250) return;
    lastPublishedPositionRef.current = absolute;
    setPosition(absolute);
  }, []);

  const mergeSigned = useCallback((additions: Record<string, string>) => {
    if (Object.keys(additions).length === 0) return;
    signedRef.current = { ...signedRef.current, ...additions };
    setSignedUrls(signedRef.current);
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

  const signKeys = useCallback(
    async (keys: string[]) => {
      const unique = [...new Set(keys.filter((key): key is string => !!key))];
      if (unique.length === 0) return;
      mergeSigned(await signBatcher.request(unique));
    },
    [mergeSigned, signBatcher],
  );

  // Signatures are for the lines the player is about to need, not for every line the studio
  // finishes. A chapter voicing at one line a second used to cost one media-token request per
  // line — 13 of them in seven seconds of listening — because each `segment_ready` was signed on
  // arrival however far ahead of the play head it was. Three lines of runway is 8–12 seconds of
  // audio, which is several times the 0.63s a signature takes.
  const signUpcoming = useCallback(
    (list: Segment[], from: number) => {
      const wanted: string[] = [];
      for (let offset = 0; offset < 3; offset++) {
        const segment = list[from + offset];
        if (!segment || segment.status !== "voiced") continue;
        const key = audioKeyFromUrl(segment.audioUrl);
        if (key && !signedRef.current[key]) wanted.push(key);
      }
      if (wanted.length === 0) return;
      void signKeys(wanted).catch(() => {
        // The poll that follows a reconnect retries, and the load effect asks again.
      });
    },
    [signKeys],
  );

  const applySegments = useCallback(
    async (fresh: Segment[]) => {
      setSegments(fresh);
      await signKeys(
        fresh
          .filter((segment) => segment.status === "voiced")
          .map((segment) => audioKeyFromUrl(segment.audioUrl))
          .filter((key): key is string => !!key && !signedRef.current[key]),
      );
    },
    [signKeys],
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

        // One request for the page the player is about to open — the whole chapter's voiced
        // lines — and nothing for the ones already signed during this session.
        const keys = audioKeysOf(data.segments.filter((segment) => segment.status === "voiced"));
        const unsigned = keys.filter((key) => !signedRef.current[key]);
        if (unsigned.length > 0) await signKeys(unsigned);
        if (requestId !== requestRef.current) return;

        const startIndex = resolveStartSegmentIndex(data.segments, resumeMs);
        const preceding = sumDurationsBefore(data.segments, startIndex);
        pendingSeekRef.current = resumeMs > 0 ? Math.max(0, (resumeMs - preceding) / 1000) : null;
        loadedKeyRef.current = null;

        transport.pause();
        setActiveBook(book);
        setActiveChapter(data.chapter ?? chapter);
        setSegments(data.segments);
        setCurrentIndex(startIndex);
        lastPublishedPositionRef.current = resumeMs;
        setPosition(resumeMs);
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
    [showToast, signKeys, transport],
  );

  const playChapterRef = useRef(playChapter);
  playChapterRef.current = playChapter;

  const finishChapter = useCallback(async () => {
    transport.pause();
    setIsPlaying(false);
    lastPublishedPositionRef.current = 0;
    setPosition(0);
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
      // The player reports every few hundred milliseconds; the store coalesces anything that
      // has not moved a quarter second, so the dock does not re-render on every native tick.
      onProgress: (currentTimeSec, isLoaded) => {
        if (!isLoaded) return;
        publishPosition(positionMsFor(segmentsRef.current, currentIndexRef.current, currentTimeSec));
      },
      onFinished: () => handleSegmentEndedRef.current(),
    });
  }, [transport, publishPosition]);

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
    if (!url) {
      // Landing on a line that was never signed ahead: ask for this one and the two after.
      signUpcoming(segments, currentIndex);
      return;
    }

    const key = segmentSourceKey(segment, url);
    if (loadedKeyRef.current === key) return;

    loadedKeyRef.current = key;
    transport.load(url, { seekSec: pendingSeekRef.current, autoplay: isPlayingRef.current });
    pendingSeekRef.current = null;
    transport.setRate(speedRef.current);
    setIsBufferingNext(false);

    // Exactly one line ahead: the transport keeps a single preload slot and releases the line
    // behind it, so advancing a chapter never holds a buffer nobody will play.
    const nextSegment = segments[findNextIndex(segments, currentIndex)];
    transport.prefetch(nextSegment ? signedUrlFor(nextSegment, signedUrls) : null);
  }, [segments, signedUrls, currentIndex, activeChapter, transport, signUpcoming]);

  useEffect(() => {
    if (!activeChapter) return;
    if (isPlaying) transport.play();
    else transport.pause();
  }, [isPlaying, activeChapter, transport]);

  // The chapter's length, published once per chapter rather than per position tick.
  useEffect(() => {
    setChapterTotal(chapterDurationMs(segments) || activeChapter?.durationMs || 0);
  }, [segments, activeChapter]);

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

  // Live pipeline updates keep the open chapter's lines current without a poll, through the
  // app's single stream for this book.
  useBookEvents(
    activeBook?.id ?? null,
    (event) => {
      if (event.type !== "segment_ready" || event.chapterId !== chapterRef.current?.id) return;
      const patched = patchSegmentReady(segmentsRef.current, event);
      if (patched === segmentsRef.current) return;

      setSegments(patched);
      // Only the runway: a line voiced twenty ahead of the play head is signed when the player
      // reaches it, not when the studio finishes it.
      signUpcoming(patched, currentIndexRef.current);
    },
    () => void refreshSegments(),
  );

  // ~10s position sync while a line is actually playing, plus a final write when playback
  // pauses or the chapter changes. Nothing ticks while the listener is not playing.
  useEffect(() => {
    if (!activeBook || !activeChapter || !isPlaying) return;
    const timer = setInterval(() => syncPosition(), POSITION_SYNC_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      syncPosition(false);
    };
  }, [activeBook, activeChapter, isPlaying, syncPosition]);

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
      lastPublishedPositionRef.current = plan.positionMs;
      setPosition(plan.positionMs);
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
    transport.releaseSources();
    setIsPlaying(false);
    setActiveBook(null);
    setActiveChapter(null);
    setSegments([]);
    setSignedUrls({});
    signedRef.current = {};
    setCurrentIndex(0);
    setSleep(SLEEP_OFF);
    resetPosition();
    positionRef.current = 0;
    lastPublishedPositionRef.current = 0;
    loadedKeyRef.current = null;
  }, [transport]);

  const value = useMemo<PlayerSessionValue>(
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

export function usePlayer(): PlayerSessionValue {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used inside PlayerProvider");
  return context;
}

export interface PlayheadSnapshot {
  positionMs: number;
  chapterTotalMs: number;
  ratio: number;
}

// The play head, for the two or three components that draw it. Subscribing here rather than to
// the session context is what keeps a position tick from re-rendering the rest of the app.
export function usePlayerPosition(): PlayheadSnapshot {
  const snapshot = useSyncExternalStore(subscribePosition, getPositionSnapshot, getPositionSnapshot);
  return { positionMs: snapshot.positionMs, chapterTotalMs: snapshot.chapterTotalMs, ratio: positionRatio(snapshot) };
}
