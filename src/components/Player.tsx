import { useState, useEffect, useLayoutEffect, useRef, useCallback, type MutableRefObject } from "react";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { Icon } from "./ui/Icon";
import { ProgressBar } from "./ui/ProgressBar";
import { useToast } from "./ui/Toast";
import { useAudioPlayer } from "../hooks/useAudioPlayer";
import { useSSE } from "../hooks/useSSE";
import { apiFetch } from "../lib/api";
import { formatDurationWithHours, segmentAudioSrc } from "../lib/format";
import { isPendingStatus, isPlayableSegment } from "../lib/segmentStatus";
import { TransportControls } from "./player/TransportControls";
import SegmentTranscript from "./player/SegmentTranscript";
import type { Book, Chapter, PipelineEvent, Segment } from "../types/api";

interface PlayerProps {
  book: Book;
  chapter: Chapter;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  /** Sleep-timer state lives in App so it survives chapter changes: Player is
   *  remounted (via key) on every chapter switch, which used to reset the
   *  timer mid-book. */
  sleepPreset: number | null;
  setSleepPreset: (preset: number | null) => void;
  sleepTimeLeft: number | null;
  setSleepTimeLeft: (left: number | null) => void;
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  /** Shared position sink: updated on every timeupdate without re-rendering App. */
  positionRef: MutableRefObject<number>;
  segmentsList: Segment[];
  setSegmentsList: (segs: Segment[]) => void;
  currentSegmentIndex: number;
  setCurrentSegmentIndex: (idx: number) => void;
  /** Position to resume from when the player mounts (0 = start from the top). */
  initialPositionMs?: number;
  /** Fires when the chapter finishes and no further lines are generating. */
  onChapterEnded?: () => void;
}

const SLEEP_OPTIONS = [
  { label: "Off", seconds: null as number | null },
  { label: "15 min", seconds: 900 },
  { label: "30 min", seconds: 1800 },
  { label: "45 min", seconds: 2700 },
  { label: "1 hr", seconds: 3600 },
];

/** Next index that isn't permanently failed, or -1 if none. */
function findNextIndex(segs: Segment[], fromExclusive: number): number {
  let next = fromExclusive + 1;
  while (next < segs.length && segs[next].status === "failed") next += 1;
  return next < segs.length ? next : -1;
}

function findPrevIndex(segs: Segment[], fromExclusive: number): number {
  let prev = fromExclusive - 1;
  while (prev >= 0 && segs[prev].status === "failed") prev -= 1;
  return prev;
}

