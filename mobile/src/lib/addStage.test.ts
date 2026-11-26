import type { PipelineEvent } from "@/api/types";
import {
  STAGING_FAILED_MESSAGE,
  STAGING_STAGES,
  chapterRatio,
  createStagingState,
  isSettled,
  mergeStagingSnapshot,
  reduceStagingEvent,
  stageFloorForStatus,
  stageStateOf,
  stagingFromDetail,
  stagingHeadline,
  voicingSummary,
  type StagingState,
} from "@/lib/addStage";
import { createDetailState, reduceDetailEvent } from "@/playback/detailsData";
import type { BookDetailResponse } from "@/api/types";

// The add sheet and the book detail screen both narrate the pipeline from this reducer, so the
// stage ladder, the counters and the failure path are pinned here rather than in a rendering test.

const BOOK_ID = "11111111-1111-4111-8111-111111111111";
const CHAPTER_ID = "22222222-2222-4222-8222-222222222222";

function run(events: PipelineEvent[], state: StagingState = createStagingState()): StagingState {
  return events.reduce(reduceStagingEvent, state);
}

function event<T extends PipelineEvent["type"]>(type: T, payload: Record<string, unknown>): PipelineEvent {
  return { bookId: BOOK_ID, type, timestamp: 1, ...payload } as PipelineEvent;
}

describe("stage ladder", () => {
  it("walks acquisition → download → read → cast → voice from the messages the server emits", () => {
    expect(run([event("progress_log", { message: 'Searching torrents for "Dracula"...' })]).stageIndex).toBe(0);

    const downloading = run([event("progress_log", { message: 'Selected via Anna\'s Archive: "Dracula.epub" (2.40 MB, 12 seeds)' })]);
    expect(downloading.stageIndex).toBe(1);

    const parsing = run([event("status_change", { status: "discovering", message: "Parsing EPUB spine and contents..." })]);
    expect(parsing.stageIndex).toBe(2);

    const casting = run([event("status_change", { status: "in_progress", message: "Book initialized. Scheduling audio synthesis..." })]);
    expect(casting.stageIndex).toBe(3);

    const voicing = run([event("chapter_status", { chapterId: CHAPTER_ID, chapterIndex: 1, status: "processing" })]);
    expect(voicing.stageIndex).toBe(4);
  });

  it("never moves backwards when a replayed or late line arrives", () => {
    const state = run([
      event("chapter_status", { chapterId: CHAPTER_ID, chapterIndex: 1, status: "processing" }),
      event("progress_log", { message: 'Checking Internet Archive for "Dracula"...' }),
      event("status_change", { status: "discovering", message: "Starting ingestion pipeline..." }),
    ]);
    expect(state.stageIndex).toBe(4);
    expect(stageStateOf(state, 4)).toBe("active");
  });

  it("marks every stage done once the book is ready", () => {
    const state = run([event("status_change", { status: "ready", message: "Every chapter is voiced." })]);
    expect(state.stageIndex).toBe(STAGING_STAGES.length);
    expect(STAGING_STAGES.map((_, index) => stageStateOf(state, index))).toEqual(STAGING_STAGES.map(() => "done"));
    expect(isSettled(state)).toBe(true);
    expect(stagingHeadline(state)).toBe("Every chapter is voiced");
  });

  it("turns a failed status into a failed stage with the server's reason", () => {
    const state = run([
      event("status_change", { status: "discovering", message: "Acquiring from archive-org..." }),
      event("status_change", { status: "failed", error: "Provider file hash verification failed." }),
    ]);
    expect(state.bookStatus).toBe("failed");
    expect(state.error).toBe("Provider file hash verification failed.");
    expect(stageStateOf(state, state.stageIndex)).toBe("failed");
    expect(isSettled(state)).toBe(true);
  });

  it("falls back to a readable failure when the server sends none", () => {
    const state = run([event("status_change", { status: "failed" })]);
    expect(state.error).toBe(STAGING_FAILED_MESSAGE);
  });

  it("keeps the newest line first and does not repeat an identical replay", () => {
    const once = run([event("progress_log", { message: "Segment 3 voiced" })]);
    const twice = reduceStagingEvent(once, event("progress_log", { message: "Segment 3 voiced" }));
    expect(twice).toBe(once);
    expect(twice.log).toHaveLength(1);
  });

  it("caps the log so a long pipeline cannot grow without bound", () => {
    const state = run(
      Array.from({ length: 40 }, (_, index) => event("progress_log", { message: `Synthesizing segment ${index}, part 1 of 2...` })),
    );
    expect(state.log).toHaveLength(24);
    expect(state.log[0].text).toContain("segment 39");
  });
});

