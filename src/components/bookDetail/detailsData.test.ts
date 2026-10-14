import { describe, expect, it } from "bun:test";
import {
  applyPipelineEvent,
  deriveInitialCues,
  findLiveChapter,
  resumePositionFor,
  type DetailData,
  type SegmentProgress,
} from "./detailsData";
import type { Book, Chapter, ChapterStatusEvent, PlaybackState, SegmentReadyEvent } from "../../types/api";

const BOOK: Book = {
  id: "book-time-machine",
  title: "The Time Machine and the Invisible Man",
  author: "H. G. Wells",
  coverR2Key: null,
  sourceHash: "hash-time-machine",
  epubR2Key: "epubs/book-time-machine.epub",
  status: "in_progress",
  createdAt: "2026-04-17T00:00:00.000Z",
};

const CH1: Chapter = {
  id: "ch-1",
  bookId: BOOK.id,
  chapterIndex: 1,
  title: "The Time Machine",
  status: "ready",
  audioR2Key: "books/book-time-machine/chapters/1/stitched.mp3",
  durationMs: 14000,
  voicedCount: 3,
  failedCount: 0,
  totalCount: 3,
};

const CH2: Chapter = {
  id: "ch-2",
  bookId: BOOK.id,
  chapterIndex: 2,
  title: "I. Introduction",
  status: "partial_ready",
  audioR2Key: null,
  durationMs: null,
  voicedCount: 2,
  failedCount: 0,
  totalCount: 29,
};

const CH3: Chapter = {
  id: "ch-3",
  bookId: BOOK.id,
  chapterIndex: 3,
  title: "II. The Machine",
  status: "queued",
  audioR2Key: null,
  durationMs: null,
  voicedCount: 0,
  failedCount: 0,
  totalCount: 31,
};

describe("BookDetail studio cues and live chapter selection", () => {
  it("logs studio cues when segment_ready and chapter_status events arrive during in_progress", () => {
    let data: DetailData | null = {
      book: BOOK,
      chapters: [CH1, { ...CH2, status: "processing", voicedCount: 1 }, CH3],
      cast: [],
      pronunciation: [],
      playbackState: null,
      segmentProgress: {
        [CH1.id]: { total: 3, done: 3 },
        [CH2.id]: { total: 29, done: 1 },
        [CH3.id]: { total: 31, done: 0 },
      },
    };
    let progress: SegmentProgress = { ...data.segmentProgress };
    const logs: string[] = [];

    const segmentEvent: SegmentReadyEvent = {
      type: "segment_ready",
      bookId: BOOK.id,
      timestamp: Date.now(),
      chapterId: CH2.id,
      chapterIndex: 2,
      segmentId: "seg-2-2",
      segmentIndex: 2,
      audioR2Key: "books/book-time-machine/chapters/2/segments/2.wav",
      audioUrl: "/api/audio?key=seg-2-2&v=4000",
      durationMs: 4000,
      done: 2,
      total: 29,
      voicedCount: 2,
    };

    applyPipelineEvent(segmentEvent, {
      setData: (updater) => {
        data = typeof updater === "function" ? updater(data) : updater;
      },
      setSegmentProgress: (updater) => {
        progress = typeof updater === "function" ? updater(progress) : updater;
      },
      pushLog: (msg) => logs.push(msg),
      refetch: () => {},
    });

    expect(progress[CH2.id]).toEqual({ total: 29, done: 2 });
    expect(data?.chapters.find((c) => c.id === CH2.id)?.status).toBe("partial_ready");
    expect(data?.chapters.find((c) => c.id === CH2.id)?.voicedCount).toBe(2);
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("2/29");

    const chapterEvent: ChapterStatusEvent = {
      type: "chapter_status",
      bookId: BOOK.id,
      timestamp: Date.now(),
      chapterId: CH2.id,
      status: "ready",
      durationMs: 120000,
      audioR2Key: "books/book-time-machine/chapters/2/stitched.mp3",
      message: "Chapter audio ready!",
    };

    applyPipelineEvent(chapterEvent, {
      setData: (updater) => {
        data = typeof updater === "function" ? updater(data) : updater;
      },
      setSegmentProgress: () => {},
      pushLog: (msg) => logs.push(msg),
      refetch: () => {},
    });

    expect(data?.chapters.find((c) => c.id === CH2.id)?.status).toBe("ready");
    expect(logs.length).toBe(2);
    expect(logs[1]).toContain("Chapter audio ready!");
  });

  it("derives initial studio cues from book detail data so in_progress books never stall on 'Waiting for cues…'", () => {
    const detail: DetailData = {
      book: BOOK,
      chapters: [CH1, CH2, CH3],
      cast: [],
      pronunciation: [],
      playbackState: null,
      segmentProgress: {
        [CH1.id]: { total: 3, done: 3 },
        [CH2.id]: { total: 29, done: 2 },
        [CH3.id]: { total: 31, done: 0 },
      },
    };

    const cues = deriveInitialCues(detail);
    expect(cues.length).toBeGreaterThan(0);
    expect(cues.join(" ")).toContain("2/29");
  });

  it("selects Chapter 1 first when Chapter 1 is ready and Chapter 2 is partial_ready with no prior playback state", () => {
    const progress: SegmentProgress = {
      [CH1.id]: { total: 3, done: 3 },
      [CH2.id]: { total: 29, done: 2 },
      [CH3.id]: { total: 31, done: 0 },
    };

    expect(findLiveChapter([CH1, CH2, CH3], progress, null)?.id).toBe(CH1.id);
  });

  it("resumes the active chapter from playbackState or advances to the next playable chapter when completed", () => {
    const progress: SegmentProgress = {
      [CH1.id]: { total: 3, done: 3 },
      [CH2.id]: { total: 29, done: 2 },
      [CH3.id]: { total: 31, done: 0 },
    };

    const midCh2: PlaybackState = {
      id: "pb-1",
      bookId: BOOK.id,
      chapterId: CH2.id,
      positionMs: 3000,
      updatedAt: "2026-04-17T00:01:00.000Z",
    };
    expect(findLiveChapter([CH1, CH2, CH3], progress, midCh2)?.id).toBe(CH2.id);

    const finishedCh1: PlaybackState = {
      id: "pb-2",
      bookId: BOOK.id,
      chapterId: CH1.id,
      positionMs: 13800,
      updatedAt: "2026-04-17T00:01:00.000Z",
    };
    expect(findLiveChapter([CH1, CH2, CH3], progress, finishedCh1)?.id).toBe(CH2.id);
    expect(resumePositionFor(finishedCh1, CH1.id, CH1.durationMs)).toBe(0);
  });
});
