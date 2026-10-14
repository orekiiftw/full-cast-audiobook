import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("../lib/sharedAudio", () => ({
  unlockSharedAudio: async () => {},
  getSharedAudio: () => ({}),
}));

import { findNextPlayableChapter } from "./playbackSelection";
import { usePlaybackSession } from "./usePlaybackSession";
import { renderHookOnServer } from "../components/player/testSupport";
import type { Book, Chapter, Segment } from "../types/api";

const BOOK: Book = {
  id: "00000000-0000-0000-0000-000000000101",
  title: "The Time Machine and the Invisible Man",
  author: "H. G. Wells",
  coverR2Key: null,
  sourceHash: "hash-time-machine",
  epubR2Key: "epubs/book-time-machine.epub",
  status: "in_progress",
  createdAt: "2026-04-17T00:00:00.000Z",
};

const CH1: Chapter = {
  id: "00000000-0000-0000-0000-000000000201",
  bookId: BOOK.id,
  chapterIndex: 1,
  title: "The Time Machine",
  status: "ready",
  audioR2Key: "k1",
  durationMs: 14000,
  voicedCount: 3,
  failedCount: 0,
  totalCount: 3,
};

const CH2: Chapter = {
  id: "00000000-0000-0000-0000-000000000202",
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

const CH3_QUEUED: Chapter = {
  id: "00000000-0000-0000-0000-000000000203",
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

const CH2_SEGMENTS: Segment[] = [
  {
    id: "seg-2-1",
    chapterId: CH2.id,
    segmentIndex: 1,
    rawText: "I. Introduction",
    status: "voiced",
    audioUrl: "/api/audio?key=2-1&v=1500",
    durationMs: 1500,
  },
  {
    id: "seg-2-2",
    chapterId: CH2.id,
    segmentIndex: 2,
    rawText: "The Time Traveller (for so it will be convenient to speak of him) was expounding a recondite matter to us.",
    status: "voiced",
    audioUrl: "/api/audio?key=2-2&v=4000",
    durationMs: 4000,
  },
  {
    id: "seg-2-3",
    chapterId: CH2.id,
    segmentIndex: 3,
    rawText: "His grey eyes shone and twinkled, and his usually pale face was flushed and animated.",
    status: "pending",
    audioUrl: null,
    durationMs: null,
  },
];

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("usePlaybackSession lookahead cue syncing", () => {
  it("immediately anchors lookahead when playChapter starts a chapter and when the playing segment advances", async () => {
    const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      requests.push({ url, method, body });
      if (url.startsWith(`/api/chapters/${CH2.id}/segments`)) {
        return Response.json({ segments: CH2_SEGMENTS });
      }
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;

    const session = renderHookOnServer(() => usePlaybackSession(() => {}));
    await session.playChapter(BOOK, CH2, 0);

    const segmentGet = requests.find((req) => req.method === "GET" && req.url.startsWith(`/api/chapters/${CH2.id}/segments`));
    expect(segmentGet?.url).toBe(`/api/chapters/${CH2.id}/segments?at=1`);

    const initialPut = requests.find((req) => req.method === "PUT" && req.url === "/api/playback");
    expect(initialPut?.body).toEqual({
      bookId: BOOK.id,
      chapterId: CH2.id,
      positionMs: 0,
      segmentIndex: 1,
    });
  });

  it("advances into the next chapter even when its first segment is still queued or pending", () => {
    expect(findNextPlayableChapter([CH1, CH2, CH3_QUEUED], 2)?.id).toBe(CH3_QUEUED.id);
  });
});