export default function Player({
  book,
  chapter,
  isPlaying,
  setIsPlaying,
  sleepPreset,
  setSleepPreset,
  sleepTimeLeft,
  setSleepTimeLeft,
  playbackSpeed,
  setPlaybackSpeed,
  positionRef,
  segmentsList,
  setSegmentsList,
  currentSegmentIndex,
  setCurrentSegmentIndex,
  initialPositionMs = 0,
  onChapterEnded,
}: PlayerProps) {
  const { showToast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isBufferingNext, setIsBufferingNext] = useState(false);

  // Local display state for position. The exact value always lands in
  // positionRef; the re-rendering state only advances at 1s granularity so
  // the sheet (and its long segment list) renders ~1x/sec instead of ~4x/sec.
  const [positionMs, setPositionMsState] = useState(initialPositionMs);
  const setPositionMs = useCallback(
    (pos: number) => {
      positionRef.current = pos;
      setPositionMsState((prev) =>
        pos === 0 || Math.floor(pos / 1000) !== Math.floor(prev / 1000) ? pos : prev
      );
    },
    [positionRef]
  );

  // Sleep timer state is hoisted to App (Player remounts on chapter change).
  // The sleep UI reads sleepPreset/sleepTimeLeft from props below.

  // Regeneration modal state
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [regenSegmentId, setRegenSegmentId] = useState<string | null>(null);
  const [regenInstruction, setRegenInstruction] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSrcRef = useRef<string | null>(null);
  const loadedSegmentKeyRef = useRef<string | null>(null);
  const pendingSeekSecRef = useRef<number | null>(null);
  const resumeSeekReadyRef = useRef(false);
  const segmentElsRef = useRef(new Map<string, HTMLDivElement>());
  /** True after the current line finished and we're waiting for a later line to voice. */
  const awaitingNextRef = useRef(false);
  /** Hidden preload <audio> used to warm the next segment's bytes/decode so the
   *  boundary between segments is near-instant. Shares the session via cookies. */
  const prefetchAudioRef = useRef<HTMLAudioElement | null>(null);
  /** URL currently being (or already) prefetched by prefetchAudioRef. */
  const prefetchUrlRef = useRef<string | null>(null);

  const segmentsListRef = useRef(segmentsList);
  const currentSegmentIndexRef = useRef(currentSegmentIndex);
  const isPlayingRef = useRef(isPlaying);
  const isBufferingNextRef = useRef(isBufferingNext);

  // Apply resume offset before any load effects run (layout effect fires
  // synchronously after render, before paint and before the passive effects
  // that attach media handlers — a plain effect would race loadedmetadata
  // and drop the seek). Render stays pure; StrictMode-safe.
  useLayoutEffect(() => {
    if (resumeSeekReadyRef.current || initialPositionMs <= 0) return;
    resumeSeekReadyRef.current = true;
    let preceding = 0;
    for (let i = 0; i < currentSegmentIndex; i++) {
      preceding += segmentsList[i]?.durationMs ?? 0;
    }
    pendingSeekSecRef.current = Math.max(0, (initialPositionMs - preceding) / 1000);
  }, [initialPositionMs, currentSegmentIndex, segmentsList]);

  useEffect(() => {
    segmentsListRef.current = segmentsList;
  }, [segmentsList]);
  useEffect(() => {
    currentSegmentIndexRef.current = currentSegmentIndex;
  }, [currentSegmentIndex]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    isBufferingNextRef.current = isBufferingNext;
  }, [isBufferingNext]);

  // Milliseconds of audio preceding the current segment
  const precedingMsRef = useRef(0);
  useEffect(() => {
    let total = 0;
    for (let i = 0; i < currentSegmentIndex; i++) {
      total += segmentsList[i]?.durationMs ?? 0;
    }
    precedingMsRef.current = total;
  }, [segmentsList, currentSegmentIndex]);

  const handleAudioEnded = useCallback(() => {
    const idx = currentSegmentIndexRef.current;
    const segs = segmentsListRef.current;
    const next = findNextIndex(segs, idx);

    if (next >= 0) {
      awaitingNextRef.current = false;
      setCurrentSegmentIndex(next);
      return;
    }

    // End of known list
    const stillGenerating = segs.some((s) => isPendingStatus(s.status));
    if (stillGenerating) {
      // Stay put and wait — when the next line after idx voices, advance.
      awaitingNextRef.current = true;
      setIsBufferingNext(true);
    } else {
      awaitingNextRef.current = false;
      setIsPlaying(false);
      setPositionMs(0);
      setCurrentSegmentIndex(0);
      onChapterEnded?.();
    }
  }, [setCurrentSegmentIndex, setIsPlaying, setPositionMs, onChapterEnded]);

  const handleAudioTimeUpdate = useCallback(
    (segmentMs: number) => {
      setPositionMs(precedingMsRef.current + segmentMs);
    },
    [setPositionMs]
  );

  const handlePlayBlocked = useCallback(() => {
    // Autoplay policy blocked us — flip UI to Play so the next tap is a gesture
    setIsPlaying(false);
  }, [setIsPlaying]);

  const audioPlayer = useAudioPlayer({
    onEnded: handleAudioEnded,
    onTimeUpdate: handleAudioTimeUpdate,
    onPlayBlocked: handlePlayBlocked,
  });
  const {
    play,
    pause,
    loadAndPlay,
    seekTo,
    setPlaybackRate,
    getCurrentTime,
    isActuallyPaused,
  } = audioPlayer;

  /** Toggle play; if UI thinks we're playing but the element is paused (autoplay
   * block / aborted load), retry play on this user gesture instead of pausing.
   * While buffering, the pause control cancels the wait instead of no-op retry. */
  const togglePlayPause = useCallback(() => {
    if (!isPlayingRef.current) {
      setIsPlaying(true);
      void play();
      return;
    }
    // User wants to stop waiting for the next line
    if (isBufferingNextRef.current) {
      awaitingNextRef.current = false;
      setIsBufferingNext(false);
      setIsPlaying(false);
      pause();
      return;
    }
    if (isActuallyPaused()) {
      void play();
      return;
    }
    setIsPlaying(false);
  }, [play, pause, isActuallyPaused, setIsPlaying]);

  const clearPoll = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  /**
   * Load a segment and optionally start playback in one serialized pipeline
   * (metadata → seek → canplay → play) so races don't leave us paused at 0:00.
   */
  const loadSegmentSource = useCallback(
    (seg: Segment, opts: { force?: boolean; autoplay?: boolean } = {}) => {
      if (!seg.audioUrl) return;
      const force = opts.force ?? false;
      const autoplay = opts.autoplay ?? false;
      const base = segmentAudioSrc(seg.audioUrl, seg.durationMs);
      const url = force ? `${base}&_=${Date.now()}` : base;
      const key = `${seg.id}:${seg.durationMs ?? 0}:${force ? url : base}`;
      const isSame = !force && loadedSegmentKeyRef.current === key && lastSrcRef.current === base;

      const seekSec = pendingSeekSecRef.current;
      // Consume pending seek once — loadAndPlay applies it after metadata
      if (seekSec != null) pendingSeekSecRef.current = null;

      lastSrcRef.current = url;
      loadedSegmentKeyRef.current = key;
      // Note: playback rate is applied by its own effect on mount and on every
      // change — deliberately NOT here, so a speed toggle doesn't change this
      // callback's identity and re-fire the whole segment-load effect.

      if (!isSame) {
        void loadAndPlay(url, seekSec, force, autoplay).then((ok) => {
          if (!ok && autoplay && isPlayingRef.current && isActuallyPaused()) {
            // Stay flagged playing only if element actually started; otherwise show Play
            // (onPlayBlocked may already have flipped state)
          }
        });
      } else if (autoplay) {
        void play();
      }
    },
    [loadAndPlay, play, isActuallyPaused]
  );

  /**
   * Warm the browser HTTP cache + audio decode buffer for the segment that
   * will play right after the current one. With the server now streaming WAVs
   * with Range/Content-Length, the browser finishes fetching this file in the
   * background while the current line is still playing — so when the boundary
   * fires, loadAndPlay() hits a warm cache and canplay arrives in tens of
   * milliseconds instead of a multi-second network round-trip.
   *
   * Only prefetches voiced, ready-to-play segments (never pending/failed ones),
   * and skips when the target URL is already being prefetched.
   */
  const prefetchNextSegment = useCallback(() => {
    const segs = segmentsListRef.current;
    const idx = currentSegmentIndexRef.current;
    const next = findNextIndex(segs, idx);
    if (next < 0) return;
    const seg = segs[next];
    if (!seg || !isPlayableSegment(seg) || !seg.audioUrl) return;

    const url = segmentAudioSrc(seg.audioUrl, seg.durationMs);
    if (prefetchUrlRef.current === url) return;

    if (!prefetchAudioRef.current) {
      const el = new Audio();
      el.preload = "auto";
      el.muted = true; // never audible; preload only
      prefetchAudioRef.current = el;
    }
    const el = prefetchAudioRef.current;
    el.src = url;
    el.load();
    prefetchUrlRef.current = url;
  }, []);

  // Discard prefetch state on unmount
  useEffect(() => {
    return () => {
      const el = prefetchAudioRef.current;
      if (el) {
        el.removeAttribute("src");
        el.load();
      }
      prefetchAudioRef.current = null;
      prefetchUrlRef.current = null;
    };
  }, []);

  const refreshSegments = useCallback(async () => {
    try {
      // Anchor the server's just-in-time voicing window on the line we're
      // waiting for (1-based DB segmentIndex, not the 0-based list offset).
      const at = segmentsListRef.current[currentSegmentIndexRef.current]?.segmentIndex ?? 1;
      const res = await apiFetch(`/api/chapters/${chapter.id}/segments?at=${at}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { segments?: Segment[] };
      const freshSegments = data.segments ?? [];
      setSegmentsList(freshSegments);
      return freshSegments;
    } catch (err) {
      console.error("Error refreshing segments:", err);
      return null;
    }
  }, [chapter.id, setSegmentsList]);

  /**
   * After a refresh, either:
   * - advance past a finished line into a newly ready next line, or
   * - start a newly voiced active line we were buffering on.
   */
  const resumeFromFreshSegments = useCallback(
    (fresh: Segment[]) => {
      const idx = currentSegmentIndexRef.current;

      // Finished last known line → walk forward to the next playable/pending line
      if (awaitingNextRef.current) {
        const next = findNextIndex(fresh, idx);
        if (next >= 0) {
          awaitingNextRef.current = false;
          // If next is already voiced, index change loads it; if pending, load effect buffers
          setCurrentSegmentIndex(next);
          return;
        }
        // Still nothing after current — keep buffering only if work remains
        if (!fresh.some((s) => isPendingStatus(s.status))) {
          awaitingNextRef.current = false;
          setIsBufferingNext(false);
          if (isPlayingRef.current) {
            setIsPlaying(false);
            setPositionMs(0);
            setCurrentSegmentIndex(0);
            onChapterEnded?.();
          }
        }
        return;
      }

      const active = fresh[idx];
      if (
        isBufferingNextRef.current &&
        isPlayableSegment(active) &&
        loadedSegmentKeyRef.current?.split(":")[0] !== active.id
      ) {
        clearPoll();
        setIsBufferingNext(false);
        loadSegmentSource(active, { autoplay: isPlayingRef.current });
      }
    },
    [
      setCurrentSegmentIndex,
      setIsPlaying,
      setPositionMs,
      onChapterEnded,
      clearPoll,
      loadSegmentSource,
    ]
  );

  const startPollingForSegment = useCallback(
    (segId: string) => {
      clearPoll();
      pollIntervalRef.current = setInterval(async () => {
        const freshSegments = await refreshSegments();
        if (!freshSegments) return;

        // Prefer the dedicated resume path (handles end-of-list + active)
        if (awaitingNextRef.current || isBufferingNextRef.current) {
          resumeFromFreshSegments(freshSegments);
          return;
        }

        const currentSeg = freshSegments.find((s) => s.id === segId);
        if (isPlayableSegment(currentSeg)) {
          clearPoll();
          setIsBufferingNext(false);
          loadSegmentSource(currentSeg!, { autoplay: isPlayingRef.current });
        }
      }, 1200);
    },
    [clearPoll, refreshSegments, loadSegmentSource, resumeFromFreshSegments]
  );

  // Live updates from the pipeline — pick up newly voiced segments quickly but
  // throttled: with several workers voicing concurrently, segment_ready events
  // arrive in bursts and each one used to trigger a full segment-list refetch
  // (every rawText in the chapter) plus a transcript re-render. Coalesce to at
  // most one refresh per window, with a trailing call so the final state
  // always lands.
  const SSE_REFRESH_MIN_MS = 500;
  const lastSseRefreshRef = useRef(0);
  const sseRefreshTimerRef = useRef<number | null>(null);

  const runSseRefresh = useCallback(() => {
    lastSseRefreshRef.current = Date.now();
    void refreshSegments().then((fresh) => {
      if (!fresh) return;
      resumeFromFreshSegments(fresh);
    });
  }, [refreshSegments, resumeFromFreshSegments]);

  const handlePipelineEvent = useCallback(
    (payload: PipelineEvent) => {
      if (payload.type !== "segment_ready" && payload.type !== "chapter_status") return;
      if (payload.chapterId && payload.chapterId !== chapter.id) return;
      if (sseRefreshTimerRef.current !== null) return; // trailing refresh already scheduled
      const elapsed = Date.now() - lastSseRefreshRef.current;
      if (elapsed >= SSE_REFRESH_MIN_MS) {
        runSseRefresh();
      } else {
        sseRefreshTimerRef.current = window.setTimeout(() => {
          sseRefreshTimerRef.current = null;
          runSseRefresh();
        }, SSE_REFRESH_MIN_MS - elapsed);
      }
    },
    [chapter.id, runSseRefresh]
  );

  useEffect(
    () => () => {
      if (sseRefreshTimerRef.current !== null) {
        window.clearTimeout(sseRefreshTimerRef.current);
        sseRefreshTimerRef.current = null;
      }
    },
    []
  );

  useSSE(`/api/books/${book.id}/events`, {
    onEvent: handlePipelineEvent,
    // Events emitted during the reconnect gap were missed — resync from the
    // DB instead of staying stale until the next unrelated event arrives.
    onReconnect: runSseRefresh,
  });

  // Load and play the active segment — only reloads when the active identity/URL changes
  useEffect(() => {
    const activeSegment = segmentsList[currentSegmentIndex];
    if (!activeSegment) return;

    // Auto-skip permanently failed segments
    if (activeSegment.status === "failed") {
      const next = findNextIndex(segmentsList, currentSegmentIndex);
      if (next >= 0) {
        setCurrentSegmentIndex(next);
      } else if (segmentsList.some((s) => isPendingStatus(s.status))) {
        awaitingNextRef.current = true;
        setIsBufferingNext(true);
        startPollingForSegment(activeSegment.id);
      } else {
        pause();
        setIsPlaying(false);
      }
      return;
    }

    if (isPlayableSegment(activeSegment)) {
      const url = segmentAudioSrc(activeSegment.audioUrl!, activeSegment.durationMs);
      const key = `${activeSegment.id}:${activeSegment.durationMs ?? 0}:${url}`;
      const alreadyLoaded = loadedSegmentKeyRef.current === key;

      clearPoll();
      if (isBufferingNextRef.current) setIsBufferingNext(false);
      awaitingNextRef.current = false;

      if (!alreadyLoaded) {
        // Serialized load → seek → play (avoids paused-at-0:00 abort races)
        loadSegmentSource(activeSegment, { autoplay: isPlaying });
      } else if (isPlaying && isActuallyPaused()) {
        void play();
      }
      return;
    }

    if (isPendingStatus(activeSegment.status) || !activeSegment.audioUrl) {
      // Only live-buffer while the user still wants playback. Pausing must not
      // immediately re-enter "Performing next line…" mode.
      if (!isPlaying) {
        clearPoll();
        if (isBufferingNextRef.current) setIsBufferingNext(false);
        awaitingNextRef.current = false;
        pause();
        return;
      }
      // Don't restart the poll on every segmentsList identity change
      if (!isBufferingNextRef.current || pollIntervalRef.current === null) {
        pause();
        setIsBufferingNext(true);
        startPollingForSegment(activeSegment.id);
      }
    }
  }, [
    currentSegmentIndex,
    segmentsList,
    clearPoll,
    loadSegmentSource,
    startPollingForSegment,
    play,
    pause,
    setCurrentSegmentIndex,
    setIsPlaying,
    isPlaying,
    isActuallyPaused,
  ]);

  // Prefetch the next segment whenever the active line or playing state
  // changes, or when fresh segments arrive (a newly voiced next line should
  // be warmed immediately). Cheap when already prefetched.
  useEffect(() => {
    if (!isPlaying) return;
    prefetchNextSegment();
  }, [isPlaying, currentSegmentIndex, segmentsList, prefetchNextSegment]);

  // Cleanup poll on unmount
  useEffect(() => clearPoll, [clearPoll]);

  // Play / pause transport (does not remount sources)
  useEffect(() => {
    if (isPlaying && !isBufferingNext) {
      void play();
    } else if (!isPlaying) {
      pause();
    }
    // While buffering with isPlaying=true, leave the element paused without
    // clearing wantPlaying — resumeFromFreshSegments will loadAndPlay next.
  }, [isPlaying, isBufferingNext, play, pause]);

  // Watchdog: UI says playing but element is still paused (aborted autoplay / stall).
  // Keep retrying while media loads; only flip to Play after several failed attempts
  // once the element reports it could play.
  useEffect(() => {
    if (!isPlaying || isBufferingNext) return;
    let readyFails = 0;
    const id = window.setInterval(() => {
      if (!isPlayingRef.current || isBufferingNextRef.current) return;
      if (!isActuallyPaused()) {
        readyFails = 0;
        return;
      }
      void play().then((ok) => {
        if (ok || !isActuallyPaused()) {
          readyFails = 0;
          return;
        }
        readyFails += 1;
        // ~4s of failed retries after the element should be playable
        if (readyFails >= 5) setIsPlaying(false);
      });
    }, 800);
    return () => window.clearInterval(id);
  }, [isPlaying, isBufferingNext, play, isActuallyPaused, setIsPlaying]);

  // Playback speed
  useEffect(() => {
    setPlaybackRate(playbackSpeed);
  }, [playbackSpeed, setPlaybackRate]);

  const seekRelative = useCallback(
    (seconds: number) => {
      seekTo(getCurrentTime() + seconds);
      if (isPlayingRef.current && !isBufferingNextRef.current) void play();
    },
    [seekTo, getCurrentTime, play]
  );

  // Keyboard shortcuts: Space = play/pause, Arrows = ±10s
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never hijack keys typed into form controls or the regen modal: Space
      // on a focused <select> used to both block the dropdown and toggle
      // playback, and Space on the modal's "Perform line" button both
      // submitted AND toggled. Excluding buttons also avoids the double
      // activation from Space's native click.
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLSelectElement || target instanceof HTMLButtonElement) return;
      if (target && target.isContentEditable) return;
      if (showRegenModal) return;
      // Holding a key fires repeated keydowns — ignore auto-repeat so a held
      // arrow doesn't skip minutes of audio in a second.
      if (e.repeat) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seekRelative(10);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seekRelative(-10);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [seekRelative, togglePlayPause, showRegenModal]);

  // Keep the active segment in view while reading. Intentionally NOT keyed on
  // segmentsList: refresh polls give it a new identity every ~1.2s, which
  // would yank the viewport back to the active line while the user reads ahead.
  useEffect(() => {
    if (!isExpanded) return;
    const seg = segmentsList[currentSegmentIndex];
    if (!seg) return;
    segmentElsRef.current
      .get(seg.id)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, currentSegmentIndex]);

  // Stable callbacks for memoized SegmentRow (refs keep them identity-stable)
  const goToSegment = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= segmentsListRef.current.length) return;
      pendingSeekSecRef.current = null;
      awaitingNextRef.current = false;
      setCurrentSegmentIndex(idx);
      if (!isPlayingRef.current) setIsPlaying(true);
    },
    [setCurrentSegmentIndex, setIsPlaying]
  );

  const registerSegmentRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) segmentElsRef.current.set(id, el);
    else segmentElsRef.current.delete(id);
  }, []);

  const handleRowRedo = useCallback((segId: string) => {
    setRegenSegmentId(segId);
    setShowRegenModal(true);
  }, []);

  const goToPrev = () => {
    const prev = findPrevIndex(segmentsList, currentSegmentIndex);
    if (prev >= 0) goToSegment(prev);
  };

  const goToNext = () => {
    const next = findNextIndex(segmentsList, currentSegmentIndex);
    if (next >= 0) {
      goToSegment(next);
      return;
    }
    // At end while lines still generating — enter wait mode
    if (segmentsList.some((s) => isPendingStatus(s.status))) {
      awaitingNextRef.current = true;
      setIsBufferingNext(true);
      if (!isPlayingRef.current) setIsPlaying(true);
      startPollingForSegment(segmentsList[currentSegmentIndex]?.id ?? "");
    }
  };

  const canGoPrev = findPrevIndex(segmentsList, currentSegmentIndex) >= 0;
  const canGoNext =
    findNextIndex(segmentsList, currentSegmentIndex) >= 0 ||
    segmentsList.some((s) => isPendingStatus(s.status));

  const handleSeek = (ratio: number) => {
    // Only seek within segments that have known duration (voiced)
    const seekable = segmentsList.map((s) => s.durationMs ?? 0);
    const total = seekable.reduce((a, b) => a + b, 0);
    if (total <= 0) return;

    const targetMs = ratio * total;
    let accumulated = 0;
    for (let i = 0; i < segmentsList.length; i++) {
      const dur = seekable[i];
      // Skip zero-duration (unvoiced) slots for landing; still count them in accumulation as 0
      if (dur <= 0) {
        if (i === segmentsList.length - 1 && isPlayableSegment(segmentsList[i])) {
          pendingSeekSecRef.current = 0;
          setCurrentSegmentIndex(i);
          setPositionMs(Math.round(targetMs));
        }
        continue;
      }
      if (accumulated + dur >= targetMs || i === segmentsList.length - 1) {
        const offsetSec = Math.max(0, (targetMs - accumulated) / 1000);
        if (i !== currentSegmentIndex) {
          pendingSeekSecRef.current = offsetSec;
          awaitingNextRef.current = false;
          setCurrentSegmentIndex(i);
        } else {
          seekTo(offsetSec);
          if (isPlayingRef.current) void play();
        }
        setPositionMs(Math.round(targetMs));
        break;
      }
      accumulated += dur;
    }
  };

  const handleRegenerateSegment = async () => {
    if (!regenSegmentId) return;
    setIsRegenerating(true);

    try {
      const res = await apiFetch(`/api/segments/${regenSegmentId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: regenInstruction }),
      });

      if (res.ok) {
        const segRes = await apiFetch(`/api/chapters/${chapter.id}/segments`);
        if (segRes.ok) {
          const segData = (await segRes.json()) as { segments?: Segment[] };
          const fresh = segData.segments ?? [];
          setSegmentsList(fresh);
          // Force reload if the regenerated line is currently loaded
          const active = fresh[currentSegmentIndexRef.current];
          if (active && active.id === regenSegmentId && isPlayableSegment(active)) {
            lastSrcRef.current = null;
            loadedSegmentKeyRef.current = null;
            loadSegmentSource(active, { force: true, autoplay: isPlayingRef.current });
          }
        }
        setShowRegenModal(false);
        setRegenInstruction("");
        showToast("Line re-performed.");
      } else {
        showToast("Regeneration failed.", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error contacting performance server.", "error");
    } finally {
      setIsRegenerating(false);
    }
  };

  const totalChapterDurationMs = segmentsList.reduce((acc, s) => acc + (s.durationMs ?? 0), 0);
  const progressPercent =
    totalChapterDurationMs > 0 ? Math.min(100, (positionMs / totalChapterDurationMs) * 100) : 0;

  const voicedCount = segmentsList.filter((s) => s.status === "voiced").length;
  const bufferPercent = segmentsList.length > 0 ? (voicedCount / segmentsList.length) * 100 : 0;

  // p-2.5 grows the touch target to ~40px; -m-1 keeps the visual rhythm
  const transportButton =
    "text-cinema-400 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed transition-colors duration-200 p-2.5 -m-1 rounded-full";

  const showPlayingUi = isPlaying && !isBufferingNext;

  const selectClass =
    "bg-cinema-950/80 border border-white/[0.08] text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-gold-500/50 text-cinema-200";

  return (
    <div
      className={`player-sheet fixed bottom-0 left-0 right-0 z-50 shadow-player glass-strong transition-all duration-500 ease-out-expo ${
        isExpanded ? "player-sheet--expanded rounded-t-[1.75rem]" : ""
      }`}
    >
      <div className="absolute top-0 left-0 right-0 px-4 sm:px-6 -translate-y-1/2">
        <div className="max-w-6xl mx-auto">
          <ProgressBar progress={progressPercent} buffered={bufferPercent} onSeek={handleSeek} />
        </div>
      </div>

      {!isExpanded && (
        <div className="max-w-6xl mx-auto px-5 sm:px-6 h-full flex items-center justify-between gap-4">
          <button
            className="flex items-center gap-3.5 min-w-0 text-left group flex-1"
            onClick={() => setIsExpanded(true)}
          >
            <div className="min-w-0">
              <span className="text-[10px] text-gold-400/90 uppercase tracking-[0.18em] truncate flex items-center gap-2 font-medium">
                {book.title}
                <span
                  className={`eq text-gold-400 ${showPlayingUi ? "" : "eq-paused"}`}
                  aria-hidden="true"
                >
                  <span /><span /><span />
                </span>
              </span>
              <span className="font-serif text-[15px] font-medium block text-white truncate mt-0.5">
                {chapter.title}
              </span>
            </div>
            <Icon
              name="chevronUp"
              size={16}
              className="text-cinema-500 shrink-0 transition-transform group-hover:-translate-y-0.5"
            />
          </button>

          <div className="flex items-center gap-4 sm:gap-5">
            {isBufferingNext && (
              <span className="text-[11px] text-gold-400 animate-pulse-soft hidden md:flex items-center gap-1.5 tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-gold-400 animate-ping" />
                Next line…
              </span>
            )}

            <TransportControls
              variant="collapsed"
              canGoPrev={canGoPrev}
              canGoNext={canGoNext}
              goToPrev={goToPrev}
              goToNext={goToNext}
              togglePlayPause={togglePlayPause}
              isPlaying={isPlaying}
              transportButton={transportButton}
            />
          </div>

          <div className="hidden sm:flex items-center justify-end gap-4 flex-1">
            <span className="text-[11px] font-mono text-cinema-400 tabular-nums">
              {formatDurationWithHours(positionMs)}
              <span className="text-cinema-600 mx-1">/</span>
              {formatDurationWithHours(totalChapterDurationMs)}
            </span>
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="h-full flex flex-col p-5 sm:p-7 max-w-6xl mx-auto w-full animate-fade-in pt-6">
          <div className="flex justify-between items-start border-b border-white/[0.05] pb-5 mb-5">
            <div className="min-w-0">
              <span className="label-caps text-gold-400/90 block truncate">{book.title}</span>
              <h2 className="font-serif text-2xl sm:text-3xl font-medium text-gradient truncate mt-1">
                {chapter.title}
              </h2>
              {isBufferingNext && (
                <p className="text-xs text-gold-400 mt-2 animate-pulse-soft tracking-wide">
                  Performing next line…
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setIsExpanded(false)} className="shrink-0">
              Collapse
              <Icon name="chevronDown" size={14} />
            </Button>
          </div>

          <SegmentTranscript
            segmentsList={segmentsList}
            currentSegmentIndex={currentSegmentIndex}
            onSegmentSelect={goToSegment}
            onSegmentRedo={handleRowRedo}
            registerSegmentRef={registerSegmentRef}
          />

          <div className="flex flex-col md:flex-row justify-between items-center gap-5 pt-4 border-t border-white/[0.05]">
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-2">
                <span className="label-caps">Speed</span>
                <select
                  value={playbackSpeed}
                  onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                  className={selectClass}
                >
                  {[0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0].map((s) => (
                    <option key={s} value={s}>
                      {s}x
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="label-caps">Sleep</span>
                <select
                  value={sleepPreset === null ? "" : String(sleepPreset)}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "") {
                      setSleepPreset(null);
                      setSleepTimeLeft(null);
                    } else {
                      const secs = parseInt(val, 10);
                      setSleepPreset(secs);
                      setSleepTimeLeft(secs);
                    }
                  }}
                  className={selectClass}
                >
                  {SLEEP_OPTIONS.map((opt) => (
                    <option key={opt.label} value={opt.seconds === null ? "" : String(opt.seconds)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {sleepTimeLeft !== null && (
                  <span className="text-[10px] font-mono text-gold-400 tabular-nums">
                    {Math.floor(sleepTimeLeft / 60)}m {sleepTimeLeft % 60}s
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-5">
              <TransportControls
                variant="expanded"
                canGoPrev={canGoPrev}
                canGoNext={canGoNext}
                goToPrev={goToPrev}
                goToNext={goToNext}
                togglePlayPause={togglePlayPause}
                isPlaying={isPlaying}
                transportButton={transportButton}
              />
            </div>

            <div className="text-[11px] font-mono text-cinema-400 tabular-nums">
              {formatDurationWithHours(positionMs)}
              <span className="text-cinema-600 mx-1">/</span>
              {formatDurationWithHours(totalChapterDurationMs)}
            </div>
          </div>
        </div>
      )}

      <Modal isOpen={showRegenModal} onClose={() => setShowRegenModal(false)} title="Redo this line">
        <p className="text-xs text-cinema-400 leading-relaxed">
          Direct the performance — e.g.{" "}
          <span className="italic text-cinema-300">“whisper this, with more fear”</span>.
        </p>
        <textarea
          rows={3}
          value={regenInstruction}
          onChange={(e) => setRegenInstruction(e.target.value)}
          placeholder="e.g. slower pace, with suppressed anger…"
          className="input-field resize-none !text-xs min-h-[5rem]"
        />
        <Button
          variant="primary"
          className="w-full"
          onClick={handleRegenerateSegment}
          isLoading={isRegenerating}
        >
          {isRegenerating ? "Re-performing…" : "Perform line"}
        </Button>
      </Modal>
    </div>
  );
}