describe("voicing counters", () => {
  const state = run([
    event("chapter_status", { chapterId: "c1", chapterIndex: 1, status: "processing" }),
    event("segment_ready", {
      chapterId: "c1",
      chapterIndex: 1,
      segmentId: "s1",
      segmentIndex: 1,
      audioR2Key: "k",
      audioUrl: "/api/audio?key=k",
      durationMs: 1000,
      done: 3,
      total: 10,
      voicedCount: 3,
    }),
    event("chapter_status", { chapterId: "c2", chapterIndex: 2, status: "queued" }),
    event("segment_ready", {
      chapterId: "c3",
      chapterIndex: 3,
      segmentId: "s2",
      segmentIndex: 1,
      audioR2Key: "k",
      audioUrl: "/api/audio?key=k",
      durationMs: 1000,
      done: 2,
      total: 4,
      voicedCount: 2,
    }),
  ]);

  it("tracks done/total per chapter and the whole book", () => {
    const summary = voicingSummary(state);
    expect(summary).not.toBeNull();
    // Two chapters in flight: the bar follows the newest one, the totals cover every chapter.
    expect(summary!.chapterIndex).toBe(3);
    expect(summary!.label).toBe("Ch. 03 · 2/4 lines");
    expect(summary!.overallDone).toBe(5);
    expect(summary!.overallTotal).toBe(14);
    expect(summary!.overallRatio).toBeCloseTo(5 / 14);
    expect(summary!.ratio).toBeCloseTo(0.5);
  });

  it("clamps a ratio that outruns its total and refuses to divide by zero", () => {
    expect(chapterRatio({ done: 12, total: 10 })).toBe(1);
    expect(chapterRatio({ done: 0, total: 0 })).toBe(0);
    expect(voicingSummary(createStagingState())).toBeNull();
  });

  it("names the chapter currently being voiced, not the first one left partial", () => {
    const later = reduceStagingEvent(state, event("chapter_status", { chapterId: "c4", chapterIndex: 4, status: "processing" }));
    expect(voicingSummary(later)!.chapterIndex).toBe(4);
  });

  it("counts a chapter as playable as soon as its first lines land", () => {
    expect(state.playableChapterId).toBe("c1");
  });
});

describe("detail snapshot merge", () => {
  function detail(overrides: Partial<BookDetailResponse> = {}): BookDetailResponse {
    return {
      book: {
        id: BOOK_ID,
        title: "Dracula",
        author: "Bram Stoker",
        coverR2Key: null,
        sourceHash: "hash",
        epubR2Key: null,
        status: "in_progress",
        createdAt: "2026-11-01T00:00:00.000Z",
      },
      cast: [],
      chapters: [
        {
          id: "c1",
          bookId: BOOK_ID,
          chapterIndex: 1,
          title: "Jonathan Harker's Journal",
          status: "partial_ready",
          audioR2Key: null,
          durationMs: null,
          totalCount: 20,
          voicedCount: 8,
          failedCount: 0,
        },
      ],
      pronunciation: [],
      playbackState: null,
      ...overrides,
    };
  }

  it("fills chapter titles and counters from the poll and marks the book playable", () => {
    const state = mergeStagingSnapshot(createStagingState({ title: "Dracula" }), {
      title: "Dracula",
      bookStatus: "in_progress",
      chapters: detail().chapters,
    });
    expect(state.chapters[0]).toMatchObject({ title: "Jonathan Harker's Journal", done: 8, total: 20 });
    expect(state.playableChapterId).toBe("c1");
    expect(state.stageIndex).toBe(4);
  });

  it("prefers the stream's per-chapter counters over the payload's", () => {
    const live = mergeStagingSnapshot(createStagingState(), {
      title: "Dracula",
      bookStatus: "in_progress",
      chapters: detail().chapters,
      segmentProgress: { c1: { done: 11, total: 20 } },
    });
    expect(voicingSummary(live)!.label).toBe("Ch. 01 · 11/20 lines");
  });

  it("clears a stale error when the snapshot says the book is working again", () => {
    const failed = mergeStagingSnapshot(createStagingState(), { title: "Dracula", bookStatus: "failed", chapters: [] });
    expect(failed.error).toBe(STAGING_FAILED_MESSAGE);
    const retried = mergeStagingSnapshot(failed, { title: "Dracula", bookStatus: "discovering", chapters: [] });
    expect(retried.error).toBeNull();
  });

  it("jumps the ladder straight to done for a book that finished while the sheet was closed", () => {
    const ready = mergeStagingSnapshot(createStagingState(), {
      title: "Dracula",
      bookStatus: "ready",
      chapters: [{ ...detail().chapters[0], status: "ready", voicedCount: 20 }],
    });
    expect(ready.stageIndex).toBe(STAGING_STAGES.length);
    expect(ready.readyCount).toBe(1);
  });

  it("reflects the status floor for a book that has not started voicing", () => {
    expect(stageFloorForStatus("discovering", 0)).toBe(0);
    expect(stageFloorForStatus("casting", 0)).toBe(3);
    expect(stageFloorForStatus("in_progress", 0)).toBe(3);
    expect(stageFloorForStatus("in_progress", 4)).toBe(4);
    expect(stageFloorForStatus(null, 40)).toBe(0);
  });
});

describe("detail screen projection", () => {
  it("renders the same ladder and log the detail screen already reduces", () => {
    const initial = createDetailState({
      book: {
        id: BOOK_ID,
        title: "Dracula",
        author: "Bram Stoker",
        coverR2Key: null,
        sourceHash: "hash",
        epubR2Key: null,
        status: "in_progress",
        createdAt: "2026-11-01T00:00:00.000Z",
      },
      cast: [],
      chapters: [],
      pronunciation: [],
      playbackState: null,
    });
    const withEvent = reduceDetailEvent(initial, event("progress_log", { message: "Synthesizing segment 1, part 1 of 3..." })).state;
    const staging = stagingFromDetail(withEvent);

    expect(staging.log[0].text).toBe("Synthesizing segment 1, part 1 of 3...");
    expect(staging.stageIndex).toBe(4);
    expect(staging.title).toBe("Dracula");
  });

  it("carries an empty detail state without inventing a stage", () => {
    const staging = stagingFromDetail(createDetailState(null));
    expect(staging.bookStatus).toBeNull();
    expect(staging.chapters).toEqual([]);
    expect(stageStateOf(staging, 0)).toBe("active");
  });
});
