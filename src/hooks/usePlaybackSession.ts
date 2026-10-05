import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { apiFetch } from "../lib/api";
import { unlockSharedAudio } from "../lib/sharedAudio";
import { usePlaybackProgressSync, type PlaybackTarget } from "./usePlaybackProgressSync";
import { findNextPlayableChapter, resolveStartSegmentIndex } from "./playbackSelection";
import type { Book, Chapter, Segment } from "../types/api";

export interface PlaybackSession {
  activeBook: Book | null;
  activeChapter: Chapter | null;
  segments: Segment[];
  setSegments: (segments: Segment[]) => void;
  currentSegmentIndex: number;
  setCurrentSegmentIndex: (index: number) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  resumePositionMs: number;
  playSession: number;
  positionRef: MutableRefObject<number>;
  playChapter: (book: Book, chapter: Chapter, resumeMs?: number) => Promise<void>;
  handleChapterEnded: () => Promise<void>;
}

type ShowToast = (message: string, tone?: "info" | "error") => void;

interface LatestPlayback {
  book: Book | null;
  chapter: Chapter | null;
  segmentIndex: number;
}

export function usePlaybackSession(showToast: ShowToast): PlaybackSession {
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [activeSegmentsList, setActiveSegmentsList] = useState<Segment[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [resumePositionMs, setResumePositionMs] = useState(0);
  const [playSession, setPlaySession] = useState(0);

  const positionRef = useRef(0);
  const progressTargetRef = useRef<PlaybackTarget | null>(null);
  const playRequestRef = useRef(0);
  const segmentIndexRef = useRef(1);
  const latestRef = useRef<LatestPlayback>({ book: null, chapter: null, segmentIndex: 1 });

  useEffect(() => {
    const segment = activeSegmentsList[activeSegmentIndex];
    latestRef.current = {
      book: activeBook,
      chapter: activeChapter,
      segmentIndex: segment ? segment.segmentIndex : latestRef.current.segmentIndex,
    };
  }, [activeBook, activeChapter, activeSegmentIndex, activeSegmentsList]);

  const syncPosition = usePlaybackProgressSync({
    targetRef: progressTargetRef,
    positionRef,
    segmentIndexRef,
    activeBookId: activeBook?.id ?? null,
    activeChapterId: activeChapter?.id ?? null,
  });

  const playChapter = useCallback(
    async (book: Book, chapter: Chapter, resumeMs = 0) => {
      const requestId = ++playRequestRef.current;
      let segments: Segment[];

      try {
        segments = await loadChapterSegments(chapter.id, unlockSharedAudio());
      } catch (error) {
        if (requestId !== playRequestRef.current) return;
        console.error(error);
        showToast("This chapter is still processing. Try again shortly.", "error");
        return;
      }

      if (requestId !== playRequestRef.current) return;

      if (segments.length === 0) {
        showToast("This chapter has no lines yet. Try again shortly.", "error");
        return;
      }

      const startIndex = resolveStartSegmentIndex(segments, resumeMs);
      if (requestId !== playRequestRef.current) return;

      syncPosition();
      progressTargetRef.current = { bookId: book.id, chapterId: chapter.id };
      positionRef.current = resumeMs;

      setActiveBook(book);
      setActiveChapter(chapter);
      setActiveSegmentsList(segments);
      setActiveSegmentIndex(startIndex);
      setResumePositionMs(resumeMs);
      setIsPlaying(true);
      setPlaySession((current) => current + 1);
    },
    [showToast, syncPosition],
  );

  const handleChapterEnded = useCallback(async () => {
    const { book, chapter } = latestRef.current;
    if (!book || !chapter) return;

    try {
      const next = findNextPlayableChapter(await loadBookChapters(book.id), chapter.chapterIndex);
      if (!next) return;

      showToast(`Continuing · ${next.title}`);
      await playChapter(book, next, 0);
    } catch (error) {
      console.error("Auto-advance chapter failed:", error);
    }
  }, [playChapter, showToast]);

  return {
    activeBook,
    activeChapter,
    segments: activeSegmentsList,
    setSegments: setActiveSegmentsList,
    currentSegmentIndex: activeSegmentIndex,
    setCurrentSegmentIndex: setActiveSegmentIndex,
    isPlaying,
    setIsPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    resumePositionMs,
    playSession,
    positionRef,
    playChapter,
    handleChapterEnded,
  };
}

async function loadChapterSegments(chapterId: string, audioUnlocked: Promise<void>): Promise<Segment[]> {
  const [response] = await Promise.all([apiFetch(`/api/chapters/${chapterId}/segments`), audioUnlocked]);
  if (!response.ok) throw new Error("Failed to load chapter segments");

  const data = (await response.json()) as { segments?: Segment[] };
  return data.segments ?? [];
}

async function loadBookChapters(bookId: string): Promise<Chapter[]> {
  const response = await apiFetch(`/api/books/${bookId}`);
  if (!response.ok) return [];

  const data = (await response.json()) as { chapters?: Chapter[] };
  return data.chapters ?? [];
}
