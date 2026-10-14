import { afterEach, describe, expect, it, mock } from "bun:test";
import type { PipelineEvent, Segment, SegmentReadyEvent } from "../../types/api";

interface CapturedStream {
  onEvent?: (event: PipelineEvent) => void;
  onReconnect?: () => void;
}

const stream: CapturedStream = {};

mock.module("../../hooks/useSSE", () => ({
  useSSE: (_url: string, handlers: CapturedStream) => {
    stream.onEvent = handlers.onEvent;
    stream.onReconnect = handlers.onReconnect;
  },
}));

import { renderHookOnServer } from "./testSupport";
import type { AudioTransport } from "./useAudioTransport";
import { useSegmentPlayback } from "./useSegmentPlayback";
import { useSegmentSync, type SegmentPlaybackRefs } from "./useSegmentSync";

const BOOK_ID = "book-1";
const CHAPTER_ID = "chapter-1";

function seg(id: string, overrides: Partial<Segment> = {}): Segment {
  return {
    id,
    chapterId: CHAPTER_ID,
    segmentIndex: 1,
    rawText: "Some narration.",
    status: "pending",
    audioUrl: null,
    durationMs: null,
    ...overrides,
  };
}

const VOICED_LINE_1 = seg("s1", { segmentIndex: 1, status: "voiced", audioUrl: "/api/audio?key=k1&v=4000", durationMs: 4000 });
const PENDING_LINE_2 = seg("s2", { segmentIndex: 2 });
const VOICED_LINE_2 = seg("s2", { segmentIndex: 2, status: "voiced", audioUrl: "/api/audio?key=k2&v=5000", durationMs: 5000 });

function segmentReady(segment: Segment): SegmentReadyEvent {
  return {
    type: "segment_ready",
    bookId: BOOK_ID,
    timestamp: Date.now(),
    chapterId: CHAPTER_ID,
    chapterIndex: 1,
    segmentId: segment.id,
    segmentIndex: segment.segmentIndex,
    audioR2Key: "k2",
    audioUrl: segment.audioUrl ?? "",
    durationMs: segment.durationMs ?? 0,
    done: 2,
    total: 2,
    voicedCount: 2,
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function holdSegmentResponses(): Array<(segments: Segment[]) => void> {
  const release: Array<(segments: Segment[]) => void> = [];
  globalThis.fetch = mock(
    () => new Promise<Response>((resolve) => release.push((segments) => resolve(Response.json({ segments })))),
  ) as unknown as typeof fetch;
  return release;
}

function mountSegmentSync(segments: Segment[]): SegmentPlaybackRefs {
  const refs: SegmentPlaybackRefs = {
    segments: { current: segments },
    currentIndex: { current: 0 },
    isPlaying: { current: true },
    awaitingNext: { current: false },
    isBufferingNext: { current: false },
  };
  renderHookOnServer(() =>
    useSegmentSync({
      bookId: BOOK_ID,
      chapterId: CHAPTER_ID,
      refs,
      setSegmentsList: (next) => {
        refs.segments.current = next;
      },
      setCurrentIndex: () => {},
      setBufferingNext: () => {},
      onChapterComplete: () => {},
      loadSegmentSource: () => {},
      getLoadedSegmentId: () => null,
    }),
  );
  return refs;
}

describe("useSegmentSync refresh ordering", () => {
  it("drops a refresh requested before a segment_ready patch, so the patched line stays voiced", async () => {
    const release = holdSegmentResponses();
    const refs = mountSegmentSync([VOICED_LINE_1, PENDING_LINE_2]);

    stream.onReconnect?.();
    stream.onEvent?.(segmentReady(VOICED_LINE_2));
    expect(refs.segments.current[1]).toEqual(VOICED_LINE_2);

    release[0]([VOICED_LINE_1, PENDING_LINE_2]);
    await Bun.sleep(5);

    expect(refs.segments.current[1]).toEqual(VOICED_LINE_2);
  });

  it("drops an older refresh that resolves after a newer one", async () => {
    const release = holdSegmentResponses();
    const refs = mountSegmentSync([VOICED_LINE_1, PENDING_LINE_2]);

    stream.onReconnect?.();
    stream.onReconnect?.();
    expect(release).toHaveLength(2);

    release[1]([VOICED_LINE_1, VOICED_LINE_2]);
    await Bun.sleep(5);
    expect(refs.segments.current[1]).toEqual(VOICED_LINE_2);

    release[0]([VOICED_LINE_1, PENDING_LINE_2]);
    await Bun.sleep(5);

    expect(refs.segments.current[1]).toEqual(VOICED_LINE_2);
  });

  it("immediately polls with ?at=<segmentIndex> when buffering starts on a pending segment", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestedUrls.push(typeof input === "string" ? input : input.toString());
      return Response.json({ segments: [VOICED_LINE_1, PENDING_LINE_2] });
    }) as unknown as typeof fetch;

    const refs: SegmentPlaybackRefs = {
      segments: { current: [VOICED_LINE_1, PENDING_LINE_2] },
      currentIndex: { current: 1 },
      isPlaying: { current: true },
      awaitingNext: { current: false },
      isBufferingNext: { current: true },
    };
    const sync = renderHookOnServer(() =>
      useSegmentSync({
        bookId: BOOK_ID,
        chapterId: CHAPTER_ID,
        refs,
        setSegmentsList: (next) => {
          refs.segments.current = next;
        },
        setCurrentIndex: () => {},
        setBufferingNext: () => {},
        onChapterComplete: () => {},
        loadSegmentSource: () => {},
        getLoadedSegmentId: () => null,
      }),
    );

    sync.startPollingForSegment(PENDING_LINE_2.id);
    sync.clearPoll();
    await Bun.sleep(5);

    expect(requestedUrls).toEqual([`/api/chapters/${CHAPTER_ID}/segments?at=2`]);
  });

  it("starts polling with ?at=<currentSegmentIndex> when the final segment ends while an earlier line is still pending", async () => {
    const PENDING_LINE_1 = seg("s1", { segmentIndex: 1, status: "pending", audioUrl: null, durationMs: null });
    const requestedUrls: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestedUrls.push(typeof input === "string" ? input : input.toString());
      return Response.json({ segments: [PENDING_LINE_1, VOICED_LINE_2] });
    }) as unknown as typeof fetch;

    const stubAudio: AudioTransport = {
      loadAndPlay: async () => true,
      play: async () => true,
      pause: () => {},
      seekTo: () => {},
      getCurrentTime: () => 0,
      isActuallyPaused: () => true,
      setPlaybackRate: () => {},
    };

    const playback = renderHookOnServer(() =>
      useSegmentPlayback({
        bookId: BOOK_ID,
        chapterId: CHAPTER_ID,
        segmentsList: [PENDING_LINE_1, VOICED_LINE_2],
        setSegmentsList: () => {},
        currentSegmentIndex: 1,
        setCurrentSegmentIndex: () => {},
        isPlaying: true,
        setIsPlaying: () => {},
        initialPositionMs: 0,
        setPositionMs: () => {},
        audio: stubAudio,
      }),
    );

    playback.handleSegmentEnded();
    await Bun.sleep(5);
    playback.togglePlayPause();

    expect(requestedUrls).toEqual([`/api/chapters/${CHAPTER_ID}/segments?at=2`]);
  });
});
